import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { invokeContractGeneration, resolveContractGenerateEndpoint } from "../_shared/contract-generation.js";
import { serveWithErrorHandling } from "../_shared/error-handler.ts";

const BASE_CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_ALLOWED_CORS_ORIGINS = [
  "https://beatelion.com",
  "https://www.beatelion.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://dev.beatelion.local:5173",
];

const DEFAULT_CORS_ORIGIN = DEFAULT_ALLOWED_CORS_ORIGINS[0];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const resolveAllowedCorsOrigins = () => {
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

  for (const envValue of [
    Deno.env.get("APP_URL"),
    Deno.env.get("SITE_URL"),
    Deno.env.get("PUBLIC_SITE_URL"),
    Deno.env.get("VITE_APP_URL"),
  ]) {
    if (typeof envValue !== "string") continue;
    const normalized = normalizeOrigin(envValue.trim());
    if (normalized) {
      allowed.add(normalized);
    }
  }

  return allowed;
};

const ALLOWED_CORS_ORIGINS = resolveAllowedCorsOrigins();

const resolveRequestOrigin = (req: Request) => {
  const rawOrigin = req.headers.get("origin");
  if (!rawOrigin) return null;
  const normalized = normalizeOrigin(rawOrigin);
  if (!normalized) return null;
  return ALLOWED_CORS_ORIGINS.has(normalized) ? normalized : null;
};

const buildCorsHeaders = (origin: string | null) => ({
  ...BASE_CORS_HEADERS,
  "Access-Control-Allow-Origin": origin ?? DEFAULT_CORS_ORIGIN,
  "Vary": "Origin",
});

const CONTRACT_BUCKET = "contracts";
const CONTRACT_SIGNED_URL_TTL_SECONDS = 60;
const CONTRACT_URL_USER_RATE_LIMIT_RPC = "get_contract_url_user";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isUuid = (value: string) => UUID_RE.test(value);

const extractAuthorizationHeader = (req: Request) =>
  req.headers.get("authorization") ?? req.headers.get("Authorization");

const isBearerAuthorizationHeader = (value: string | null): value is string => (
  typeof value === "string" && /^Bearer\s+\S+$/i.test(value.trim())
);

type MaybeMany<T> = T | T[] | null | undefined;

const toOne = <T>(value: MaybeMany<T>): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const yesNo = (value: boolean | null | undefined) => {
  if (typeof value !== "boolean") return "Non défini";
  return value ? "Oui" : "Non";
};

const formatLimit = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "Illimité";
  return value.toLocaleString("fr-FR");
};

function sanitizePdfText(text: string): string {
  return text
    .replace(/\u202F/g, " ")
    .replace(/\u00A0/g, " ");
}

async function buildContractPdfBytes(input: {
  purchaseId: string;
  purchaseDate: string;
  buyerName: string;
  producerName: string;
  trackTitle: string;
  licenseName: string;
  amountText: string;
  licenseDescription: string;
  maxStreams: number | null;
  maxSales: number | null;
  youtubeMonetization: boolean | null;
  musicVideoAllowed: boolean | null;
  creditRequired: boolean | null;
  exclusiveAllowed: boolean | null;
}) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 790;
  const left = 48;
  const lineGap = 18;

  const drawLine = (text: string, isBold = false, size = 11) => {
    page.drawText(sanitizePdfText(text), {
      x: left,
      y,
      size,
      font: isBold ? bold : font,
    });
    y -= lineGap;
  };

  drawLine("CONTRAT DE LICENCE", true, 18);
  y -= 8;
  drawLine(`Référence achat: ${input.purchaseId}`);
  drawLine(`Date: ${input.purchaseDate}`);
  y -= 8;

  drawLine(`Acheteur: ${input.buyerName}`, true);
  drawLine(`Producteur: ${input.producerName}`);
  drawLine(`Titre: ${input.trackTitle}`);
  drawLine(`Licence: ${input.licenseName}`);
  drawLine(`Montant payé: ${input.amountText}`);
  y -= 8;

  drawLine("Description de la licence", true);
  drawLine(input.licenseDescription || "Description indisponible.");
  y -= 8;

  drawLine("Droits et limites", true);
  drawLine(`- Streams max: ${formatLimit(input.maxStreams)}`);
  drawLine(`- Ventes max: ${formatLimit(input.maxSales)}`);
  drawLine(`- Monétisation YouTube: ${yesNo(input.youtubeMonetization)}`);
  drawLine(`- Clip vidéo autorisé: ${yesNo(input.musicVideoAllowed)}`);
  drawLine(`- Crédit obligatoire: ${yesNo(input.creditRequired)}`);
  drawLine(`- Usage exclusif autorisé: ${yesNo(input.exclusiveAllowed)}`);

  return await pdfDoc.save();
}

