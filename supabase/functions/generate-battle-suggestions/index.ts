import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ApiError, serveWithErrorHandling } from "../_shared/error-handler.ts";

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
];

const DEFAULT_MODEL = "gpt-5-mini";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 8;

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
      const normalized = normalizeOrigin(token.trim());
      if (normalized) {
        allowed.add(normalized);
      }
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
  const normalized = normalizeOrigin(raw);
  return normalized && ALLOWED_CORS_ORIGINS.has(normalized) ? normalized : null;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface GenerateSuggestionsRequest {
  limit?: number;
}

interface ProfileSnapshot {
  id: string;
  username: string | null;
  producer_tier: string | null;
  elo_rating: number;
  engagement_score: number;
  battle_wins: number;
  battle_losses: number;
  battle_draws: number;
  battles_participated: number;
  battles_completed: number;
  bio: string | null;
  language: string | null;
}

interface ProductSnapshot {
  id: string;
  producer_id: string;
  title: string;
  genre_id: string | null;
  mood_id: string | null;
  tags: string[] | null;
  created_at: string;
  genre?: { name: string | null } | null;
  mood?: { name: string | null } | null;
}

interface CandidateSuggestion {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  producer_tier: string | null;
  elo_rating: number;
  battle_wins: number;
  battle_losses: number;
  battle_draws: number;
  elo_diff: number;
  score: number | null;
  reason: string | null;
  source: "ai" | "fallback_sql";
}

function extractResponseText(payload: Record<string, unknown> | null) {
  if (!payload) return null;

  const directText = asNonEmptyString(payload.output_text);
  if (directText) return directText;

  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const chunk of content) {
      const text = asNonEmptyString(chunk.text);
      if (text) return text;
    }
  }

  return null;
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

function summarizeProducts(products: ProductSnapshot[]) {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    genre: product.genre?.name ?? null,
    mood: product.mood?.name ?? null,
    tags: Array.isArray(product.tags) ? product.tags.slice(0, 6) : [],
    created_at: product.created_at,
  }));
}

function buildFallbackSuggestions(
  candidates: Array<Omit<CandidateSuggestion, "score" | "reason" | "source">>,
  limit: number,
): CandidateSuggestion[] {
  return candidates
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      score: Math.max(0, 100 - candidate.elo_diff - (index * 2)),
      reason: "Fallback SQL matchmaking based on ELO proximity and active producer filters.",
      source: "fallback_sql",
    }));
}

async function persistSuggestions(
  supabase: ReturnType<typeof createClient<any>>,
  requestId: string,
  requesterId: string,
  suggestions: CandidateSuggestion[],
  payload: Record<string, unknown>,
) {
  if (suggestions.length === 0) return;

  const rows = suggestions.map((suggestion, index) => ({
    request_id: requestId,
    requester_id: requesterId,
    candidate_user_id: suggestion.user_id,
    suggestion_source: suggestion.source,
    model_name: suggestion.source === "ai"
      ? (asNonEmptyString(payload.model) ?? DEFAULT_MODEL)
      : "fallback-sql-matchmaking-v1",
    rank_position: index + 1,
    score: suggestion.score,
    reason: suggestion.reason,
    request_payload: payload,
  }));

  const { error } = await (supabase.from("battle_suggestions") as any).insert(rows);
  if (error) {
    console.error("[generate-battle-suggestions] failed to persist suggestions", error);
  }
}

function normalizeProductRows(rows: Array<Record<string, unknown>> | null | undefined): ProductSnapshot[] {
  return (rows ?? []).map((row) => {
    const genreValue = Array.isArray(row.genre) ? row.genre[0] : row.genre;
    const moodValue = Array.isArray(row.mood) ? row.mood[0] : row.mood;

    return {
      id: String(row.id),
      producer_id: String(row.producer_id),
      title: String(row.title ?? ""),
      genre_id: asNonEmptyString(row.genre_id),
      mood_id: asNonEmptyString(row.mood_id),
      tags: Array.isArray(row.tags) ? row.tags.filter((value): value is string => typeof value === "string") : null,
      created_at: String(row.created_at ?? new Date(0).toISOString()),
      genre: genreValue && typeof genreValue === "object"
        ? { name: asNonEmptyString((genreValue as Record<string, unknown>).name) }
        : null,
      mood: moodValue && typeof moodValue === "object"
        ? { name: asNonEmptyString((moodValue as Record<string, unknown>).name) }
        : null,
    };
  });
}

