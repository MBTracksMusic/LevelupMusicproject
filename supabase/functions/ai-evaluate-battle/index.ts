import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const ALLOWED_CORS_ORIGINS = (() => {
  const allowed = new Set<string>(DEFAULT_ALLOWED_CORS_ORIGINS);
  const csv = Deno.env.get("CORS_ALLOWED_ORIGINS");
  if (typeof csv === "string" && csv.trim().length > 0) {
    for (const token of csv.split(",")) {
      const n = normalizeOrigin(token.trim());
      if (n) allowed.add(n);
    }
  }
  return allowed;
})();

const buildCorsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin ?? DEFAULT_ALLOWED_CORS_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Vary": "Origin",
});

const resolveRequestCorsOrigin = (req: Request): string | null => {
  const raw = req.headers.get("origin");
  if (!raw) return null;
  const n = normalizeOrigin(raw);
  return n && ALLOWED_CORS_ORIGINS.has(n) ? n : null;
};

interface EvaluateBattleRequest {
  battleId: string;
}

interface ProducerSnapshot {
  id: string;
  username: string | null;
  battle_refusal_count: number;
  engagement_score: number;
  battles_participated: number;
  battles_completed: number;
}

interface BattleSnapshot {
  id: string;
  title: string;
  status: string;
  battle_type: "user" | "admin" | string;
  producer1_id: string;
  producer2_id: string | null;
  product1_id: string | null;
  product2_id: string | null;
  created_at: string;
  producer1: ProducerSnapshot | null;
  producer2: ProducerSnapshot | null;
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

function evaluateBattleRuleBased(battle: BattleSnapshot) {
  const reasons: string[] = [];
  let actionType: "battle_validate" | "battle_cancel" = "battle_validate";
  let confidence = 0.84;

  if (battle.status !== "awaiting_admin") {
    actionType = "battle_cancel";
    confidence = 0.66;
    reasons.push("status_not_awaiting_admin");
  }

  if (!battle.producer2_id) {
    actionType = "battle_cancel";
    confidence = 0.99;
    reasons.push("missing_producer2");
  }

  if (!battle.product1_id || !battle.product2_id) {
    actionType = "battle_cancel";
    confidence = Math.max(confidence, 0.98);
    reasons.push("missing_submission_product");
  }

  if (battle.producer2 && battle.producer2.battle_refusal_count >= 8) {
    if (actionType === "battle_validate") {
      actionType = "battle_cancel";
    }
    confidence = Math.max(confidence, 0.79);
    reasons.push("high_refusal_history_producer2");
  }

  if (actionType === "battle_validate") {
    const engagement = battle.producer2?.engagement_score ?? 0;
    if (engagement < -5) {
      confidence = 0.72;
      reasons.push("low_engagement_score_producer2");
    } else if (engagement >= 10) {
      confidence = 0.90;
      reasons.push("strong_engagement_score_producer2");
    } else {
      confidence = 0.86;
      reasons.push("battle_ready_default_validate");
    }
  }

  const recommendedRpc = actionType === "battle_validate" ? "admin_validate_battle" : "admin_cancel_battle";
  const autoThreshold = 0.98;

  return {
    actionType,
    confidence,
    recommendedRpc,
    autoEligible: confidence >= autoThreshold,
    autoThreshold,
    reasons,
  };
}

serveWithErrorHandling("ai-evaluate-battle", async (req: Request) => {
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
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  const authorizationHeader = req.headers.get("Authorization");
  if (!authorizationHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: isAdmin, error: isAdminError } = await supabase.rpc("is_admin", { p_user_id: user.id });
  if (isAdminError || isAdmin !== true) {
    return jsonResponse({ error: "Admin required" }, 403);
  }

  let body: EvaluateBattleRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const battleId = asNonEmptyString(body.battleId);
  if (!battleId) {
    return jsonResponse({ error: "battleId is required" }, 400);
  }

  const { data: battleData, error: battleError } = await supabase
    .from("battles")
    .select(`
      id,
      title,
      status,
      battle_type,
      producer1_id,
      producer2_id,
      product1_id,
      product2_id,
      created_at,
      producer1:user_profiles!battles_producer1_id_fkey(
        id,
        username,
        battle_refusal_count,
        engagement_score,
        battles_participated,
        battles_completed
      ),
      producer2:user_profiles!battles_producer2_id_fkey(
        id,
        username,
        battle_refusal_count,
        engagement_score,
        battles_participated,
        battles_completed
      )
    `)
    .eq("id", battleId)
    .maybeSingle();

  if (battleError) {
    return jsonResponse({ error: battleError.message }, 500);
  }

  const battle = battleData as BattleSnapshot | null;
  if (!battle) {
    return jsonResponse({ error: "Battle not found" }, 404);
  }

  const recommendation = evaluateBattleRuleBased(battle);

  const aiDecision = {
    model: "rule-based-battle-v1",
    recommendation: recommendation.actionType,
    recommended_rpc: recommendation.recommendedRpc,
    confidence_score: recommendation.confidence,
    auto_threshold: recommendation.autoThreshold,
    auto_eligible: recommendation.autoEligible,
    reasons: recommendation.reasons,
    battle_snapshot: {
      id: battle.id,
      status: battle.status,
      battle_type: battle.battle_type,
      producer1_id: battle.producer1_id,
      producer2_id: battle.producer2_id,
      product1_id: battle.product1_id,
      product2_id: battle.product2_id,
      producer2_refusal_count: battle.producer2?.battle_refusal_count ?? null,
      producer2_engagement_score: battle.producer2?.engagement_score ?? null,
    },
    evaluated_at: new Date().toISOString(),
    evaluated_by: user.id,
  };

  const { data: actionRow, error: insertError } = await supabase
    .from("ai_admin_actions")
    .insert({
      action_type: recommendation.actionType,
      entity_type: "battle",
      entity_id: battle.id,
      ai_decision: aiDecision,
      confidence_score: recommendation.confidence,
      reason: recommendation.reasons.join(",") || "rule_based_evaluation",
      status: "proposed",
      human_override: false,
      reversible: true,
      executed_by: null,
    })
    .select("id, action_type, entity_id, confidence_score, status, ai_decision, created_at")
    .single();

  if (insertError) {
    return jsonResponse({ error: insertError.message }, 500);
  }

  return jsonResponse({
    ok: true,
    action: actionRow,
  });
});