const buildContractStoragePath = (purchaseId: string) => {
  return `contracts/${purchaseId}/${Date.now()}.pdf`;
};

async function generateContractPdfFallback(
  supabaseAdmin: any,
  purchaseId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("purchases")
    .select(`
      id,
      amount,
      license_type,
      completed_at,
      buyer:user_profiles!purchases_user_id_fkey(username, full_name),
      product:products!purchases_product_id_fkey(
        title,
        producer:user_profiles!products_producer_id_fkey(username)
      ),
      license:licenses!purchases_license_id_fkey(
        name,
        description,
        max_streams,
        max_sales,
        youtube_monetization,
        music_video_allowed,
        credit_required,
        exclusive_allowed
      )
    `)
    .eq("id", purchaseId)
    .maybeSingle();

  if (error || !data) {
    console.error("[get-contract-url] Failed to load purchase for fallback PDF", { purchaseId, error });
    return null;
  }

  const buyer = toOne(data.buyer as MaybeMany<{ username?: string | null; full_name?: string | null }>);
  const product = toOne(data.product as MaybeMany<{
    title?: string | null;
    producer?: MaybeMany<{ username?: string | null }>;
  }>);
  const producer = toOne(product?.producer ?? null);
  const license = toOne(data.license as MaybeMany<{
    name?: string | null;
    description?: string | null;
    max_streams?: number | null;
    max_sales?: number | null;
    youtube_monetization?: boolean | null;
    music_video_allowed?: boolean | null;
    credit_required?: boolean | null;
    exclusive_allowed?: boolean | null;
  }>);

  const amount = typeof data.amount === "number" ? data.amount : 0;
  const amountText = `${(amount / 100).toFixed(2)} EUR`;

  const pdfBytes = await buildContractPdfBytes({
    purchaseId,
    purchaseDate: new Date(data.completed_at || Date.now()).toLocaleDateString("fr-FR"),
    buyerName: buyer?.full_name || buyer?.username || "Acheteur",
    producerName: producer?.username || "Producteur",
    trackTitle: product?.title || "Titre",
    licenseName: license?.name || asNonEmptyString(data.license_type) || "Standard",
    amountText,
    licenseDescription: license?.description || "Licence musicale numérique.",
    maxStreams: license?.max_streams ?? null,
    maxSales: license?.max_sales ?? null,
    youtubeMonetization: license?.youtube_monetization ?? null,
    musicVideoAllowed: license?.music_video_allowed ?? null,
    creditRequired: license?.credit_required ?? null,
    exclusiveAllowed: license?.exclusive_allowed ?? null,
  });

  const storagePath = buildContractStoragePath(purchaseId);
  const { error: uploadError } = await supabaseAdmin.storage
    .from(CONTRACT_BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError) {
    console.error("[get-contract-url] Fallback PDF upload failed", { purchaseId, uploadError });
    return null;
  }

  const fallbackGeneratedAt = new Date().toISOString();
  const fallbackUpdatePayload: Record<string, unknown> = {
    contract_pdf_path: storagePath,
    contract_generated_by: "edge_fallback",
    contract_generated_at: fallbackGeneratedAt,
  };

  const { error: fallbackUpdateError } = await supabaseAdmin
    .from("purchases")
    .update(fallbackUpdatePayload)
    .eq("id", purchaseId);

  if (fallbackUpdateError) {
    const composedError = `${fallbackUpdateError.message ?? ""} ${fallbackUpdateError.details ?? ""}`.toLowerCase();
    const missingProvenanceColumn = composedError.includes("contract_generated_by") ||
      composedError.includes("contract_generated_at") ||
      fallbackUpdateError.code === "42703" ||
      fallbackUpdateError.code === "PGRST204";

    if (missingProvenanceColumn) {
      console.warn("[get-contract-url] Contract provenance columns missing, falling back to contract_pdf_path-only update", {
        purchaseId,
        code: fallbackUpdateError.code,
        message: fallbackUpdateError.message,
      });

      const { error: legacyUpdateError } = await supabaseAdmin
        .from("purchases")
        .update({ contract_pdf_path: storagePath })
        .eq("id", purchaseId);

      if (legacyUpdateError) {
        console.error("[get-contract-url] Failed to persist fallback contract_pdf_path (legacy retry)", {
          purchaseId,
          legacyUpdateError,
        });
      }
    } else {
      console.error("[get-contract-url] Failed to persist fallback contract metadata", {
        purchaseId,
        fallbackUpdateError,
      });
    }
  } else {
    console.warn("[get-contract-url] Emergency fallback contract generator used", {
      purchaseId,
      generatedBy: "edge_fallback",
      generatedAt: fallbackGeneratedAt,
      storagePath,
    });
  }

  return storagePath;
}

