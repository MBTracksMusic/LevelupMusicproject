import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  asNonEmptyString,
  corsHeaders,
  createAdminClient,
  enforceRateLimit,
  invokeInternalForumFunction,
  jsonResponse,
  loadForumSettings,
  requireInternalAgent,
} from "../_shared/forumAgents.ts";

interface DispatchBody {
  topicId?: string;
  sourcePostId?: string;
  triggerType?: "mention" | "no_reply_cron";
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

  const body = await req.json().catch(() => null) as DispatchBody | null;
  const topicId = asNonEmptyString(body?.topicId);
  const sourcePostId = asNonEmptyString(body?.sourcePostId);
  const triggerType = body?.triggerType === "no_reply_cron" ? "no_reply_cron" : "mention";

  if (!topicId) {
    return jsonResponse({ error: "topicId is required", code: "invalid_payload" }, 400);
  }

  const supabaseAdmin = createAdminClient();
  const settings = await loadForumSettings(supabaseAdmin);

  let sourcePost: {
    id: string;
    user_id: string;
    topic_id: string;
    content: string;
    is_ai_generated: boolean;
    is_visible: boolean;
    is_deleted: boolean;
    moderation_status: string;
  } | null = null;

  if (sourcePostId) {
    const { data, error } = await supabaseAdmin
      .from("forum_posts")
      .select("id, user_id, topic_id, content, is_ai_generated, is_visible, is_deleted, moderation_status")
      .eq("id", sourcePostId)
      .maybeSingle();

    if (error) {
      console.error("[forum-assistant-dispatch] source post lookup failed", error);
      return jsonResponse({ error: "Failed to load source post", code: "source_post_lookup_failed" }, 500);
    }

    sourcePost = data;
  }

  const { data: topic, error: topicError } = await supabaseAdmin
    .from("forum_topics")
    .select("id, title, slug, is_deleted, is_locked, last_ai_reply_at")
    .eq("id", topicId)
    .maybeSingle();

  if (topicError) {
    console.error("[forum-assistant-dispatch] topic lookup failed", topicError);
    return jsonResponse({ error: "Failed to load topic", code: "topic_lookup_failed" }, 500);
  }

  if (!topic) {
    return jsonResponse({ error: "Topic not found", code: "topic_not_found" }, 404);
  }

  if (topic.is_deleted || topic.is_locked) {
    return jsonResponse({ ok: true, queued: false, skipped: "topic_unavailable" });
  }

  if (
    sourcePost
    && (
      sourcePost.is_ai_generated
      || sourcePost.is_deleted
      || sourcePost.is_visible === false
      || sourcePost.moderation_status !== "allowed"
    )
  ) {
    return jsonResponse({ ok: true, queued: false, skipped: "source_post_not_eligible" });
  }

  const lastVisibleAiReplyAt = topic.last_ai_reply_at ? new Date(topic.last_ai_reply_at).getTime() : null;
  if (
    lastVisibleAiReplyAt
    && Number.isFinite(lastVisibleAiReplyAt)
    && Date.now() - lastVisibleAiReplyAt < settings.assistant.mentionCooldownHours * 60 * 60 * 1000
  ) {
    return jsonResponse({ ok: true, queued: false, skipped: "assistant_cooldown" });
  }

  const { data: lastPost, error: lastPostError } = await supabaseAdmin
    .from("forum_posts")
    .select("id, is_ai_generated")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastPostError) {
    console.error("[forum-assistant-dispatch] last post lookup failed", lastPostError);
    return jsonResponse({ error: "Failed to load topic state", code: "topic_state_failed" }, 500);
  }

  if (lastPost?.is_ai_generated) {
    return jsonResponse({ ok: true, queued: false, skipped: "last_post_already_ai" });
  }

  const rateLimitUserId = sourcePost?.user_id ?? null;
  const rateLimit = await enforceRateLimit(supabaseAdmin, rateLimitUserId, "forum_assistant_dispatch");
  if (!rateLimit.allowed) {
    if (rateLimit.code === "rate_limit_check_failed") {
      return jsonResponse({ error: "Rate limit backend unavailable", code: "rate_limit_check_failed" }, 500);
    }
    return jsonResponse({ ok: true, queued: false, skipped: "rate_limit_exceeded" }, 429);
  }

  const idempotencyKey = [topicId, sourcePostId ?? "topic", triggerType].join(":");
  let jobRow: Record<string, unknown> | null = null;

  const { data: insertedJob, error: insertError } = await supabaseAdmin
    .from("forum_assistant_jobs")
    .insert({
      topic_id: topicId,
      source_post_id: sourcePostId,
      trigger_type: triggerType,
      status: "pending",
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .maybeSingle();

  if (insertError) {
    if (insertError.code !== "23505") {
      console.error("[forum-assistant-dispatch] job insert failed", insertError);
      return jsonResponse({ error: "Failed to enqueue assistant job", code: "job_insert_failed" }, 500);
    }

    const { data: existingJob, error: existingJobError } = await supabaseAdmin
      .from("forum_assistant_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingJobError || !existingJob) {
      console.error("[forum-assistant-dispatch] failed to load existing job", existingJobError);
      return jsonResponse({ error: "Failed to load assistant job", code: "job_lookup_failed" }, 500);
    }

    jobRow = existingJob;
  } else {
    jobRow = insertedJob;
  }

  if (jobRow?.id) {
    await invokeInternalForumFunction(supabaseAdmin, "forum-assistant-worker", {
      jobId: jobRow.id,
    });
  }

  return jsonResponse({
    ok: true,
    queued: true,
    job_id: jobRow?.id ?? null,
    topic_id: topicId,
    trigger_type: triggerType,
  });
});
