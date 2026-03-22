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
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_MAX_RETRY_ATTEMPTS = 2;

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
  role: "producer" | "admin" | "confirmed_user" | "user" | "visitor";
  elo_rating: number;
  battle_wins: number;
  battle_losses: number;
  battle_draws: number;
  elo_diff: number;
  ai_score: number | null;
  elo_score: number | null;
  final_score: number | null;
  score: number | null;
  reason: string | null;
  source: "ai" | "hybrid" | "sql";
}

type SuggestionMode = "ai_only" | "hybrid" | "sql_only";

interface BattleSuggestionSettings {
  enabled: boolean;
  mode: SuggestionMode;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeader(headers: Headers, key: string) {
  const value = headers.get(key);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function extractRateLimitMetadata(headers: Headers) {
  return {
    request_id: readHeader(headers, "x-request-id"),
    retry_after: readHeader(headers, "retry-after"),
    ratelimit_limit_requests: readHeader(headers, "x-ratelimit-limit-requests"),
    ratelimit_limit_tokens: readHeader(headers, "x-ratelimit-limit-tokens"),
    ratelimit_remaining_requests: readHeader(headers, "x-ratelimit-remaining-requests"),
    ratelimit_remaining_tokens: readHeader(headers, "x-ratelimit-remaining-tokens"),
    ratelimit_reset_requests: readHeader(headers, "x-ratelimit-reset-requests"),
    ratelimit_reset_tokens: readHeader(headers, "x-ratelimit-reset-tokens"),
  };
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const absoluteTs = Date.parse(value);
  if (Number.isFinite(absoluteTs)) {
    return Math.max(0, absoluteTs - Date.now());
  }

  return null;
}

function buildFallbackSuggestions(
  candidates: Array<Omit<CandidateSuggestion, "ai_score" | "elo_score" | "final_score" | "score" | "reason" | "source">>,
  limit: number,
): CandidateSuggestion[] {
  return candidates
    .slice(0, limit)
    .map((candidate, index) => {
      const eloScore = Math.max(0, Math.min(1, (100 - candidate.elo_diff - (index * 2)) / 100));
      const finalScore = eloScore;

      return {
        ...candidate,
        ai_score: null,
        elo_score: eloScore,
        final_score: finalScore,
        score: Math.round(finalScore * 100),
        reason: "SQL matchmaking based on ELO proximity and active producer filters.",
        source: "sql",
      };
    });
}

function parseSuggestionSettings(value: unknown): BattleSuggestionSettings {
  const defaults: BattleSuggestionSettings = {
    enabled: true,
    mode: "hybrid",
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  const enabled = typeof record.enabled === "boolean" ? record.enabled : defaults.enabled;
  const mode = asNonEmptyString(record.mode);

  if (mode === "ai_only" || mode === "hybrid" || mode === "sql_only") {
    return { enabled, mode };
  }

  return { enabled, mode: defaults.mode };
}

async function loadSuggestionSettings(
  supabase: ReturnType<typeof createClient<any>>,
): Promise<BattleSuggestionSettings> {
  const { data, error } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "ai_battle_suggestions")
    .maybeSingle();

  if (error) {
    console.error("[generate-battle-suggestions] failed to load ai_battle_suggestions settings", error);
    return { enabled: true, mode: "hybrid" };
  }

  return parseSuggestionSettings(data?.value);
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
    model_name: suggestion.source === "ai" || suggestion.source === "hybrid"
      ? (asNonEmptyString(payload.model) ?? DEFAULT_MODEL)
      : "fallback-sql-matchmaking-v1",
    rank_position: index + 1,
    score: suggestion.score,
    ai_score: suggestion.ai_score,
    elo_score: suggestion.elo_score,
    final_score: suggestion.final_score,
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
  candidates: Array<Omit<CandidateSuggestion, "ai_score" | "elo_score" | "final_score" | "score" | "reason" | "source">>;
  candidateProductsByProducerId: Map<string, ProductSnapshot[]>;
  limit: number;
}) {
  const apiKey = asNonEmptyString(Deno.env.get("OPENAI_API_KEY"));
  if (!apiKey) {
    return {
      ok: false as const,
      stage: "missing_api_key",
      message: "OPENAI_API_KEY is not configured",
    };
  }

  const model = asNonEmptyString(Deno.env.get("BATTLE_SUGGESTIONS_MODEL")) ?? DEFAULT_MODEL;

  const systemPrompt = [
    "You rank fair and engaging music battle opponents for a producer platform.",
    "Return a single JSON object only.",
    "The JSON object must contain a top-level 'suggestions' array.",
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

  const requestBody = {
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
    text: {
      format: {
        type: "json_object",
      },
    },
    max_output_tokens: 900,
  };

  const requestBodyJson = JSON.stringify(requestBody);
  const promptMetrics = {
    endpoint: OPENAI_RESPONSES_ENDPOINT,
    model,
    max_output_tokens: 900,
    payload_bytes: new TextEncoder().encode(requestBodyJson).length,
    candidate_count: params.candidates.length,
    actor_product_count: params.actorProducts.length,
  };

  try {
    for (let attempt = 1; attempt <= OPENAI_MAX_RETRY_ATTEMPTS; attempt += 1) {
      const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBodyJson,
      });

      const rateLimit = extractRateLimitMetadata(response.headers);

      if (!response.ok) {
        const body = await response.text();
        const retryAfterMs = parseRetryAfterMs(rateLimit.retry_after);
        const bodyPreview = body.slice(0, 1000);
        const shouldRetry = (
          attempt < OPENAI_MAX_RETRY_ATTEMPTS &&
          response.status === 429 &&
          retryAfterMs !== null &&
          retryAfterMs > 0 &&
          retryAfterMs <= 3000 &&
          !bodyPreview.toLowerCase().includes("insufficient_quota")
        );

        console.error("[generate-battle-suggestions] OpenAI response API failed", {
          status: response.status,
          attempt,
          ...promptMetrics,
          ...rateLimit,
          body: bodyPreview,
          will_retry: shouldRetry,
        });

        if (shouldRetry) {
          await sleep(retryAfterMs);
          continue;
        }

        return {
          ok: false as const,
          stage: "http_error",
          message: `OpenAI API returned ${response.status}`,
          status: response.status,
          body: bodyPreview,
          attempt,
          ...promptMetrics,
          rate_limit: rateLimit,
        };
      }

      const payload = await response.json() as Record<string, unknown>;
      const outputText = extractResponseText(payload);
      const parsed = parseJsonObject(outputText);
      if (!parsed) {
        console.error("[generate-battle-suggestions] OpenAI payload was not valid JSON", {
          attempt,
          ...promptMetrics,
          ...rateLimit,
          output_preview: outputText?.slice(0, 1000) ?? null,
        });
        return {
          ok: false as const,
          stage: "parse_error",
          message: "OpenAI payload was not valid JSON",
          outputText,
          attempt,
          ...promptMetrics,
          rate_limit: rateLimit,
        };
      }

      return {
        ok: true as const,
        payload,
        parsed,
        attempt,
        ...promptMetrics,
        rate_limit: rateLimit,
      };
    }

    return {
      ok: false as const,
      stage: "http_error",
      message: "OpenAI retry budget exhausted",
      ...promptMetrics,
    };
  } catch (error) {
    console.error("[generate-battle-suggestions] OpenAI request failed", error);
    return {
      ok: false as const,
      stage: "request_failed",
      message: error instanceof Error ? error.message : String(error),
      ...promptMetrics,
    };
  }
}

function clampNormalizedScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeAiScore(value: unknown) {
  const numericValue = asFiniteNumber(value);
  if (numericValue === null) {
    return null;
  }

  return clampNormalizedScore(numericValue > 1 ? numericValue / 100 : numericValue);
}

function normalizeEloScore(candidate: { elo_diff: number }, index: number) {
  const raw = (100 - candidate.elo_diff - (index * 2)) / 100;
  return Math.max(0, Math.min(1, raw));
}

function buildHybridSuggestions(
  candidates: Array<Omit<CandidateSuggestion, "ai_score" | "elo_score" | "final_score" | "score" | "reason" | "source">>,
  aiItems: Array<Record<string, unknown>>,
  limit: number,
) {
  const aiMap = new Map<string, { ai_score: number; reason: string | null }>();

  for (const item of aiItems) {
    const opponentId = asNonEmptyString(item.opponent_id);
    const aiScore = normalizeAiScore(item.score);
    if (!opponentId || aiScore === null || aiMap.has(opponentId)) {
      continue;
    }

    aiMap.set(opponentId, {
      ai_score: aiScore,
      reason: asNonEmptyString(item.reason),
    });
  }

  const ranked = candidates.map((candidate, index) => {
    const aiResult = aiMap.get(candidate.user_id) ?? null;
    const eloScore = normalizeEloScore(candidate, index);
    const aiScore = aiResult?.ai_score ?? 0;
    const finalScore = (0.7 * aiScore) + (0.3 * eloScore);

    return {
      ...candidate,
      ai_score: aiResult?.ai_score ?? null,
      elo_score: eloScore,
      final_score: finalScore,
      score: Math.round(finalScore * 100),
      reason: aiResult?.reason ?? "Hybrid ranking combined AI taste matching with ELO fairness.",
      source: "hybrid" as const,
    };
  });

  return ranked
    .sort((left, right) => {
      const rightScore = right.final_score ?? 0;
      const leftScore = left.final_score ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return left.elo_diff - right.elo_diff;
    })
    .slice(0, limit);
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

  const suggestionSettings = await loadSuggestionSettings(supabaseAdmin);

  const candidates = ((candidateRows as Array<Record<string, unknown>> | null) ?? []).map((row) => ({
    user_id: String(row.user_id),
    username: asNonEmptyString(row.username),
    avatar_url: asNonEmptyString(row.avatar_url),
    producer_tier: asNonEmptyString(row.producer_tier),
    role: (asNonEmptyString(row.role) ?? "visitor") as CandidateSuggestion["role"],
    elo_rating: asFiniteNumber(row.elo_rating) ?? 1200,
    battle_wins: asFiniteNumber(row.battle_wins) ?? 0,
    battle_losses: asFiniteNumber(row.battle_losses) ?? 0,
    battle_draws: asFiniteNumber(row.battle_draws) ?? 0,
    elo_diff: asFiniteNumber(row.elo_diff) ?? 0,
  })).filter((candidate) => candidate.role === "producer");

  if (candidates.length === 0) {
    return jsonResponse({
      ok: true,
      request_id: requestId,
      enabled: suggestionSettings.enabled,
      mode: suggestionSettings.mode,
      source: "sql",
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
  const shouldSkipAi = !suggestionSettings.enabled || suggestionSettings.mode === "sql_only";
  const aiResult = shouldSkipAi
    ? {
      ok: false as const,
      stage: "skipped_by_setting",
      message: !suggestionSettings.enabled
        ? "AI battle suggestions are disabled by admin setting"
        : "AI battle suggestions are set to sql_only mode",
      endpoint: OPENAI_RESPONSES_ENDPOINT,
      model: asNonEmptyString(Deno.env.get("BATTLE_SUGGESTIONS_MODEL")) ?? DEFAULT_MODEL,
      payload_bytes: 0,
      candidate_count: candidates.length,
      attempt: 0,
      rate_limit: null,
    }
    : await callOpenAiSuggestions({
      actor: actorProfile as ProfileSnapshot,
      actorProducts,
      candidates,
      candidateProductsByProducerId,
      limit,
    });

  let suggestions = fallbackSuggestions;
  let source: "ai" | "hybrid" | "sql" = "sql";
  let model = "fallback-sql-matchmaking-v1";

  const aiStatus = aiResult.ok
    ? {
      attempted: !shouldSkipAi,
      used: false,
      stage: "success",
      message: null,
      model: aiResult.model,
      endpoint: aiResult.endpoint,
      payload_bytes: aiResult.payload_bytes,
      candidate_count: aiResult.candidate_count,
      attempt: aiResult.attempt,
      rate_limit: aiResult.rate_limit,
    }
    : {
      attempted: !shouldSkipAi,
      used: false,
      stage: aiResult.stage,
      message: aiResult.message,
      endpoint: "endpoint" in aiResult ? aiResult.endpoint : OPENAI_RESPONSES_ENDPOINT,
      model: "model" in aiResult ? aiResult.model : model,
      status: "status" in aiResult ? aiResult.status : null,
      payload_bytes: "payload_bytes" in aiResult ? aiResult.payload_bytes : null,
      candidate_count: "candidate_count" in aiResult ? aiResult.candidate_count : candidates.length,
      attempt: "attempt" in aiResult ? aiResult.attempt : null,
      rate_limit: "rate_limit" in aiResult ? aiResult.rate_limit : null,
    };

  if (aiResult.ok) {
    const rawSuggestions = Array.isArray(aiResult.parsed.suggestions)
      ? aiResult.parsed.suggestions as Array<Record<string, unknown>>
      : [];
    if (suggestionSettings.mode === "hybrid") {
      const hybridSuggestions = buildHybridSuggestions(candidates, rawSuggestions, limit);
      if (hybridSuggestions.length > 0 && hybridSuggestions.some((item) => item.ai_score !== null)) {
        suggestions = hybridSuggestions;
        source = "hybrid";
        model = aiResult.model;
        aiStatus.used = true;
      } else {
        aiStatus.stage = "empty_parsed_suggestions";
        aiStatus.message = "OpenAI returned no usable opponent ids for hybrid ranking";
      }
    } else {
      const candidateMap = new Map(candidates.map((candidate, index) => [candidate.user_id, { candidate, index }]));
      const seen = new Set<string>();
      const parsedSuggestions: CandidateSuggestion[] = [];

      for (const item of rawSuggestions) {
        const opponentId = asNonEmptyString(item.opponent_id);
        if (!opponentId || seen.has(opponentId) || !candidateMap.has(opponentId)) continue;
        seen.add(opponentId);

        const { candidate, index } = candidateMap.get(opponentId)!;
        const aiScore = normalizeAiScore(item.score);
        const eloScore = normalizeEloScore(candidate, index);
        const finalScore = aiScore ?? eloScore;

        parsedSuggestions.push({
          ...candidate,
          ai_score: aiScore,
          elo_score: eloScore,
          final_score: finalScore,
          score: Math.round(finalScore * 100),
          reason: asNonEmptyString(item.reason),
          source: "ai",
        });
      }

      if (parsedSuggestions.length > 0) {
        suggestions = parsedSuggestions.slice(0, limit);
        source = "ai";
        model = aiResult.model;
        aiStatus.used = true;
      } else {
        aiStatus.stage = "empty_parsed_suggestions";
        aiStatus.message = "OpenAI returned no usable opponent ids";
      }
    }
  }

  const payload = {
    enabled: suggestionSettings.enabled,
    mode: suggestionSettings.mode,
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
    enabled: suggestionSettings.enabled,
    mode: suggestionSettings.mode,
    source,
    model,
    ai_status: aiStatus,
    suggestions,
  });
});