async function callOpenAiSuggestions(params: {
  actor: ProfileSnapshot;
  actorProducts: ProductSnapshot[];
  candidates: Array<Omit<CandidateSuggestion, "score" | "reason" | "source">>;
  candidateProductsByProducerId: Map<string, ProductSnapshot[]>;
  limit: number;
}) {
  const apiKey = asNonEmptyString(Deno.env.get("OPENAI_API_KEY"));
  if (!apiKey) {
    return null;
  }

  const model = asNonEmptyString(Deno.env.get("BATTLE_SUGGESTIONS_MODEL")) ?? DEFAULT_MODEL;

  const systemPrompt = [
    "You rank fair and engaging music battle opponents for a producer platform.",
    "Return JSON only.",
    "Prioritize fairness, compatible style, engagement likelihood, and battle quality.",
    "Never invent opponents outside the provided list.",
    "Keep reasons short, concrete, and based on the provided data only.",
  ].join(" ");

  const userPrompt = JSON.stringify({
    task: "Rank the best battle opponents for the requesting producer.",
    limit: params.limit,
    requester: {
      id: params.actor.id,
      username: params.actor.username,
      producer_tier: params.actor.producer_tier,
      elo_rating: params.actor.elo_rating,
      engagement_score: params.actor.engagement_score,
      battle_record: {
        wins: params.actor.battle_wins,
        losses: params.actor.battle_losses,
        draws: params.actor.battle_draws,
        participated: params.actor.battles_participated,
        completed: params.actor.battles_completed,
      },
      bio: params.actor.bio,
      language: params.actor.language,
      recent_products: summarizeProducts(params.actorProducts),
    },
    candidates: params.candidates.map((candidate) => ({
      id: candidate.user_id,
      username: candidate.username,
      producer_tier: candidate.producer_tier,
      elo_rating: candidate.elo_rating,
      elo_diff: candidate.elo_diff,
      engagement_score: null,
      battle_record: {
        wins: candidate.battle_wins,
        losses: candidate.battle_losses,
        draws: candidate.battle_draws,
      },
      recent_products: summarizeProducts(params.candidateProductsByProducerId.get(candidate.user_id) ?? []),
    })),
    output_schema: {
      suggestions: [
        {
          opponent_id: "uuid",
          score: "number between 0 and 100",
          reason: "short explanation",
        },
      ],
    },
  });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        max_output_tokens: 900,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[generate-battle-suggestions] OpenAI response API failed", response.status, body);
      return null;
    }

    const payload = await response.json() as Record<string, unknown>;
    const parsed = parseJsonObject(extractResponseText(payload));
    if (!parsed) {
      console.error("[generate-battle-suggestions] OpenAI payload was not valid JSON");
      return null;
    }

    return {
      model,
      payload,
      parsed,
    };
  } catch (error) {
    console.error("[generate-battle-suggestions] OpenAI request failed", error);
    return null;
  }
}

