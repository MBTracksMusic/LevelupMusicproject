import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  createAdminClient,
  enforceRateLimit,
  evaluateForumContent,
  generateAssistantReply,
  jsonResponse,
  loadForumSettings,
  requireInternalAgent,
  ensureAssistantUser,
} from "../_shared/forumAgents.ts";

interface WorkerBody {
  jobId?: string;
}

async function markJobFailed(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  jobId: string,
  error: string,
) {
  await supabaseAdmin
    .from("forum_assistant_jobs")
    .update({
      status: "failed",
      error,
      processed_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  const guard = requireInternalAgent(req);
  if ("error" in guard) {
    return guard.error as Response;
  }

  const body = await req.json().catch(() => null) as WorkerBody | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return jsonResponse({ error: "jobId is required", code: "invalid_payload" }, 400);
  }

  const supabaseAdmin = createAdminClient();
  const rateLimit = await enforceRateLimit(supabaseAdmin, null, "forum_assistant_worker");
  if (!rateLimit.allowed) {
    if (rateLimit.code === "rate_limit_check_failed") {
      return jsonResponse({ error: "Rate limit backend unavailable", code: "rate_limit_check_failed" }, 500);
    }
    return jsonResponse({ error: "Worker rate limit exceeded", code: "rate_limit_exceeded" }, 429);
  }

  const { data: claimedJob, error: claimError } = await supabaseAdmin
    .from("forum_assistant_jobs")
    .update({
      status: "processing",
      attempts: 1,
      error: null,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimError) {
    console.error("[forum-assistant-worker] claim failed", claimError);
    return jsonResponse({ error: "Failed to claim job", code: "job_claim_failed" }, 500);
  }

  if (!claimedJob) {
    return jsonResponse({ ok: true, skipped: "job_not_pending" });
  }

  const settings = await loadForumSettings(supabaseAdmin);

  try {
    const assistantUser = await ensureAssistantUser(supabaseAdmin, settings);

    const { data: topic, error: topicError } = await supabaseAdmin
      .from("forum_topics")
      .select("id, title, slug, category_id, is_deleted, is_locked")
      .eq("id", claimedJob.topic_id)
      .maybeSingle();

    if (topicError || !topic) {
      await markJobFailed(supabaseAdmin, jobId, "topic_not_found");
      return jsonResponse({ ok: true, skipped: "topic_not_found" });
    }

    if (topic.is_deleted || topic.is_locked) {
      await markJobFailed(supabaseAdmin, jobId, "topic_unavailable");
      return jsonResponse({ ok: true, skipped: "topic_unavailable" });
    }

    const { data: category } = await supabaseAdmin
      .from("forum_categories")
      .select("id, name, slug")
      .eq("id", topic.category_id)
      .maybeSingle();

    const { data: recentPosts, error: recentPostsError } = await supabaseAdmin
      .from("forum_posts")
      .select("id, content, is_ai_generated, ai_agent_name, user_id")
      .eq("topic_id", topic.id)
      .eq("is_visible", true)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(6);

    if (recentPostsError) {
      await markJobFailed(supabaseAdmin, jobId, "recent_posts_lookup_failed");
      return jsonResponse({ ok: true, skipped: "recent_posts_lookup_failed" });
    }

    if (!Array.isArray(recentPosts) || recentPosts.length === 0) {
      await markJobFailed(supabaseAdmin, jobId, "no_recent_posts");
      return jsonResponse({ ok: true, skipped: "no_recent_posts" });
    }

    if (recentPosts[0]?.is_ai_generated) {
      await markJobFailed(supabaseAdmin, jobId, "last_post_already_ai");
      return jsonResponse({ ok: true, skipped: "last_post_already_ai" });
    }

    const sourcePost = claimedJob.source_post_id
      ? recentPosts.find((post) => post.id === claimedJob.source_post_id) ?? null
      : recentPosts[0];

    const reply = await generateAssistantReply({
      settings,
      topicTitle: topic.title,
      categoryName: category?.name ?? "Forum",
      sourceContent: sourcePost?.content ?? recentPosts[0].content,
      recentPosts: recentPosts
        .slice()
        .reverse()
        .map((post) => ({
          username: post.is_ai_generated ? post.ai_agent_name ?? settings.assistant.assistantName : null,
          content: post.content,
          isAiGenerated: post.is_ai_generated,
        })),
    });

    const moderation = await evaluateForumContent({
      content: reply,
      title: topic.title,
      settings,
    });

    const finalReply = moderation.decision === "allowed"
      ? reply
      : "Je prefere rester prudent ici. Si tu veux une aide utile, precise ton contexte technique, ce que tu as deja essaye et le resultat attendu.";

    const finalModeration = moderation.decision === "allowed"
      ? moderation
      : {
          decision: "allowed" as const,
          score: 0,
          reason: "assistant_fallback",
          model: "assistant-fallback",
          isVisible: true,
          isFlagged: false,
          rawResponse: {
            original_moderation: moderation.rawResponse,
            fallback: true,
          },
        };

    const { data: createdPost, error: createPostError } = await supabaseAdmin.rpc("rpc_forum_create_post", {
      p_user_id: assistantUser.id,
      p_topic_id: topic.id,
      p_content: finalReply,
      p_source: "forum-assistant-worker",
      p_moderation_status: finalModeration.decision,
      p_is_visible: finalModeration.isVisible,
      p_is_flagged: finalModeration.isFlagged,
      p_moderation_score: finalModeration.score,
      p_moderation_reason: finalModeration.reason,
      p_moderation_model: finalModeration.model,
      p_is_ai_generated: true,
      p_ai_agent_name: settings.assistant.assistantName,
      p_source_post_id: claimedJob.source_post_id ?? null,
      p_raw_response: finalModeration.rawResponse,
    });

    if (createPostError) {
      console.error("[forum-assistant-worker] rpc_forum_create_post failed", createPostError);
      await markJobFailed(supabaseAdmin, jobId, createPostError.message || "assistant_post_failed");
      return jsonResponse({ ok: true, skipped: "assistant_post_failed" });
    }

    const createdRow = Array.isArray(createdPost) ? createdPost[0] : createdPost;

    await supabaseAdmin
      .from("forum_assistant_jobs")
      .update({
        status: "done",
        error: null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return jsonResponse({
      ok: true,
      job_id: jobId,
      post_id: createdRow?.post_id ?? null,
      topic_id: topic.id,
    });
  } catch (error) {
    console.error("[forum-assistant-worker] unexpected error", error);
    await markJobFailed(supabaseAdmin, jobId, error instanceof Error ? error.message : "assistant_worker_failed");
    return jsonResponse({ error: "Internal server error", code: "internal_error" }, 500);
  }
});
