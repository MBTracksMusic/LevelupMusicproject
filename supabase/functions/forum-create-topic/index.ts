import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  applyReputationEvent,
  asNonEmptyString,
  buildCorsHeaders,
  containsAssistantMention,
  enforceRateLimit,
  evaluateForumContent,
  invokeInternalForumFunction,
  loadForumCategoryPolicyBySlug,
  loadForumSettings,
  notifyForumAdmins,
  requireUser,
  resolveRequestCorsOrigin,
  slugify,
} from "../_shared/forumAgents.ts";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

interface CreateTopicBody {
  category_slug?: string;
  title?: string;
  content?: string;
}

function mapRpcError(errorMessage: string) {
  switch (errorMessage) {
    case "category_not_found":
      return jsonResponse({ error: "Categorie introuvable.", code: errorMessage }, 404);
    case "category_access_denied":
      return jsonResponse({ error: "Acces refuse a cette categorie.", code: errorMessage }, 403);
    default:
      return jsonResponse({ error: "Impossible de creer ce topic.", code: "topic_create_failed" }, 500);
  }
}

serveWithErrorHandling("forum-create-topic", async (req: Request): Promise<Response> => {
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
  const body = await req.json().catch(() => null) as CreateTopicBody | null;

  const categorySlug = asNonEmptyString(body?.category_slug);
  const title = asNonEmptyString(body?.title);
  const content = asNonEmptyString(body?.content);

  if (!categorySlug || !title || !content) {
    return jsonResponse({ error: "category_slug, title and content are required", code: "invalid_payload" }, 400);
  }

  const rateLimit = await enforceRateLimit(supabaseAdmin, user.id, "forum_create_topic");
  if (!rateLimit.allowed) {
    if (rateLimit.code === "rate_limit_check_failed") {
      return jsonResponse({ error: "Service temporairement indisponible.", code: "rate_limit_check_failed" }, 500);
    }
    return jsonResponse({ error: "Trop de tentatives. Reessayez dans une minute.", code: "rate_limit_exceeded" }, 429);
  }

  const settings = await loadForumSettings(supabaseAdmin);
  const categoryPolicy = await loadForumCategoryPolicyBySlug(supabaseAdmin, categorySlug);
  const moderation = await evaluateForumContent({
    content,
    title,
    settings,
    categoryPolicy,
  });

  if (moderation.decision === "blocked") {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "moderation_blocked",
      metadata: {
        operation: "forum_create_topic",
        category_slug: categorySlug,
        category_id: categoryPolicy?.id ?? null,
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

  const slugBase = slugify(title) || "topic";
  const topicSlug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await supabaseAdmin.rpc("rpc_forum_create_topic", {
    p_user_id: user.id,
    p_category_slug: categorySlug,
    p_title: title,
    p_topic_slug: topicSlug,
    p_content: content,
    p_source: "forum-create-topic",
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
    console.error("[forum-create-topic] rpc_forum_create_topic failed", error);
    return mapRpcError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.topic_id || !row?.post_id) {
    return jsonResponse({ error: "Topic creation returned no data", code: "topic_create_failed" }, 500);
  }

  if (moderation.decision === "review") {
    await notifyForumAdmins(supabaseAdmin, {
      forum_post_id: row.post_id,
      forum_topic_id: row.topic_id,
      forum_category_slug: row.category_slug ?? categorySlug,
      moderation_status: moderation.decision,
      score: moderation.score,
      reason: moderation.reason,
      source: "forum-create-topic",
    });
  }

  if (moderation.decision === "allowed") {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "forum_topic_created",
      entityType: "forum_topic",
      entityId: row.topic_id,
      metadata: {
        topic_id: row.topic_id,
        post_id: row.post_id,
        category_id: row.category_id ?? categoryPolicy?.id ?? null,
        category_slug: row.category_slug ?? categorySlug,
        xp_multiplier: categoryPolicy?.xpMultiplier ?? 1,
      },
      idempotencyKey: `forum_topic_created:${row.topic_id}`,
    });
  } else {
    await applyReputationEvent(supabaseAdmin, {
      userId: user.id,
      source: "forum",
      eventType: "moderation_review",
      entityType: "forum_post",
      entityId: row.post_id,
      metadata: {
        operation: "forum_create_topic",
        topic_id: row.topic_id,
        post_id: row.post_id,
        category_id: row.category_id ?? categoryPolicy?.id ?? null,
        category_slug: row.category_slug ?? categorySlug,
        xp_multiplier: categoryPolicy?.xpMultiplier ?? 1,
      },
      idempotencyKey: `forum_review:${row.post_id}`,
    });
  }

  if (moderation.decision === "allowed" && containsAssistantMention(content)) {
    await invokeInternalForumFunction(supabaseAdmin, "forum-assistant-dispatch", {
      topicId: row.topic_id,
      sourcePostId: row.post_id,
      triggerType: "mention",
    });
  }

  return jsonResponse({
    ok: true,
    status: moderation.decision,
    topic_id: row.topic_id,
    topic_slug: row.topic_slug ?? topicSlug,
    category_slug: row.category_slug ?? categorySlug,
    post_id: row.post_id,
    moderation_score: moderation.score,
    moderation_reason: moderation.reason,
  });
});