serveWithErrorHandling("generate-battle-suggestions", async (req: Request) => {
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
    throw new ApiError(405, "method_not_allowed", "Method not allowed");
  }

  const supabaseUrl = asNonEmptyString(Deno.env.get("SUPABASE_URL"));
  const serviceRoleKey = asNonEmptyString(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const anonKey = asNonEmptyString(Deno.env.get("SUPABASE_ANON_KEY"));

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new ApiError(500, "server_not_configured", "Missing Supabase runtime configuration");
  }

  const authorizationHeader = req.headers.get("Authorization");
  if (!authorizationHeader) {
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
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
    throw new ApiError(401, "unauthorized", "Unauthorized");
  }

  let body: GenerateSuggestionsRequest = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(asFiniteNumber(body.limit) ?? DEFAULT_LIMIT)));
  const requestId = crypto.randomUUID();

  const { data: actorProfile, error: actorError } = await supabaseAdmin
    .from("user_profiles")
    .select(`
      id,
      username,
      producer_tier,
      elo_rating,
      engagement_score,
      battle_wins,
      battle_losses,
      battle_draws,
      battles_participated,
      battles_completed,
      bio,
      language
    `)
    .eq("id", user.id)
    .eq("is_producer_active", true)
    .maybeSingle();

  if (actorError) {
    throw new ApiError(500, "profile_load_failed", actorError.message);
  }

  if (!actorProfile) {
    throw new ApiError(403, "producer_required", "Active producer profile required");
  }

  const { data: actorProductsData, error: actorProductsError } = await supabaseAdmin
    .from("products")
    .select(`
      id,
      producer_id,
      title,
      genre_id,
      mood_id,
      tags,
      created_at,
      genre:genres(name),
      mood:moods(name)
    `)
    .eq("producer_id", user.id)
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(3);

  if (actorProductsError) {
    throw new ApiError(500, "products_load_failed", actorProductsError.message);
  }

  const { data: candidateRows, error: candidateError } = await supabaseAdmin.rpc("suggest_opponents", {
    p_user_id: user.id,
  });

  if (candidateError) {
    throw new ApiError(500, "candidate_load_failed", candidateError.message);
  }

  const candidates = ((candidateRows as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    user_id: String(row.user_id),
    username: asNonEmptyString(row.username),
    avatar_url: asNonEmptyString(row.avatar_url),
    producer_tier: asNonEmptyString(row.producer_tier),
    elo_rating: asFiniteNumber(row.elo_rating) ?? 1200,
    battle_wins: asFiniteNumber(row.battle_wins) ?? 0,
    battle_losses: asFiniteNumber(row.battle_losses) ?? 0,
    battle_draws: asFiniteNumber(row.battle_draws) ?? 0,
    elo_diff: asFiniteNumber(row.elo_diff) ?? 0,
  }));

  if (candidates.length === 0) {
    return jsonResponse({
      ok: true,
      request_id: requestId,
      source: "fallback_sql",
      suggestions: [],
    });
  }

  const candidateIds = candidates.map((candidate) => candidate.user_id);
  const { data: candidateProductsData, error: candidateProductsError } = await supabaseAdmin
    .from("products")
    .select(`
      id,
      producer_id,
      title,
      genre_id,
      mood_id,
      tags,
      created_at,
      genre:genres(name),
      mood:moods(name)
    `)
    .in("producer_id", candidateIds)
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (candidateProductsError) {
    throw new ApiError(500, "candidate_products_load_failed", candidateProductsError.message);
  }

  const actorProducts = normalizeProductRows(actorProductsData as Array<Record<string, unknown>> | null);
  const candidateProducts = normalizeProductRows(candidateProductsData as Array<Record<string, unknown>> | null);

  const candidateProductsByProducerId = new Map<string, ProductSnapshot[]>();
  for (const row of candidateProducts) {
    const list = candidateProductsByProducerId.get(row.producer_id) ?? [];
    if (list.length < 2) {
      list.push(row);
      candidateProductsByProducerId.set(row.producer_id, list);
    }
  }

  const fallbackSuggestions = buildFallbackSuggestions(candidates, limit);
  const aiResult = await callOpenAiSuggestions({
    actor: actorProfile as ProfileSnapshot,
    actorProducts,
    candidates,
    candidateProductsByProducerId,
    limit,
  });

  let suggestions = fallbackSuggestions;
  let source: "ai" | "fallback_sql" = "fallback_sql";
  let model = "fallback-sql-matchmaking-v1";

  if (aiResult) {
    const rawSuggestions = Array.isArray(aiResult.parsed.suggestions)
      ? aiResult.parsed.suggestions as Array<Record<string, unknown>>
      : [];
    const candidateMap = new Map(candidates.map((candidate) => [candidate.user_id, candidate]));
    const seen = new Set<string>();
    const parsedSuggestions: CandidateSuggestion[] = [];

    for (const item of rawSuggestions) {
      const opponentId = asNonEmptyString(item.opponent_id);
      if (!opponentId || seen.has(opponentId) || !candidateMap.has(opponentId)) continue;
      seen.add(opponentId);

      const candidate = candidateMap.get(opponentId)!;
      parsedSuggestions.push({
        ...candidate,
        score: Math.max(0, Math.min(100, asFiniteNumber(item.score) ?? 0)),
        reason: asNonEmptyString(item.reason),
        source: "ai",
      });
    }

    if (parsedSuggestions.length > 0) {
      suggestions = parsedSuggestions.slice(0, limit);
      source = "ai";
      model = aiResult.model;
    }
  }

  const payload = {
    source,
    model,
    actor_id: user.id,
    candidate_count: candidates.length,
    request_id: requestId,
  };

  await persistSuggestions(supabaseAdmin, requestId, user.id, suggestions, payload);

  return jsonResponse({
    ok: true,
    request_id: requestId,
    source,
    model,
    suggestions,
  });
});
