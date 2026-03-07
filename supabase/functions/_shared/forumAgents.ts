import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey, x-supabase-auth, x-forum-agent-secret",
};

export const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const DEFAULT_REVIEW_THRESHOLD = 0.45;
const DEFAULT_BLOCK_THRESHOLD = 0.85;
const DEFAULT_MODERATION_MODEL = "omni-moderation-latest";
const DEFAULT_ASSISTANT_MODEL = "gpt-5-mini";

type SupabaseAdminClient = any;

export type ForumSettings = {
  moderation: {
    reviewThreshold: number;
    blockThreshold: number;
    openAiModerationModel: string;
    assistantModel: string;
  };
  assistant: {
    assistantName: string;
    assistantEmail: string;
    assistantUsername: string;
    assistantUserId: string | null;
    mentionCooldownHours: number;
  };
};

export type ForumCategoryPolicy = {
  id: string;
  slug: string;
  name: string;
  xpMultiplier: number;
  moderationStrictness: "low" | "normal" | "high";
  isCompetitive: boolean;
  requiredRankTier: string | null;
  allowLinks: boolean;
  allowMedia: boolean;
};

export type ModerationDecision = {
  decision: "allowed" | "review" | "blocked";
  score: number;
  reason: string;
  model: string;
  isVisible: boolean;
  isFlagged: boolean;
  rawResponse: Record<string, unknown>;
};

export function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: jsonHeaders,
  });
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

export function containsAssistantMention(content: string) {
  return /\B@assistant\b/i.test(content);
}

export function createAdminClient(): SupabaseAdminClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as SupabaseAdminClient;
}

export async function requireUser(req: Request) {
  const jwt =
    req.headers.get("x-supabase-auth")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";

  if (!jwt) {
    return { error: jsonResponse({ error: "Unauthorized", code: "unauthorized" }, 401) };
  }

  try {
    const supabaseAdmin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(jwt);

    if (authError || !user) {
      console.error("[forum-agents] requireUser auth failed", authError);
      return { error: jsonResponse({ error: "Unauthorized", code: "unauthorized" }, 401) };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("[forum-agents] requireUser profile failed", profileError);
      return { error: jsonResponse({ error: "Profile not found", code: "profile_not_found" }, 403) };
    }

    return {
      supabaseAdmin,
      user: {
        id: user.id,
        email: user.email ?? null,
      },
      profile,
    };
  } catch (error) {
    console.error("[forum-agents] requireUser unexpected error", error);
    return { error: jsonResponse({ error: "Internal server error", code: "internal_error" }, 500) };
  }
}

export function requireInternalAgent(req: Request) {
  const secret = Deno.env.get("FORUM_AGENT_SECRET");
  const provided = req.headers.get("x-forum-agent-secret");

  if (!secret) {
    return { error: jsonResponse({ error: "Server not configured", code: "missing_forum_agent_secret" }, 500) };
  }

  if (!provided || provided !== secret) {
    return { error: jsonResponse({ error: "Forbidden", code: "forbidden" }, 403) };
  }

  return { ok: true as const };
}

export async function loadForumSettings(supabaseAdmin: SupabaseAdminClient): Promise<ForumSettings> {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["forum_moderation_settings", "forum_assistant_settings"]);

  if (error) {
    console.error("[forum-agents] loadForumSettings failed", error);
  }

  const rows = Array.isArray(data)
    ? data as Array<{ key: string; value: Record<string, unknown> | null }>
    : [];
  const byKey = new Map(rows.map((row) => [row.key, row.value ?? {}]));
  const moderation = byKey.get("forum_moderation_settings") ?? {};
  const assistant = byKey.get("forum_assistant_settings") ?? {};

  return {
    moderation: {
      reviewThreshold: parseThreshold(moderation.review_threshold, DEFAULT_REVIEW_THRESHOLD),
      blockThreshold: parseThreshold(moderation.block_threshold, DEFAULT_BLOCK_THRESHOLD),
      openAiModerationModel: asNonEmptyString(moderation.openai_moderation_model) ?? DEFAULT_MODERATION_MODEL,
      assistantModel: asNonEmptyString(moderation.assistant_model) ?? DEFAULT_ASSISTANT_MODEL,
    },
    assistant: {
      assistantName: asNonEmptyString(assistant.assistant_name) ?? "Beatelion Assistant",
      assistantEmail: asNonEmptyString(assistant.assistant_email) ?? "forum-assistant@beatelion.local",
      assistantUsername: asNonEmptyString(assistant.assistant_username) ?? "beatelion_assistant",
      assistantUserId: asNonEmptyString(assistant.assistant_user_id),
      mentionCooldownHours: parsePositiveInteger(assistant.mention_cooldown_hours, 6),
    },
  };
}