const normalizePathCandidate = (candidate: string) => {
  const raw = candidate.trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const bucketIdx = segments.findIndex((segment) => segment === CONTRACT_BUCKET);
    if (bucketIdx < 0) return null;
    return decodeURIComponent(segments.slice(bucketIdx + 1).join("/")).replace(/^\/+/, "");
  } catch {
    return null;
  }
};

const buildPathCandidates = (purchaseId: string, declaredPath: string | null) => {
  const fromDeclared = declaredPath ? normalizePathCandidate(declaredPath) : null;
  const base = [`contracts/${purchaseId}.pdf`, `${purchaseId}.pdf`];
  return [...new Set([fromDeclared, ...base].filter((value): value is string => Boolean(value)))];
};

const splitStoragePath = (storagePath: string) => {
  const normalized = storagePath.replace(/^\/+/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return { folder: "", fileName: normalized };
  }
  return {
    folder: normalized.slice(0, slashIndex),
    fileName: normalized.slice(slashIndex + 1),
  };
};

const contractPathExists = async (
  supabaseAdmin: any,
  contractPath: string,
) => {
  const normalized = normalizePathCandidate(contractPath);
  if (!normalized) return false;

  const { folder, fileName } = splitStoragePath(normalized);
  if (!fileName) return false;

  const { data, error } = await supabaseAdmin.storage
    .from(CONTRACT_BUCKET)
    .list(folder, { limit: 100, search: fileName });

  if (error) {
    console.error("[get-contract-url] Contract existence check failed", {
      contractPath: normalized,
      error,
    });
    return false;
  }

  return (data ?? []).some((entry: any) => entry.name === fileName);
};

const resolveExistingContractPath = async (
  supabaseAdmin: any,
  purchaseId: string,
  declaredPath: string | null,
) => {
  const candidates = buildPathCandidates(purchaseId, declaredPath);
  for (const candidate of candidates) {
    if (await contractPathExists(supabaseAdmin, candidate)) {
      return candidate;
    }
  }
  return null;
};

const persistContractPath = async (
  supabaseAdmin: any,
  purchaseId: string,
  contractPath: string,
) => {
  const { error } = await supabaseAdmin
    .from("purchases")
    .update({ contract_pdf_path: contractPath })
    .eq("id", purchaseId);

  if (error) {
    console.error("[get-contract-url] Failed to persist contract_pdf_path", {
      purchaseId,
      contractPath,
      error,
    });
  }
};

const enforceUserRateLimit = async (
  supabaseAdmin: any,
  userId: string,
) => {
  const { data, error } = await supabaseAdmin.rpc("check_rpc_rate_limit", {
    p_user_id: userId,
    p_rpc_name: CONTRACT_URL_USER_RATE_LIMIT_RPC,
  });

  if (error) {
    console.error("[get-contract-url] check_rpc_rate_limit failed", {
      rpc: CONTRACT_URL_USER_RATE_LIMIT_RPC,
      userId,
      error,
    });
    return { allowed: false as const, status: 500, error: "Rate limit unavailable" };
  }

  if (data !== true) {
    return { allowed: false as const, status: 429, error: "Too many requests" };
  }

  return { allowed: true as const };
};

const enforcePurchaseRateLimit = async (
  supabaseAdmin: any,
  purchaseId: string,
  userId: string,
) => {
  const { data, error } = await supabaseAdmin.rpc("rpc_check_contract_url_rate_limit", {
    p_purchase_id: purchaseId,
    p_user_id: userId,
  });

  if (error) {
    console.error("[get-contract-url] rpc_check_contract_url_rate_limit failed", {
      purchaseId,
      userId,
      error,
    });
    return { allowed: false as const, status: 500, error: "Rate limit unavailable" };
  }

  if (data !== true) {
    return { allowed: false as const, status: 429, error: "Too many requests" };
  }

  return { allowed: true as const };
};

async function callContractServiceToGenerate(purchaseId: string) {
  const resolvedEndpoint = resolveContractGenerateEndpoint({
    CONTRACT_GENERATE_ENDPOINT: Deno.env.get("CONTRACT_GENERATE_ENDPOINT"),
    CONTRACT_SERVICE_URL: Deno.env.get("CONTRACT_SERVICE_URL"),
  });
  const contractServiceSecret = Deno.env.get("CONTRACT_SERVICE_SECRET");

  if (!resolvedEndpoint.endpoint) {
    console.error("[get-contract-url] Missing/invalid contract generation endpoint configuration", {
      purchaseId,
      source: resolvedEndpoint.source,
      error: resolvedEndpoint.error,
    });
    return false;
  }

  if (!contractServiceSecret?.trim()) {
    console.error("[get-contract-url] Missing CONTRACT_SERVICE_SECRET");
    return false;
  }

  const result = await invokeContractGeneration({
    endpoint: resolvedEndpoint.endpoint,
    secret: contractServiceSecret,
    purchaseId,
    timeoutMs: 8000,
  });

  if (!result.ok) {
    console.error("[get-contract-url] Contract generation failed", {
      purchaseId,
      endpoint: resolvedEndpoint.endpoint,
      source: resolvedEndpoint.source,
      status: result.status,
      error: result.error,
      body: result.body,
    });
    return false;
  }

  return true;
}

