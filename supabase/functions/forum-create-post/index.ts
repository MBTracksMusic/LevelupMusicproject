import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  applyReputationEvent,
  asNonEmptyString,
  buildCorsHeaders,
  containsAssistantMention,
  enforceRateLimit,
  evaluateForumContent,
  invokeInternalForumFunction,
  loadForumCategoryPolicyByTopicId,
  loadForumSettings,
  notifyForumAdmins,
  requireUser,
  resolveRequestCorsOrigin,
} from "../_shared/forumAgents.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

interface CreatePostBody {
  topic_id?: string;
  topic_slug?: string;
  category_slug?: string;
  content?: string;
}

function mapRpcError(errorMessage: string) {
  switch (errorMessage) {
    case "topic_not_found":
      return jsonResponse({ error: "Topic introuvable.", code: errorMessage }, 404);
    case "topic_deleted":
      return jsonResponse({ error: "Ce topic n'est plus disponible.", code: errorMessage }, 409);
    case "topic_write_denied":
      return jsonResponse({ error: "Impossible de publier dans ce topic.", code: errorMessage }, 403);
    default:
      return jsonResponse({ error: "Impossible de publier cette reponse.", code: "post_create_failed" }, 500);
  }
}

serveWithErrorHandling("forum-create-post", async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(resolveRequestCorsOrigin(req));
  const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  }

  const auth = await requireUser(req);
  if ("error" in auth) {
    return auth.error as Response;
  }

  const { supabaseAdmin, user } = auth;
  const body = await req.json().catch(() => null) as CreatePostBody | null;
  const explicitTopicId = asNonEmptyString(body?.topic_id);
  const topicSlug = asNonEmptyString(body?.topic_slug);
  const categorySlug = asNonEmptyString(body?.category_slug);
  const content = asNonEmptyString(body?.content);

  if ((!explicitTopicId && !topicSlug) || !content) {
    return jsonResponse({ error: "topic_id (or topic_slug) and content are required", code: "invalid_payload" }, 400);
  }

  let topicId = explicitTopicId;
  let topicTitle: string | null = null;

  if (!topicId && topicSlug) {
    let query = supabaseAdmin
      .from("forum_topics")
      .select("id, title, slug, category_id")
      .eq("slug", topicSlug)
      .limit(2);

    if (categorySlug) {
      const { data: categoryRow } = await supabaseAdmin
        .from("forum_categories")
        .select("id")
        .eq("slug", categorySlug)
        .maybeSingle();

      if (categoryRow?.id) {
        query = query.eq("category_id", categoryRow.id);
      }
    }

    const { data: topicRows, error: topicLookupError } = await query;
    if (topicLookupError) {
      console.error("[forum-create-post] topic lookup failed", topicLookupError);
      return jsonResponse({ error: "Impossible de charger le topic.", code: "topic_lookup_failed" }, 500);
    }

    if (!Array.isArray(topicRows) || topicRows.length !== 1) {
      return jsonResponse({ error: "Topic introuvable.", code: "topic_not_found" }, 404);
    }

    topicId = topicRows[0].id;
    topicTitle = topicRows[0].title;
  }

  if (!topicId) {
    return jsonResponse({ error: "Topic introuvable.", code: "topic_not_found" }, 404);
  }

  if (!topicTitle) {
    const { data: topicRow, error: topicError } = await supabaseAdmin
      .from("forum_topics")
      .select("id, title")
      .eq("id", topicId)
      .maybeSingle();

    if (topicError || !topicRow) {
      console.error("[forum-create-post] topic fetch failed", topicError);
      return jsonResponse({ error: "Topic introuvable.", code: "topic_not_found" }, 404);
    }

    topicTitle = topicRow.title;
  }

  const rateLimit = await enforceRateLimit(supabaseAdmin, user.id, "forum_create_post");
  if (!rateLimit.allowed) {
    if (rateLimit.code === "rate_limit_check_failed") {
      return jsonResponse({ error: "Service temporairement indisponible.", code: "rate_limit_check_failed" }, 500);
    }
    return jsonResponse({ error: "Trop de tentatives. Reessayez dans une minute.", code: "rate_limit_exceeded" }, 429);
  }

  const settings = await loadForumSettings(supabaseAdmin);
  const categoryPolicy = await loadForumCategoryPolicyByTopicId(supabaseAdmin, topicId);
  const moderation = await evaluateForumContent({
    content,
    title: topicTitle,
    settings,
    categoryPolicy,
  });

  if (moderation.decision === "blocked") {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "moderation_blocked",
      metadata: {
        operation: "forum_create_post",
        topic_id: topicId,
        category_id: categoryPolicy?.id ?? null,
        category_slug: categoryPolicy?.slug ?? categorySlug ?? null,
        xp_multiplier: categoryPolicy?.xpMultiplier ?? 1,
      },
    });

    return jsonResponse(
      {
        error: "Contenu refuse.",
        code: "blocked",
        moderation: {
          status: moderation.decision,
          score: moderation.score,
          reason: moderation.reason,
        },
      },
      400,
    );
  }

  const { data, error } = await supabaseAdmin.rpc("rpc_forum_create_post", {
    p_user_id: user.id,
    p_topic_id: topicId,
    p_content: content,
    p_source: "forum-create-post",
    p_moderation_status: moderation.decision,
    p_is_visible: moderation.isVisible,
    p_is_flagged: moderation.isFlagged,
    p_moderation_score: moderation.score,
    p_moderation_reason: moderation.reason,
    p_moderation_model: moderation.model,
    p_is_ai_generated: false,
    p_ai_agent_name: null,
    p_source_post_id: null,
    p_raw_response: moderation.rawResponse,
  });

  if (error) {
    console.error("[forum-create-post] rpc_forum_create_post failed", error);
    return mapRpcError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.post_id) {
    return jsonResponse({ error: "Post creation returned no data", code: "post_create_failed" }, 500);
  }

  if (moderation.decision === "review") {
    await notifyForumAdmins(supabaseAdmin, {
      forum_post_id: row.post_id,
      forum_topic_id: row.topic_id ?? topicId,
      forum_category_slug: row.category_slug ?? categorySlug,
      moderation_status: moderation.decision,
      score: moderation.score,
      reason: moderation.reason,
      source: "forum-create-post",
    });
  }

  if (moderation.decision === "allowed") {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "forum_post_created",
      entityType: "forum_post",
      entityId: row.post_id,
      metadata: {
        topic_id: row.topic_id ?? topicId,
        post_id: row.post_id,
        category_id: categoryPolicy?.id ?? null,
        category_slug: row.category_slug ?? categoryPolicy?.slug ?? categorySlug ?? null,
        xp_multiplier: categoryPolicy?.xpMultiplier ?? 1,
      },
      idempotencyKey: `forum_post_created:${row.post_id}`,
    });
  } else {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "moderation_review",
      entityType: "forum_post",
      entityId: row.post_id,
      metadata: {
        operation: "forum_create_post",
        topic_id: row.topic_id ?? topicId,
        post_id: row.post_id,
        category_id: categoryPolicy?.id ?? null,
        category_slug: row.category_slug ?? categoryPolicy?.slug ?? categorySlug ?? null,
        xp_multiplier: categoryPolicy?.xpMultiplier ?? 1,
      },
      idempotencyKey: `forum_review:${row.post_id}`,
    });
  }

  if (moderation.decision === "allowed" && containsAssistantMention(content)) {
    await invokeInternalForumFunction(supabaseAdmin, "forum-assistant-dispatch", {
      topicId: row.topic_id ?? topicId,
      sourcePostId: row.post_id,
      triggerType: "mention",
    });
  }

  return jsonResponse({
    ok: true,
    status: moderation.decision,
    post_id: row.post_id,
    topic_id: row.topic_id ?? topicId,
    topic_slug: row.topic_slug ?? topicSlug,
    category_slug: row.category_slug ?? categorySlug,
    moderation_score: moderation.score,
    moderation_reason: moderation.reason,
  });
});
