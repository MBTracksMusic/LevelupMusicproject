import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-supabase-auth",
};

interface ModerateCommentRequest {
  commentId: string;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

function classifyCommentRuleBased(content: string) {
  const text = content.toLowerCase();
  const toxicKeywords = ["kill yourself", "kys", "nazi", "racist", "slur", "fdp", "pute", "connard", "encule"];
  const spamKeywords = ["buy followers", "free money", "dm me", "telegram", "whatsapp", "crypto giveaway", "promo code"];
  const borderlineKeywords = ["nul", "naze", "trash", "horrible", "hate", "stupid", "idiot"];

  const toxicHits = toxicKeywords.filter((k) => text.includes(k)).length;
  const spamHits = spamKeywords.filter((k) => text.includes(k)).length;
  const borderlineHits = borderlineKeywords.filter((k) => text.includes(k)).length;
  const hasLink = /https?:\/\/|www\./i.test(text);

  let classification: "safe" | "borderline" | "toxic" | "spam" = "safe";
  let score = 0.05;
  let reason = "no_signal";

  if (!text.trim()) {
    classification = "spam";
    score = 0.99;
    reason = "empty_comment";
  } else if (toxicHits > 0) {
    classification = "toxic";
    score = Math.min(1, 0.94 + toxicHits * 0.03);
    reason = "toxic_keyword_match";
  } else if (spamHits > 0 || (hasLink && text.length <= 40)) {
    classification = "spam";
    score = spamHits > 1 || (hasLink && text.length <= 20) ? 0.97 : 0.91;
    reason = "spam_signal_match";
  } else if (borderlineHits > 0) {
    classification = "borderline";
    score = Math.min(0.89, 0.62 + borderlineHits * 0.07);
    reason = "borderline_toxicity_signal";
  }

  const suggestedAction = classification === "safe"
    ? "allow"
    : score >= 0.95 && (classification === "toxic" || classification === "spam")
    ? "hide"
    : "review";

  return {
    model: "rule-based-comment-v1",
    classification,
    score,
    reason,
    suggested_action: suggestedAction,
    auto_threshold: 0.95,
    flags: {
      toxic_hits: toxicHits,
      spam_hits: spamHits,
      borderline_hits: borderlineHits,
      has_link: hasLink,
    },
    analyzed_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  const authorizationHeader = req.headers.get("Authorization") || req.headers.get("x-supabase-auth");
  const jwt = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(jwt);

  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: isAdmin, error: isAdminError } = await supabase.rpc("is_admin", { p_user_id: user.id });
  if (isAdminError || isAdmin !== true) {
    return jsonResponse({ error: "Admin required" }, 403);
  }

  let body: ModerateCommentRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const commentId = asNonEmptyString(body.commentId);
  if (!commentId) {
    return jsonResponse({ error: "commentId is required" }, 400);
  }

  const { data: commentData, error: commentError } = await supabase
    .from("battle_comments")
    .select("id, content, is_hidden")
    .eq("id", commentId)
    .maybeSingle();

  if (commentError) {
    return jsonResponse({ error: commentError.message }, 500);
  }

  if (!commentData) {
    return jsonResponse({ error: "Comment not found" }, 404);
  }

  const decision = classifyCommentRuleBased(commentData.content || "");

  const { data: actionRow, error: actionError } = await supabase
    .from("ai_admin_actions")
    .insert({
      action_type: "comment_moderation",
      entity_type: "comment",
      entity_id: commentData.id,
      ai_decision: decision,
      confidence_score: decision.score,
      reason: decision.reason,
      status: "proposed",
      human_override: false,
      reversible: true,
      executed_by: null,
    })
    .select("id, status, ai_decision, confidence_score, action_type, entity_id")
    .single();

  if (actionError) {
    return jsonResponse({ error: actionError.message }, 500);
  }

  let autoExecuted = false;

  if ((decision.classification === "toxic" || decision.classification === "spam") && decision.score >= 0.95) {
    const { error: hideError } = await supabase
      .from("battle_comments")
      .update({
        is_hidden: true,
        hidden_reason: "auto_moderated",
      })
      .eq("id", commentData.id)
      .eq("is_hidden", false);

    if (hideError) {
      await supabase
        .from("ai_admin_actions")
        .update({
          status: "failed",
          error: hideError.message,
          executed_at: new Date().toISOString(),
        })
        .eq("id", actionRow.id);

      return jsonResponse({ error: hideError.message }, 500);
    }

    autoExecuted = true;

    await supabase
      .from("ai_admin_actions")
      .update({
        status: "executed",
        reason: "Auto-moderated by Edge Function",
        executed_at: new Date().toISOString(),
        ai_decision: {
          ...decision,
          applied_action: "hide",
          applied_hidden_reason: "auto_moderated",
        },
      })
      .eq("id", actionRow.id);
  }

  return jsonResponse({
    ok: true,
    action_id: actionRow.id,
    auto_executed: autoExecuted,
    decision,
  });
});