function parseThreshold(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
    return numeric;
  }
  return fallback;
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}

function maxCategoryScore(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value as Record<string, unknown>).reduce<number>((max, item) => {
    const parsed = typeof item === "number" ? item : Number.parseFloat(String(item ?? ""));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
}

function hasLinkSignal(value: string) {
  return /https?:\/\/|www\.|discord\.gg|t\.me\/|instagram\.com\/|twitter\.com\/|x\.com\//i.test(value);
}

function hasMediaSignal(value: string) {
  return /!\[[^\]]*\]\([^)]+\)|<img\b|<video\b|\.(png|jpe?g|gif|webp|mp4|mov|avi|mkv)(\?|$)/i.test(value);
}

function normalizeStrictness(value: unknown): ForumCategoryPolicy["moderationStrictness"] {
  return value === "low" || value === "high" ? value : "normal";
}

function mapCategoryPolicy(row: Record<string, unknown> | null): ForumCategoryPolicy | null {
  if (!row) return null;

  const id = asNonEmptyString(row.id);
  const slug = asNonEmptyString(row.slug);
  const name = asNonEmptyString(row.name);
  if (!id || !slug || !name) return null;

  const multiplierRaw = typeof row.xp_multiplier === "number"
    ? row.xp_multiplier
    : Number.parseFloat(String(row.xp_multiplier ?? "1"));

  return {
    id,
    slug,
    name,
    xpMultiplier: Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1,
    moderationStrictness: normalizeStrictness(row.moderation_strictness),
    isCompetitive: row.is_competitive === true,
    requiredRankTier: asNonEmptyString(row.required_rank_tier),
    allowLinks: row.allow_links !== false,
    allowMedia: row.allow_media !== false,
  };
}

export async function loadForumCategoryPolicyBySlug(
  supabaseAdmin: SupabaseAdminClient,
  categorySlug: string,
): Promise<ForumCategoryPolicy | null> {
  const { data, error } = await supabaseAdmin
    .from("forum_categories")
    .select("id, slug, name, xp_multiplier, moderation_strictness, is_competitive, required_rank_tier, allow_links, allow_media")
    .eq("slug", categorySlug)
    .maybeSingle();

  if (error) {
    console.error("[forum-agents] loadForumCategoryPolicyBySlug failed", error);
    return null;
  }

  return mapCategoryPolicy(data);
}

export async function loadForumCategoryPolicyByTopicId(
  supabaseAdmin: SupabaseAdminClient,
  topicId: string,
): Promise<ForumCategoryPolicy | null> {
  const { data: topic, error: topicError } = await supabaseAdmin
    .from("forum_topics")
    .select("category_id")
    .eq("id", topicId)
    .maybeSingle();

  if (topicError) {
    console.error("[forum-agents] loadForumCategoryPolicyByTopicId topic lookup failed", topicError);
    return null;
  }

  const categoryId = topic && typeof topic === "object" && "category_id" in topic
    ? asNonEmptyString((topic as { category_id?: unknown }).category_id)
    : null;

  if (!categoryId) {
    return null;
  }

  const { data: category, error: categoryError } = await supabaseAdmin
    .from("forum_categories")
    .select("id, slug, name, xp_multiplier, moderation_strictness, is_competitive, required_rank_tier, allow_links, allow_media")
    .eq("id", categoryId)
    .maybeSingle();

  if (categoryError) {
    console.error("[forum-agents] loadForumCategoryPolicyByTopicId category lookup failed", categoryError);
    return null;
  }

  return mapCategoryPolicy(category);
}