serveWithErrorHandling("get-contract-url", async (req: Request) => {
  const requestOrigin = resolveRequestOrigin(req);
  const corsHeaders = buildCorsHeaders(requestOrigin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("[get-contract-url] Missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = extractAuthorizationHeader(req);
    if (!isBearerAuthorizationHeader(authHeader)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey) as any;
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: authData, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = await req.json().catch(() => null) as {
      purchase_id?: unknown;
      beatId?: unknown;
      beat_id?: unknown;
    } | null;
    const purchaseId = asNonEmptyString(body?.purchase_id);
    const beatId = asNonEmptyString(body?.beatId) ?? asNonEmptyString(body?.beat_id);

    if (!purchaseId || !isUuid(purchaseId)) {
      return new Response(JSON.stringify({ error: "Invalid purchase_id" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    if (beatId && !isUuid(beatId)) {
      return new Response(JSON.stringify({ error: "Invalid beatId" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from("purchases")
      .select("id, user_id, product_id, status, contract_pdf_path")
      .eq("id", purchaseId)
      .maybeSingle();

    if (purchaseError) {
      console.error("[get-contract-url] Purchase fetch failed", purchaseError);
      return new Response(JSON.stringify({ error: "Failed to load purchase" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!purchase) {
      return new Response(JSON.stringify({ error: "Purchase not found" }), {
        status: 404,
        headers: jsonHeaders,
      });
    }

    if (purchase.user_id !== authData.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    if (purchase.status !== "completed") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    if (beatId && purchase.product_id !== beatId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const userRateLimit = await enforceUserRateLimit(supabaseAdmin, authData.user.id);
    if (!userRateLimit.allowed) {
      return new Response(JSON.stringify({ error: userRateLimit.error }), {
        status: userRateLimit.status,
        headers: jsonHeaders,
      });
    }

    const purchaseRateLimit = await enforcePurchaseRateLimit(
      supabaseAdmin,
      purchaseId,
      authData.user.id,
    );
    if (!purchaseRateLimit.allowed) {
      return new Response(JSON.stringify({ error: purchaseRateLimit.error }), {
        status: purchaseRateLimit.status,
        headers: jsonHeaders,
      });
    }

    let declaredPath = asNonEmptyString(purchase.contract_pdf_path);
    let resolvedPath = await resolveExistingContractPath(supabaseAdmin, purchaseId, declaredPath);

    if (!resolvedPath) {
      await callContractServiceToGenerate(purchaseId);

      const { data: refreshedPurchase, error: refreshedError } = await supabaseAdmin
        .from("purchases")
        .select("contract_pdf_path")
        .eq("id", purchaseId)
        .maybeSingle();

      if (refreshedError) {
        console.error("[get-contract-url] Purchase refresh failed", refreshedError);
      } else {
        declaredPath = asNonEmptyString(refreshedPurchase?.contract_pdf_path);
      }

      resolvedPath = await resolveExistingContractPath(supabaseAdmin, purchaseId, declaredPath);
    }

    if (!resolvedPath) {
      // Emergency path only: local PDF generation is kept for resilience
      // when the canonical API generator is unavailable.
      const fallbackPath = await generateContractPdfFallback(supabaseAdmin, purchaseId);
      declaredPath = asNonEmptyString(fallbackPath);
      resolvedPath = await resolveExistingContractPath(supabaseAdmin, purchaseId, declaredPath);
    }

    if (resolvedPath) {
      if (declaredPath !== resolvedPath) {
        await persistContractPath(supabaseAdmin, purchaseId, resolvedPath);
      }

      const { data, error } = await supabaseAdmin.storage
        .from(CONTRACT_BUCKET)
        .createSignedUrl(resolvedPath, CONTRACT_SIGNED_URL_TTL_SECONDS, { download: true });

      if (!error && data?.signedUrl) {
        return new Response(JSON.stringify({
          url: data.signedUrl,
        }), {
          status: 200,
          headers: jsonHeaders,
        });
      }

      console.error("[get-contract-url] Signed URL generation failed", {
        purchaseId,
        resolvedPath,
        error,
      });
    }

    console.error("[get-contract-url] No contract PDF available", {
      purchaseId,
      declaredPath,
      resolvedPath,
    });

    return new Response(JSON.stringify({ error: "Contract PDF unavailable" }), {
      status: 404,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[get-contract-url] Unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
