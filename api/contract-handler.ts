import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

const CONTRACT_BUCKET = "contracts";
const SIGNED_URL_DEFAULT_SECONDS = 60;
const SIGNED_URL_MIN_SECONDS = 30;
const SIGNED_URL_MAX_SECONDS = 600;
const CONTRACT_SERVICE_SECRET = process.env.CONTRACT_SERVICE_SECRET?.trim();

if (!CONTRACT_SERVICE_SECRET) {
  throw new Error("Missing CONTRACT_SERVICE_SECRET environment variable");
}

interface ApiRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
}

interface ContractData {
  producerName: string;
  buyerName: string;
  trackTitle: string;
  purchaseDate: string;
  licenseName: string;
  youtubeMonetization: string;
  musicVideoAllowed: string;
  maxStreams: string;
  maxSales: string;
  creditRequired: string;
}

interface GeneratePayload {
  purchaseId: string | null;
  signedUrlExpiresIn: number;
  contractData: ContractData;
  buyerIdForPath: string;
  trackIdForPath: string;
}

interface SupabaseAuthUser {
  id: string;
}

interface PurchaseLookupResult {
  user_id: string;
  contract_pdf_path: string | null;
}

interface PurchaseContractSeed {
  contractData: ContractData;
  declaredStoragePath: string | null;
}

type MaybeMany<T> = T | T[] | null | undefined;

const toOne = <T>(value: MaybeMany<T>): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
};

const asPositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return null;
};

const yesNo = (value: boolean | null): string => {
  if (value === null) return "Non défini";
  return value ? "Oui" : "Non";
};

const formatLimit = (value: number | null): string => {
  if (value === null) return "∞";
  return value.toLocaleString("fr-FR");
};

const sanitizePathSegment = (value: string | null, fallback: string): string => {
  if (!value) return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeSignedUrlTtl = (value: unknown): number => {
  const parsed = asPositiveInteger(value);
  if (parsed === null) return SIGNED_URL_DEFAULT_SECONDS;
  if (parsed < SIGNED_URL_MIN_SECONDS) return SIGNED_URL_MIN_SECONDS;
  if (parsed > SIGNED_URL_MAX_SECONDS) return SIGNED_URL_MAX_SECONDS;
  return parsed;
};

const firstHeaderValue = (
  headers: Record<string, string | string[] | undefined> | undefined,
  headerName: string,
): string | null => {
  if (!headers) return null;
  const value = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
};

const getBearerToken = (rawHeader: string | null): string | null => {
  if (!rawHeader) return null;
  return asNonEmptyString(rawHeader.replace(/^Bearer\s+/i, ""));
};

const normalizeStoragePathCandidate = (candidate: string): string | null => {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const bucketIndex = segments.findIndex((part) => part === CONTRACT_BUCKET);
    if (bucketIndex < 0) return null;
    return decodeURIComponent(segments.slice(bucketIndex + 1).join("/")).replace(/^\/+/, "");
  } catch {
    return null;
  }
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

const storageObjectExists = async (
  supabase: SupabaseAdminClient,
  storagePath: string,
): Promise<boolean> => {
  const normalized = normalizeStoragePathCandidate(storagePath);
  if (!normalized) return false;

  const { folder, fileName } = splitStoragePath(normalized);
  if (!fileName) return false;

  const { data, error } = await supabase.storage
    .from(CONTRACT_BUCKET)
    .list(folder, { limit: 100, search: fileName });

  if (error) {
    console.error("[api/contracts] Failed checking contract existence", {
      storagePath: normalized,
      error,
    });
    return false;
  }

  return (data ?? []).some((entry) => entry.name === fileName);
};

const concatByteChunks = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
};

const parseBody = (body: unknown): Record<string, unknown> | null => {
  if (!body) return null;
  if (typeof body === "string") {
    try {
      return asRecord(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return asRecord(body);
};

function generateContractPDF(contractData: ContractData): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk: unknown) => {
      if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      }
    });

    doc.on("end", () => {
      resolve(concatByteChunks(chunks));
    });

    doc.on("error", (error: unknown) => {
      reject(error);
    });

    doc.fontSize(18).text("CONTRAT DE LICENCE NON EXCLUSIVE", { align: "center" });
    doc.moveDown(2);

    doc
      .fontSize(12)
      .text(`Producteur : ${contractData.producerName}`)
      .text(`Acheteur : ${contractData.buyerName}`)
      .text(`Titre : ${contractData.trackTitle}`)
      .text(`Date : ${contractData.purchaseDate}`)
      .moveDown();

    doc.text(`Type de licence : ${contractData.licenseName}`).moveDown();

    doc.text("Droits accordés :");
    doc.text(`- Monétisation YouTube : ${contractData.youtubeMonetization}`);
    doc.text(`- Clip autorisé : ${contractData.musicVideoAllowed}`);
    doc.text(`- Streams max : ${contractData.maxStreams}`);
    doc.text(`- Ventes max : ${contractData.maxSales}`);
    doc.text(`Crédit obligatoire : ${contractData.creditRequired}`).moveDown(2);

    doc.text("Signature Producteur : ______________________");
    doc.text("Signature Acheteur : ______________________");

    doc.end();
  });
}