function classifyForumContentRuleBased(content: string, title?: string | null) {
  const text = `${title ?? ""}\n${content}`.toLowerCase();
  const toxicKeywords = ["kill yourself", "kys", "nazi", "racist", "slur", "fdp", "pute", "connard", "encule"];
  const spamKeywords = ["buy followers", "free money", "dm me", "telegram", "whatsapp", "crypto giveaway", "promo code"];
  const borderlineKeywords = ["nul", "naze", "trash", "horrible", "hate", "stupid", "idiot", "arnaque"];

  const toxicHits = toxicKeywords.filter((keyword) => text.includes(keyword)).length;
  const spamHits = spamKeywords.filter((keyword) => text.includes(keyword)).length;
  const borderlineHits = borderlineKeywords.filter((keyword) => text.includes(keyword)).length;
  const hasLink = /https?:\/\/|www\./i.test(text);

  let classification: "safe" | "borderline" | "toxic" | "spam" = "safe";
  let score = 0.05;
  let reason = "no_signal";

  if (!text.trim()) {
    classification = "spam";
    score = 0.99;
    reason = "empty_content";
  } else if (toxicHits > 0) {
    classification = "toxic";
    score = Math.min(1, 0.93 + toxicHits * 0.03);
    reason = "toxic_keyword_match";
  } else if (spamHits > 0 || (hasLink && text.length <= 60)) {
    classification = "spam";
    score = spamHits > 1 || (hasLink && text.length <= 24) ? 0.96 : 0.88;
    reason = "spam_signal_match";
  } else if (borderlineHits > 0) {
    classification = "borderline";
    score = Math.min(0.79, 0.56 + borderlineHits * 0.07);
    reason = "borderline_signal_match";
  }

  return {
    model: "forum-rule-based-v1",
    classification,
    score,
    reason,
    flags: {
      toxic_hits: toxicHits,
      spam_hits: spamHits,
      borderline_hits: borderlineHits,
      has_link: hasLink,
    },
  };
}

async function callOpenAiModeration(content: string, model: string) {
  const apiKey = asNonEmptyString(Deno.env.get("OPENAI_API_KEY"));
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: content,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[forum-agents] moderation API failed", response.status, body);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("[forum-agents] moderation API unexpected error", error);
    return null;
  }
}

export async function evaluateForumContent(params: {
  content: string;
  title?: string | null;
  settings: ForumSettings;
  categoryPolicy?: ForumCategoryPolicy | null;
}): Promise<ModerationDecision> {
  const ruleBased = classifyForumContentRuleBased(params.content, params.title);
  const openAiResponse = await callOpenAiModeration(
    `${params.title ? `${params.title}\n\n` : ""}${params.content}`,
    params.settings.moderation.openAiModerationModel,
  );

  const openAiResult = Array.isArray((openAiResponse as { results?: unknown[] } | null)?.results)
    ? (openAiResponse as { results: Array<Record<string, unknown>> }).results[0]
    : null;
  const openAiFlagged = openAiResult?.flagged === true;
  const openAiScore = Number(maxCategoryScore(openAiResult?.category_scores));
  const hasLink = hasLinkSignal(params.content);
  const hasMedia = hasMediaSignal(params.content);

  const thresholdShift = params.categoryPolicy?.moderationStrictness === "high"
    ? -0.1
    : params.categoryPolicy?.moderationStrictness === "low"
    ? 0.05
    : 0;

  const effectiveReviewThreshold = Math.min(
    0.95,
    Math.max(0.15, params.settings.moderation.reviewThreshold + thresholdShift),
  );
  const effectiveBlockThreshold = Math.min(
    0.99,
    Math.max(effectiveReviewThreshold + 0.05, params.settings.moderation.blockThreshold + thresholdShift),
  );

  let categoryRuleReason: string | null = null;
  let categoryRuleScore = 0;

  if (params.categoryPolicy && !params.categoryPolicy.allowLinks && hasLink) {
    categoryRuleReason = "links_not_allowed";
    categoryRuleScore = Math.max(categoryRuleScore, effectiveReviewThreshold + 0.08);
  }

  if (params.categoryPolicy && !params.categoryPolicy.allowMedia && hasMedia) {
    categoryRuleReason = categoryRuleReason ?? "media_not_allowed";
    categoryRuleScore = Math.max(categoryRuleScore, effectiveReviewThreshold + 0.1);
  }

  const finalScore = Math.max(ruleBased.score, openAiScore, categoryRuleScore);

  let decision: ModerationDecision["decision"] = "allowed";
  let reason = categoryRuleReason ?? ruleBased.reason;

  if (
    ruleBased.classification === "toxic"
    || (ruleBased.classification === "spam" && ruleBased.score >= 0.9)
    || finalScore >= effectiveBlockThreshold
  ) {
    decision = "blocked";
    reason = openAiFlagged && openAiScore >= finalScore
      ? "openai_moderation_block"
      : (categoryRuleReason ?? ruleBased.reason);
  } else if (
    ruleBased.classification === "borderline"
    || openAiFlagged
    || finalScore >= effectiveReviewThreshold
  ) {
    decision = "review";
    reason = openAiFlagged && openAiScore >= finalScore
      ? "openai_moderation_review"
      : (categoryRuleReason ?? ruleBased.reason);
  }

  return {
    decision,
    score: finalScore,
    reason,
    model: openAiResponse
      ? `${ruleBased.model}+${params.settings.moderation.openAiModerationModel}`
      : ruleBased.model,
    isVisible: decision === "allowed",
    isFlagged: decision !== "allowed",
    rawResponse: {
      rule_based: ruleBased,
      openai: openAiResponse,
      category_policy: params.categoryPolicy,
      final: {
        decision,
        score: finalScore,
        reason,
        review_threshold: effectiveReviewThreshold,
        block_threshold: effectiveBlockThreshold,
        has_link: hasLink,
        has_media: hasMedia,
      },
    },
  };
}

