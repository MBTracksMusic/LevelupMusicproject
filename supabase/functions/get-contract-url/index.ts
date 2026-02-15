import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const CONTRACT_BUCKET = "contracts";

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

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
    page.drawText(text, {
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

async function generateContractPdfFallback(
  supabaseAdmin: ReturnType<typeof createClient>,
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

  const storagePath = `contracts/${purchaseId}.pdf`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(CONTRACT_BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    console.error("[get-contract-url] Fallback PDF upload failed", { purchaseId, uploadError });
    return null;
  }

  const { error: updateError } = await supabaseAdmin
    .from("purchases")
    .update({ contract_pdf_path: storagePath })
    .eq("id", purchaseId);

  if (updateError) {
    console.error("[get-contract-url] Failed to persist fallback contract_pdf_path", {
      purchaseId,
      updateError,
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

async function callContractServiceToGenerate(purchaseId: string) {
  const contractServiceUrl = Deno.env.get("CONTRACT_SERVICE_URL");
  const contractServiceSecret = Deno.env.get("CONTRACT_SERVICE_SECRET");
  const requestTimeoutMs = 8000;

  if (!contractServiceUrl || !contractServiceSecret) {
    console.error("[get-contract-url] Missing CONTRACT_SERVICE_URL or CONTRACT_SERVICE_SECRET");
    return false;
  }

  const endpoint = contractServiceUrl.endsWith("/generate-contract")
    ? contractServiceUrl
    : `${contractServiceUrl.replace(/\/$/, "")}/generate-contract`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${contractServiceSecret}`,
        },
        body: JSON.stringify({ purchase_id: purchaseId }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      console.error("[get-contract-url] Contract generation failed", {
        purchaseId,
        status: response.status,
        timeoutMs: requestTimeoutMs,
        body,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error("[get-contract-url] Contract generation error", {
      purchaseId,
      timeoutMs: requestTimeoutMs,
      error,
    });
    return false;
  }
}

Deno.serve(async (req: Request) => {
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

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[get-contract-url] Missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: jsonHeaders,
      });
    }

    const body = await req.json().catch(() => null) as { purchase_id?: unknown } | null;
    const purchaseId = asNonEmptyString(body?.purchase_id);

    if (!purchaseId) {
      return new Response(JSON.stringify({ error: "Missing purchase_id" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: purchase, error: purchaseError } = await supabaseAdmin
      .from("purchases")
      .select("id, user_id, contract_pdf_path")
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

    let declaredPath = asNonEmptyString(purchase.contract_pdf_path);

    // Best-effort service call on each download request:
    // - generates missing PDFs
    // - restores missing notification emails for legacy purchases
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

    if (!declaredPath) {
      // Last-resort fallback: generate a minimal PDF directly from the Edge Function.
      declaredPath = await generateContractPdfFallback(supabaseAdmin, purchaseId);
    }

    const pathCandidates = buildPathCandidates(purchaseId, declaredPath);
    let lastError: unknown = null;

    for (const pathCandidate of pathCandidates) {
      const { data, error } = await supabaseAdmin.storage
        .from(CONTRACT_BUCKET)
        .createSignedUrl(pathCandidate, 60 * 5, { download: true });

      if (!error && data?.signedUrl) {
        return new Response(JSON.stringify({
          url: data.signedUrl,
          expires_in: 60 * 5,
          path: pathCandidate,
        }), {
          status: 200,
          headers: jsonHeaders,
        });
      }

      lastError = error;
    }

    console.error("[get-contract-url] No contract PDF available", {
      purchaseId,
      declaredPath,
      pathCandidates,
      lastError,
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