const getSupabaseAdmin = () => {
  const supabaseUrl = asNonEmptyString(process.env.SUPABASE_URL) ??
    asNonEmptyString(process.env.VITE_SUPABASE_URL);
  const serviceRoleKey = asNonEmptyString(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

const buildStoragePath = (payload: GeneratePayload): string => {
  const timestamp = Date.now();

  if (payload.purchaseId) {
    const purchaseIdSegment = sanitizePathSegment(payload.purchaseId, `purchase-${Date.now()}`);
    return `contracts/${purchaseIdSegment}/${timestamp}.pdf`;
  }

  const buyerSegment = sanitizePathSegment(payload.buyerIdForPath, "buyer");
  const trackSegment = sanitizePathSegment(payload.trackIdForPath, "track");
  return `contracts/${buyerSegment}-${trackSegment}-${timestamp}.pdf`;
};

const buildPurchaseContractPath = (purchaseId: string): string => {
  const purchaseIdSegment = sanitizePathSegment(purchaseId, `purchase-${Date.now()}`);
  return `contracts/${purchaseIdSegment}/${Date.now()}.pdf`;
};

const uploadContractToSupabase = async (
  supabase: SupabaseAdminClient,
  pdfBuffer: Uint8Array,
  storagePath: string,
) => {
  const { error } = await supabase.storage
    .from(CONTRACT_BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) throw error;
  return storagePath;
};

const getContractSignedUrl = async (
  supabase: SupabaseAdminClient,
  contractPath: string,
  expiresInSeconds: number,
) => {
  const { data, error } = await supabase.storage
    .from(CONTRACT_BUCKET)
    .createSignedUrl(contractPath, expiresInSeconds, { download: true });

  if (error || !data?.signedUrl) throw error ?? new Error("Failed to create signed URL");
  return data.signedUrl;
};

const extractGeneratePayload = (body: Record<string, unknown>): GeneratePayload | null => {
  const buyer = asRecord(body.buyer);
  const track = asRecord(body.track);
  const license = asRecord(body.license);

  if (!buyer || !track || !license) return null;

  const buyerName = asNonEmptyString(buyer.fullName);
  const producerName = asNonEmptyString(track.producerName);
  const trackTitle = asNonEmptyString(track.title);
  const licenseName = asNonEmptyString(license.name);
  const purchaseDate = asNonEmptyString(body.purchaseDate) ?? new Date().toLocaleDateString("fr-FR");

  if (!buyerName || !producerName || !trackTitle || !licenseName) return null;

  const youtubeMonetization = yesNo(asBoolean(license.youtubeMonetization));
  const musicVideoAllowed = yesNo(asBoolean(license.musicVideoAllowed));
  const maxStreams = formatLimit(asPositiveInteger(license.maxStreams));
  const maxSales = formatLimit(asPositiveInteger(license.maxSales));
  const creditRequired = yesNo(asBoolean(license.creditRequired));

  const purchaseId = asNonEmptyString(body.purchaseId);
  const signedUrlExpiresIn = normalizeSignedUrlTtl(body.signedUrlExpiresIn);
  const buyerIdForPath = asNonEmptyString(buyer.id) ?? buyerName;
  const trackIdForPath = asNonEmptyString(track.id) ?? trackTitle;

  return {
    purchaseId,
    signedUrlExpiresIn,
    buyerIdForPath,
    trackIdForPath,
    contractData: {
      producerName,
      buyerName,
      trackTitle,
      purchaseDate,
      licenseName,
      youtubeMonetization,
      musicVideoAllowed,
      maxStreams,
      maxSales,
      creditRequired,
    },
  };
};

const isAuthorized = (
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean => {
  if (!headers) return false;

  const provided = headers["x-contract-secret"] ??
    headers["X-Contract-Secret"] ??
    headers["authorization"] ??
    headers["Authorization"];

  if (!provided) return false;

  const rawToken = Array.isArray(provided) ? provided[0] : provided;
  const token = asNonEmptyString(rawToken);
  if (!token) return false;

  const bearerToken = asNonEmptyString(token.replace(/^Bearer\s+/i, ""));
  return token === CONTRACT_SERVICE_SECRET || bearerToken === CONTRACT_SERVICE_SECRET;
};

const readQueryParam = (query: Record<string, unknown> | undefined, key: string): string | null => {
  if (!query) return null;
  const raw = query[key];

  if (typeof raw === "string") return asNonEmptyString(raw);
  if (Array.isArray(raw)) return asNonEmptyString(raw[0]);
  return null;
};

const authenticateUser = async (
  supabase: SupabaseAdminClient,
  headers: Record<string, string | string[] | undefined> | undefined,
): Promise<SupabaseAuthUser | null> => {
  const authorizationHeader = firstHeaderValue(headers, "authorization");
  const jwt = getBearerToken(authorizationHeader);
  if (!jwt) return null;

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) return null;

  return { id: data.user.id };
};

const getPurchaseById = async (
  supabase: SupabaseAdminClient,
  purchaseId: string,
): Promise<PurchaseLookupResult | null> => {
  const { data, error } = await supabase
    .from("purchases")
    .select("user_id, contract_pdf_path")
    .eq("id", purchaseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as { user_id: string; contract_pdf_path: string | null };

  return {
    user_id: row.user_id,
    contract_pdf_path: row.contract_pdf_path ?? null,
  };
};

const getPurchaseContractSeed = async (
  supabase: SupabaseAdminClient,
  purchaseId: string,
): Promise<PurchaseContractSeed | null> => {
  const { data, error } = await supabase
    .from("purchases")
    .select(`
      id,
      license_type,
      completed_at,
      contract_pdf_path,
      buyer:user_profiles!purchases_user_id_fkey(username, full_name, email),
      product:products!purchases_product_id_fkey(
        title,
        producer:user_profiles!products_producer_id_fkey(username, full_name, email)
      ),
      license:licenses!purchases_license_id_fkey(
        name,
        max_streams,
        max_sales,
        youtube_monetization,
        music_video_allowed,
        credit_required
      )
    `)
    .eq("id", purchaseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const purchase = asRecord(data);
  if (!purchase) return null;

  const buyerRaw = toOne(purchase.buyer as MaybeMany<unknown>);
  const buyer = asRecord(buyerRaw);

  const productRaw = toOne(purchase.product as MaybeMany<unknown>);
  const product = asRecord(productRaw);

  const producerRaw = product ? toOne(product.producer as MaybeMany<unknown>) : null;
  const producer = asRecord(producerRaw);

  const licenseRaw = toOne(purchase.license as MaybeMany<unknown>);
  const license = asRecord(licenseRaw);

  const buyerName = asNonEmptyString(buyer?.full_name) ??
    asNonEmptyString(buyer?.username) ??
    asNonEmptyString(buyer?.email) ??
    "Acheteur";
  const producerName = asNonEmptyString(producer?.full_name) ??
    asNonEmptyString(producer?.username) ??
    asNonEmptyString(producer?.email) ??
    "Producteur";
  const trackTitle = asNonEmptyString(product?.title) ?? "Titre non renseigné";

  const completedAt = asNonEmptyString(purchase.completed_at);
  const purchaseDate = new Date(completedAt ?? Date.now()).toLocaleDateString("fr-FR");

  const licenseName = asNonEmptyString(license?.name) ??
    asNonEmptyString(purchase.license_type) ??
    "Standard";

  const rawDeclaredStoragePath = asNonEmptyString(purchase.contract_pdf_path);
  const declaredStoragePath = rawDeclaredStoragePath
    ? normalizeStoragePathCandidate(rawDeclaredStoragePath)
    : null;

  return {
    declaredStoragePath,
    contractData: {
      producerName,
      buyerName,
      trackTitle,
      purchaseDate,
      licenseName,
      youtubeMonetization: yesNo(asBoolean(license?.youtube_monetization)),
      musicVideoAllowed: yesNo(asBoolean(license?.music_video_allowed)),
      maxStreams: formatLimit(asPositiveInteger(license?.max_streams)),
      maxSales: formatLimit(asPositiveInteger(license?.max_sales)),
      creditRequired: yesNo(asBoolean(license?.credit_required)),
    },
  };
};

async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Cache-Control", "no-store");

  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (method === "GET") {
      const purchaseId = readQueryParam(req.query, "purchaseId");
      const signedUrlExpiresIn = normalizeSignedUrlTtl(readQueryParam(req.query, "expiresIn"));

      if (!purchaseId) {
        return res.status(200).json({ ok: "API detected" });
      }

      const supabase = getSupabaseAdmin();
      const authUser = await authenticateUser(supabase, req.headers);
      if (!authUser) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const purchase = await getPurchaseById(supabase, purchaseId);
      if (!purchase) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      if (purchase.user_id !== authUser.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const normalizedPath = purchase.contract_pdf_path
        ? normalizeStoragePathCandidate(purchase.contract_pdf_path)
        : null;

      if (!normalizedPath) {
        return res.status(404).json({ error: "Contract not generated yet" });
      }

      const signedUrl = await getContractSignedUrl(supabase, normalizedPath, signedUrlExpiresIn);
      return res.status(200).json({
        downloadUrl: signedUrl,
        expiresIn: signedUrlExpiresIn,
        contractPath: normalizedPath,
      });
    }

    if (method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!isAuthorized(req.headers)) {
      console.warn("Unauthorized contract generation attempt", {
        ip: firstHeaderValue(req.headers, "x-forwarded-for"),
        userAgent: firstHeaderValue(req.headers, "user-agent"),
      });
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabaseAdmin();
    const body = parseBody(req.body);
    if (!body) {
      return res.status(400).json({ error: "Body JSON invalide" });
    }

    const purchaseIdFromWebhook = asNonEmptyString(body.purchase_id);
    if (purchaseIdFromWebhook) {
      const signedUrlExpiresIn = normalizeSignedUrlTtl(body.signedUrlExpiresIn);
      const seed = await getPurchaseContractSeed(supabase, purchaseIdFromWebhook);

      if (!seed) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      if (seed.declaredStoragePath && await storageObjectExists(supabase, seed.declaredStoragePath)) {
        const signedUrl = await getContractSignedUrl(supabase, seed.declaredStoragePath, signedUrlExpiresIn);
        return res.status(200).json({
          message: "Contrat déjà généré",
          purchaseId: purchaseIdFromWebhook,
          contractPath: seed.declaredStoragePath,
          downloadUrl: signedUrl,
          expiresIn: signedUrlExpiresIn,
        });
      }

      const pdfBuffer = await generateContractPDF(seed.contractData);
      const storagePath = buildPurchaseContractPath(purchaseIdFromWebhook);

      await uploadContractToSupabase(supabase, pdfBuffer, storagePath);

      const { error: updateError } = await supabase
        .from("purchases")
        .update({ contract_pdf_path: storagePath })
        .eq("id", purchaseIdFromWebhook);

      if (updateError) {
        console.error("[api/contracts] Failed to update purchases.contract_pdf_path", {
          purchaseId: purchaseIdFromWebhook,
          storagePath,
          updateError,
        });
        const { error: cleanupError } = await supabase.storage
          .from(CONTRACT_BUCKET)
          .remove([storagePath]);
        if (cleanupError) {
          console.error("[api/contracts] Failed to cleanup orphaned contract PDF after DB error", {
            purchaseId: purchaseIdFromWebhook,
            storagePath,
            cleanupError,
          });
        }
        return res.status(500).json({ error: "contract_persistence_failed" });
      }

      const signedUrl = await getContractSignedUrl(supabase, storagePath, signedUrlExpiresIn);
      return res.status(200).json({
        message: "Contrat généré",
        purchaseId: purchaseIdFromWebhook,
        contractPath: storagePath,
        downloadUrl: signedUrl,
        expiresIn: signedUrlExpiresIn,
      });
    }

    const payload = extractGeneratePayload(body);
    if (!payload) {
      return res.status(400).json({
        error:
          "Payload invalide. Requis: buyer.fullName, track.producerName, track.title, license.name",
      });
    }

    const pdfBuffer = await generateContractPDF(payload.contractData);
    const storagePath = buildStoragePath(payload);
    await uploadContractToSupabase(supabase, pdfBuffer, storagePath);

    if (payload.purchaseId) {
      const { error: updateError } = await supabase
        .from("purchases")
        .update({ contract_pdf_path: storagePath })
        .eq("id", payload.purchaseId);

      if (updateError) {
        console.error("[api/contracts] Failed to update purchases.contract_pdf_path", {
          purchaseId: payload.purchaseId,
          storagePath,
          updateError,
        });
        const { error: cleanupError } = await supabase.storage
          .from(CONTRACT_BUCKET)
          .remove([storagePath]);
        if (cleanupError) {
          console.error("[api/contracts] Failed to cleanup orphaned contract PDF after DB error", {
            purchaseId: payload.purchaseId,
            storagePath,
            cleanupError,
          });
        }
        return res.status(500).json({ error: "contract_persistence_failed" });
      }
    }

    const signedUrl = await getContractSignedUrl(supabase, storagePath, payload.signedUrlExpiresIn);

    return res.status(200).json({
      message: "Contrat généré",
      contractPath: storagePath,
      downloadUrl: signedUrl,
      expiresIn: payload.signedUrlExpiresIn,
    });
  } catch (error) {
    console.error("[api/contracts] Unexpected error", error);
    return res.status(500).json({ error: "Erreur interne" });
  }
}

export default handler;