export async function applyReputationEvent(
  supabaseAdmin: SupabaseAdminClient,
  payload: {
    userId: string;
    source: string;
    eventType: string;
    entityType?: string | null;
    entityId?: string | null;
    delta?: number | null;
    metadata?: Record<string, unknown> | null;
    idempotencyKey?: string | null;
  },
) {
  const { error } = await supabaseAdmin.rpc("rpc_apply_reputation_event", {
    p_user_id: payload.userId,
    p_source: payload.source,
    p_event_type: payload.eventType,
    p_entity_type: payload.entityType ?? null,
    p_entity_id: payload.entityId ?? null,
    p_delta: payload.delta ?? null,
    p_metadata: payload.metadata ?? {},
    p_idempotency_key: payload.idempotencyKey ?? null,
  });

  if (error) {
    console.error("[forum-agents] applyReputationEvent failed", {
      payload,
      error,
    });
  }
}

export async function enforceRateLimit(
  supabaseAdmin: SupabaseAdminClient,
  userId: string | null,
  rpcName: string,
) {
  const { data, error } = await supabaseAdmin.rpc("check_rpc_rate_limit", {
    p_user_id: userId,
    p_rpc_name: rpcName,
  });

  if (error) {
    console.error("[forum-agents] check_rpc_rate_limit failed", { rpcName, error });
    return { allowed: false as const, code: "rate_limit_check_failed" as const };
  }

  if (data !== true) {
    return { allowed: false as const, code: "rate_limit_exceeded" as const };
  }

  return { allowed: true as const };
}

export async function notifyForumAdmins(
  supabaseAdmin: SupabaseAdminClient,
  payload: Record<string, unknown>,
) {
  const { data: admins, error: adminsError } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("role", "admin");

  if (adminsError) {
    console.error("[forum-agents] failed to load admins", adminsError);
    return;
  }

  const adminRows = Array.isArray(admins) ? admins as Array<{ id: string }> : [];
  if (adminRows.length === 0) {
    return;
  }

  const rows = adminRows.map((admin) => ({
    user_id: admin.id,
    type: "forum_review_required",
    payload,
  }));

  const { error } = await supabaseAdmin.from("admin_notifications").insert(rows);
  if (error) {
    console.error("[forum-agents] failed to insert admin notifications", error);
  }
}

export async function invokeInternalForumFunction(
  supabaseAdmin: SupabaseAdminClient,
  functionName: string,
  body: Record<string, unknown>,
) {
  const secret = asNonEmptyString(Deno.env.get("FORUM_AGENT_SECRET"));
  if (!secret) {
    return { skipped: true as const, reason: "missing_secret" };
  }

  const { data, error } = await supabaseAdmin.functions.invoke(functionName, {
    body,
    headers: {
      "x-forum-agent-secret": secret,
    },
  });

  if (error) {
    console.error("[forum-agents] internal function invoke failed", { functionName, error });
    return { skipped: true as const, reason: "invoke_failed" };
  }

  return { skipped: false as const, data };
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

function fallbackAssistantReply(sourceContent: string) {
  const text = sourceContent.toLowerCase();

  if (
    text.includes("contrat")
    || text.includes("legal")
    || text.includes("juridique")
    || text.includes("finance")
    || text.includes("impot")
  ) {
    return "Je peux aider sur le contexte forum et la production, mais pas fournir un avis juridique ou financier. Verifie ce point avec un professionnel qualifie.";
  }

  if (text.includes("mix") || text.includes("master")) {
    return "Point de depart simple: precise la source du probleme, compare avec une reference, puis ajuste un parametre a la fois. Si tu veux, detaille ta chaine mix/master et la sensation exacte que tu cherches.";
  }

  return "Je peux aider si tu precises ton contexte, ce que tu as deja essaye, et le resultat attendu. Donne aussi les outils ou etapes qui te bloquent vraiment.";
}

export async function generateAssistantReply(params: {
  settings: ForumSettings;
  topicTitle: string;
  categoryName: string;
  sourceContent: string;
  recentPosts: Array<{ username: string | null; content: string; isAiGenerated: boolean }>;
}) {
  const apiKey = asNonEmptyString(Deno.env.get("OPENAI_API_KEY"));
  if (!apiKey) {
    return fallbackAssistantReply(params.sourceContent);
  }

  const recentContext = params.recentPosts
    .slice(-4)
    .map((post) => `${post.isAiGenerated ? "Assistant" : post.username ?? "Membre"}: ${post.content}`)
    .join("\n\n");

  const systemPrompt = [
    "Tu es Beatelion Assistant, un assistant communautaire pour un forum de musique et production.",
    "Reponds en francais, de maniere concise, utile, prudente et orientee action.",
    "Ne donne pas de conseil juridique, fiscal, financier ou medical.",
    "Si la question depasse le cadre du forum, dis-le clairement et reste bref.",
    "N'invente pas de faits ou de promesses produit.",
    "Privilegie des conseils techniques courts ou une prochaine action concrete.",
    "Quand c'est pertinent, suggere une seule suite utile parmi: poster dans Feedback, lancer une battle, demander une collab.",
    "Reponds en 3 a 6 phrases maximum.",
  ].join(" ");

  const userPrompt = [
    `Categorie: ${params.categoryName}`,
    `Topic: ${params.topicTitle}`,
    `Message source: ${params.sourceContent}`,
    recentContext ? `Contexte recent:\n${recentContext}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.settings.moderation.assistantModel,
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
        max_output_tokens: 220,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[forum-agents] assistant response API failed", response.status, body);
      return fallbackAssistantReply(params.sourceContent);
    }

    const payload = await response.json() as Record<string, unknown>;
    const text = extractResponseText(payload);
    return text ?? fallbackAssistantReply(params.sourceContent);
  } catch (error) {
    console.error("[forum-agents] assistant generation failed", error);
    return fallbackAssistantReply(params.sourceContent);
  }
}

export async function ensureAssistantUser(
  supabaseAdmin: SupabaseAdminClient,
  settings: ForumSettings,
) {
  const email = settings.assistant.assistantEmail.toLowerCase();
  const username = settings.assistant.assistantUsername;
  const fullName = settings.assistant.assistantName;

  const syncAssistantSetting = async (assistantUserId: string) => {
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({
        key: "forum_assistant_settings",
        value: {
          assistant_name: fullName,
          assistant_email: email,
          assistant_username: username,
          assistant_user_id: assistantUserId,
          mention_cooldown_hours: settings.assistant.mentionCooldownHours,
        },
      });

    if (error) {
      console.error("[forum-agents] failed to persist assistant setting", error);
    }
  };

  if (settings.assistant.assistantUserId) {
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email")
      .eq("id", settings.assistant.assistantUserId)
      .maybeSingle();

    const typedProfile = profile as { id: string; email: string | null } | null;
    if (typedProfile?.id) {
      return { id: typedProfile.id, email: typedProfile.email ?? email, fullName };
    }
  }

  const { data: existingProfile } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();

  const typedExistingProfile = existingProfile as { id: string; email: string | null } | null;

  if (typedExistingProfile?.id) {
    await syncAssistantSetting(typedExistingProfile.id);
    return { id: typedExistingProfile.id, email, fullName };
  }

  const password = `${crypto.randomUUID()}Aa!9${crypto.randomUUID().slice(0, 8)}`;
  const { data: createdUserData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      full_name: fullName,
    },
  });

  if (createUserError || !createdUserData.user) {
    console.error("[forum-agents] failed to create assistant user", createUserError);

    const { data: retryProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email")
      .eq("email", email)
      .maybeSingle();

    const typedRetryProfile = retryProfile as { id: string; email: string | null } | null;

    if (!typedRetryProfile?.id) {
      throw new Error("assistant_user_creation_failed");
    }

    await syncAssistantSetting(typedRetryProfile.id);
    return { id: typedRetryProfile.id, email, fullName };
  }

  const assistantUserId = createdUserData.user.id;

  await supabaseAdmin
    .from("user_profiles")
    .update({
      username,
      full_name: fullName,
    })
    .eq("id", assistantUserId);

  await syncAssistantSetting(assistantUserId);

  return {
    id: assistantUserId,
    email,
    fullName,
  };
}
