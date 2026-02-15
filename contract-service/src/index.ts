import "dotenv/config";
import fs from "node:fs/promises";
import express, { type Request, type Response } from "express";
import { Resend } from "resend";
import serverless from "serverless-http";
import { supabase } from "./supabaseClient.js";
import { generatePDF } from "./generatePDF.js";
import type {
  ContractPdfPayload,
  LicensePayload,
  PurchaseContractPayload,
} from "./types.js";

const app = express();
app.use(express.json());

const contractServiceSecret = process.env.CONTRACT_SERVICE_SECRET;
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const contractBucket = process.env.CONTRACT_BUCKET || "contracts";
const resendFrom =
  process.env.RESEND_FROM_EMAIL ||
  process.env.EMAIL_FROM ||
  "LevelUpMusic <noreply@levelupmusic.com>";
const supportEmail = process.env.SUPPORT_EMAIL || "support@levelupmusic.com";
const attachContractToEmail = process.env.ATTACH_CONTRACT_TO_EMAIL === "true";
const maxEmailSendAttempts = 3;
const emailRetryBaseDelayMs = 400;
const emailLockTimeoutMs = 5 * 60 * 1000;
const emailLockMarkerOffsetMs = 1000 * 60 * 60 * 24 * 365 * 200;
const emailLockMarkerYearThreshold = 2100;

if (!contractServiceSecret) {
  throw new Error("Missing CONTRACT_SERVICE_SECRET");
}

type MaybeMany<T> = T | T[] | null | undefined;

const toOne = <T>(value: MaybeMany<T>): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const maskEmail = (email: string) => {
  const [localRaw, domainRaw] = email.split("@");
  if (!localRaw || !domainRaw) return "invalid_email";

  const local =
    localRaw.length <= 2 ? `${localRaw.slice(0, 1)}*` : `${localRaw.slice(0, 2)}***`;
  const [domainNameRaw, ...domainSuffixParts] = domainRaw.split(".");
  const domainName = domainNameRaw
    ? (domainNameRaw.length <= 2
      ? `${domainNameRaw.slice(0, 1)}*`
      : `${domainNameRaw.slice(0, 2)}***`)
    : "*";
  const suffix = domainSuffixParts.length > 0 ? `.${domainSuffixParts.join(".")}` : "";

  return `${local}@${domainName}${suffix}`;
};

const getResendStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return null;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
};

const parseIsoMillis = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildEmailLockMarker = (nowMs: number) =>
  new Date(nowMs + emailLockMarkerOffsetMs).toISOString();

const getEmailLockClaimStartedAtMs = (value: string | null | undefined): number | null => {
  const parsedMs = parseIsoMillis(value);
  if (parsedMs === null) return null;
  if (new Date(parsedMs).getUTCFullYear() < emailLockMarkerYearThreshold) return null;
  return parsedMs - emailLockMarkerOffsetMs;
};

const summarizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      statusCode: getResendStatusCode(error),
    };
  }

  if (error && typeof error === "object") {
    const maybeName = "name" in error ? (error as { name?: unknown }).name : undefined;
    const maybeMessage = "message" in error ? (error as { message?: unknown }).message : undefined;
    return {
      name: typeof maybeName === "string" ? maybeName : "UnknownError",
      message: typeof maybeMessage === "string" ? maybeMessage : "Unknown error object",
      statusCode: getResendStatusCode(error),
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    statusCode: null,
  };
};

const isNetworkLikeError = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      const details = maybeMessage.toLowerCase();
      if (/fetch|network|timeout|abort|socket|econnreset|enotfound|etimedout/.test(details)) {
        return true;
      }
    }
  }

  if (!(error instanceof Error)) return false;
  const details = `${error.name} ${error.message}`.toLowerCase();
  return /fetch|network|timeout|abort|socket|econnreset|enotfound|etimedout/.test(details);
};

const isRetryableNotificationError = (error: unknown) => {
  const statusCode = getResendStatusCode(error);
  if (statusCode === 429) return true;
  if (statusCode !== null && statusCode >= 500) return true;
  if (statusCode !== null) return false;
  return isNetworkLikeError(error);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeStoragePath = (rawPath: string) => {
  const normalized = rawPath.trim().replace(/^\/+/, "");
  if (!normalized) return null;
  if (normalized.includes("..")) return null;
  return normalized;
};

const toBucketRelativePath = (rawPath: string, bucket: string) => {
  const normalized = normalizeStoragePath(rawPath);
  if (!normalized) return null;
  return normalized.replace(new RegExp(`^${escapeRegExp(bucket)}/`), "");
};

const buildStoragePathCandidates = (rawPath: string, bucket: string) => {
  const normalized = normalizeStoragePath(rawPath);
  if (!normalized) return [];

  const bucketRelative = toBucketRelativePath(normalized, bucket);
  const candidates = [
    bucketRelative,
    normalized,
    bucketRelative ? `${bucket}/${bucketRelative}` : null,
  ].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
};

const extractStoragePathFromCandidate = (candidate: string | null | undefined, bucket: string) => {
  if (!candidate) return null;

  if (!/^https?:\/\//i.test(candidate)) {
    return normalizeStoragePath(candidate);
  }

  try {
    const parsedUrl = new URL(candidate);
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const bucketIndex = segments.findIndex((segment) => segment === bucket);

    if (bucketIndex < 0) {
      return null;
    }

    const objectPath = decodeURIComponent(segments.slice(bucketIndex + 1).join("/"));
    return normalizeStoragePath(objectPath);
  } catch {
    return null;
  }
};

const yesNo = (value: boolean) => (value ? "Oui" : "Non");

const formatNumberLimit = (value: number | null) =>
  value === null ? "Illimite" : value.toLocaleString("fr-FR");

const buildLicensePresentation = (
  license: LicensePayload | null,
  fallbackLicenseName: string,
  producerName: string,
) => {
  const resolvedName = (license?.name || fallbackLicenseName || "Standard").trim();
  const resolvedDescription =
    license?.description ||
    "Licence musicale numerique conforme aux termes de LevelUpMusic.";

  const rights = [
    { label: "Streams max", value: formatNumberLimit(license?.max_streams ?? null) },
    { label: "Ventes max", value: formatNumberLimit(license?.max_sales ?? null) },
    { label: "Monetisation YouTube", value: yesNo(license?.youtube_monetization ?? false) },
    { label: "Clip video autorise", value: yesNo(license?.music_video_allowed ?? false) },
    { label: "Licence exclusive autorisee", value: yesNo(license?.exclusive_allowed ?? false) },
  ];

  const creditClause = license?.credit_required ?? true
    ? `Credit obligatoire: "Prod by ${producerName}" sur toute diffusion publique.`
    : "Aucune obligation de credit explicite n'est imposee par cette licence.";

  return {
    name: resolvedName,
    description: resolvedDescription,
    rights,
    creditClause,
    creditRequired: license?.credit_required ?? true,
  };
};

async function createSignedUrl(
  bucket: string,
  rawPath: string,
  options?: { expiresIn?: number; downloadName?: string },
) {
  const extractedPath = extractStoragePathFromCandidate(rawPath, bucket);
  const sourcePath = extractedPath || normalizeStoragePath(rawPath);
  if (!sourcePath) {
    return null;
  }

  const pathCandidates = buildStoragePathCandidates(sourcePath, bucket);
  const expiresIn = options?.expiresIn ?? 60 * 60 * 24 * 7;

  for (const pathCandidate of pathCandidates) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(pathCandidate, expiresIn, {
        download: options?.downloadName || true,
      });

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  }

  return null;
}

async function downloadContractPdfFromStorage(bucket: string, rawPath: string) {
  const extractedPath = extractStoragePathFromCandidate(rawPath, bucket);
  const sourcePath = extractedPath || normalizeStoragePath(rawPath);
  if (!sourcePath) {
    return { buffer: null as Buffer | null, resolvedPath: null as string | null, error: "invalid_storage_path" as unknown };
  }

  const pathCandidates = buildStoragePathCandidates(sourcePath, bucket);
  let lastError: unknown = null;

  for (const pathCandidate of pathCandidates) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(pathCandidate);

    if (error || !data) {
      lastError = error;
      continue;
    }

    const arrayBuffer = await data.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      resolvedPath: pathCandidate,
      error: null as unknown,
    };
  }

  return {
    buffer: null as Buffer | null,
    resolvedPath: pathCandidates[0] ?? null,
    error: lastError,
  };
}

async function sendPurchaseConfirmationEmail(params: {
  purchaseId: string;
  buyerEmail: string;
  buyerName: string;
  producerName: string;
  trackTitle: string;
  storagePath: string;
  licensePresentation: ReturnType<typeof buildLicensePresentation>;
  fileBuffer: Buffer | null;
}) {
  const { purchaseId, buyerEmail, buyerName, producerName, trackTitle, storagePath, licensePresentation } = params;
  const maskedBuyerEmail = maskEmail(buyerEmail);

  if (!resend) {
    console.warn("[contract-service] Missing RESEND_API_KEY, skipping confirmation email", { purchaseId });
    return false;
  }

  const contractDownloadUrl = await createSignedUrl(contractBucket, storagePath, {
    expiresIn: 60 * 60 * 24 * 7,
    downloadName: `contrat-${purchaseId}.pdf`,
  });

  const rightsHtml = licensePresentation.rights
    .map((row) => `<li style="margin:0 0 6px 0;"><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.value)}</li>`)
    .join("");

  const safeTrackTitle = escapeHtml(trackTitle);
  const safeProducerName = escapeHtml(producerName);
  const safeLicenseName = escapeHtml(licensePresentation.name);
  const safeBuyerName = escapeHtml(buyerName);
  const safeLicenseDescription = escapeHtml(licensePresentation.description);
  const safeCreditClause = escapeHtml(licensePresentation.creditClause);
  const safeSupportEmail = escapeHtml(supportEmail);

  const contractLinkBlock = contractDownloadUrl
    ? `<a href="${escapeHtml(contractDownloadUrl)}" style="display:inline-block;padding:10px 14px;background:#e11d48;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-right:8px;">Telecharger le contrat</a>`
    : "<span style=\"display:inline-block;padding:10px 14px;background:#27272a;color:#d4d4d8;border-radius:8px;\">Contrat disponible dans le dashboard</span>";

  const html = `
    <div style="background:#0f1115;padding:32px 16px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e8eaed;">
      <div style="max-width:660px;margin:0 auto;background:#171a21;border:1px solid #2a2f3a;border-radius:12px;padding:28px;">
        <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#ffffff;">Confirmation d'achat LevelUpMusic</h1>
        <p style="margin:0 0 18px 0;color:#b8bfcc;">Bonjour ${safeBuyerName}, votre achat est confirme et votre licence est active.</p>

        <div style="background:#11141a;border:1px solid #2a2f3a;border-radius:10px;padding:14px 16px;margin:0 0 18px 0;">
          <p style="margin:0 0 8px 0;"><strong style="color:#ffffff;">Titre :</strong> ${safeTrackTitle}</p>
          <p style="margin:0 0 8px 0;"><strong style="color:#ffffff;">Producteur :</strong> ${safeProducerName}</p>
          <p style="margin:0 0 8px 0;"><strong style="color:#ffffff;">Licence :</strong> ${safeLicenseName}</p>
          <p style="margin:0;"><strong style="color:#ffffff;">Description :</strong> ${safeLicenseDescription}</p>
        </div>

        <h2 style="margin:0 0 8px 0;font-size:16px;color:#ffffff;">Droits et limites</h2>
        <ul style="margin:0 0 14px 18px;padding:0;color:#d2d7e1;">${rightsHtml}</ul>
        <p style="margin:0 0 18px 0;color:#d2d7e1;"><strong>Credit:</strong> ${safeCreditClause}</p>

        <div style="margin:0 0 18px 0;">${contractLinkBlock}</div>

        <p style="margin:0;color:#8f98aa;font-size:12px;">Support: <a href="mailto:${safeSupportEmail}" style="color:#fda4af;">${safeSupportEmail}</a></p>
      </div>
    </div>
  `;

  const emailPayload: Parameters<Resend["emails"]["send"]>[0] = {
    from: resendFrom,
    to: buyerEmail,
    subject: `Votre achat ${trackTitle} est confirme`,
    html,
  };

  if (attachContractToEmail) {
    let attachmentBuffer = params.fileBuffer;

    if (!attachmentBuffer) {
      const { buffer, resolvedPath, error: downloadError } = await downloadContractPdfFromStorage(contractBucket, storagePath);
      if (!buffer) {
        console.warn("[contract-service] Failed to download contract for email attachment", {
          purchaseId,
          resolvedPath,
          downloadError,
        });
      } else {
        attachmentBuffer = buffer;
      }
    }

    if (attachmentBuffer) {
      emailPayload.attachments = [
        {
          filename: `contract-${purchaseId}.pdf`,
          content: attachmentBuffer.toString("base64"),
        },
      ];
    }
  }

  for (let attempt = 1; attempt <= maxEmailSendAttempts; attempt += 1) {
    try {
      const result = await resend.emails.send(emailPayload, {
        idempotencyKey: `contract-email-${purchaseId}`,
      });

      if (!result.error) {
        return true;
      }

      const retryable = isRetryableNotificationError(result.error);
      console.error("[contract-service] Resend rejected confirmation email", {
        purchaseId,
        buyer: maskedBuyerEmail,
        attempt,
        retryable,
        errorCode: result.error.name,
        statusCode: result.error.statusCode,
        message: result.error.message,
      });

      if (!retryable || attempt >= maxEmailSendAttempts) {
        return false;
      }
    } catch (error) {
      const retryable = isRetryableNotificationError(error);
      console.error("[contract-service] Resend request failed", {
        purchaseId,
        buyer: maskedBuyerEmail,
        attempt,
        retryable,
        statusCode: getResendStatusCode(error),
        error: summarizeError(error),
      });

      if (!retryable || attempt >= maxEmailSendAttempts) {
        return false;
      }
    }

    const retryDelay = emailRetryBaseDelayMs * (2 ** (attempt - 1));
    await sleep(retryDelay);
  }

  return false;
}

app.get("/health", (_req: Request, res: Response) => {
  return res.json({ status: "ok" });
});

app.post("/generate-contract", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${contractServiceSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const purchaseId = typeof req.body?.purchase_id === "string"
    ? req.body.purchase_id
    : "";

  if (!purchaseId) {
    return res.status(400).json({ error: "Missing purchase_id" });
  }

  try {
    const { data, error } = await supabase
      .from("purchases")
      .select(`
        id,
        license_id,
        license_type,
        contract_pdf_path,
        contract_email_sent_at,
        completed_at,
        buyer:user_profiles!purchases_user_id_fkey(username, full_name, email),
        product:products!purchases_product_id_fkey(
          title,
          producer:user_profiles!products_producer_id_fkey(username, email)
        ),
        license:licenses!purchases_license_id_fkey(
          id,
          name,
          description,
          max_streams,
          max_sales,
          youtube_monetization,
          music_video_allowed,
          credit_required,
          exclusive_allowed,
          price
        )
      `)
      .eq("id", purchaseId)
      .single();

    if (error) {
      console.error("[contract-service] Purchase fetch failed", error);
      return res.status(500).json({ error: "Failed to load purchase" });
    }

    type QueryRow = {
      id: string;
      license_id: string | null;
      license_type: string | null;
      contract_pdf_path: string | null;
      contract_email_sent_at: string | null;
      completed_at: string | null;
      buyer: MaybeMany<{ username: string | null; full_name: string | null; email: string | null }>;
      product: MaybeMany<{
        title: string | null;
        producer: MaybeMany<{ username: string | null; email: string | null }>;
      }>;
      license: MaybeMany<LicensePayload>;
    };

    const rawPurchase = data as QueryRow | null;

    if (!rawPurchase) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    const buyer = toOne(rawPurchase.buyer);
    const product = toOne(rawPurchase.product);
    const producer = toOne(product?.producer ?? null);
    const license = toOne(rawPurchase.license);

    const purchase: PurchaseContractPayload = {
      id: rawPurchase.id,
      license_id: rawPurchase.license_id,
      license_type: rawPurchase.license_type,
      contract_pdf_path: rawPurchase.contract_pdf_path,
      contract_email_sent_at: rawPurchase.contract_email_sent_at,
      completed_at: rawPurchase.completed_at,
      buyer: buyer
        ? {
            username: buyer.username,
            full_name: buyer.full_name,
            email: buyer.email,
          }
        : null,
      product: product
        ? {
            title: product.title,
            producer: producer
              ? {
                  username: producer.username,
                  email: producer.email,
                }
              : null,
          }
        : null,
      license,
    };

    const producerName = purchase.product?.producer?.username || "Producteur";
    const buyerName = purchase.buyer?.full_name || purchase.buyer?.username || "Acheteur";
    const buyerEmail = purchase.buyer?.email || null;
    const trackTitle = purchase.product?.title || "Titre";
    const contractDate = new Date(purchase.completed_at || Date.now()).toLocaleDateString("fr-FR");
    const fallbackLicenseName = purchase.license_type || "Standard";
    const licensePresentation = buildLicensePresentation(
      purchase.license,
      fallbackLicenseName,
      producerName,
    );

    const pdfPayload: ContractPdfPayload = {
      purchaseId,
      contractDate,
      producerName,
      buyerName,
      trackTitle,
      licenseName: licensePresentation.name,
      licenseDescription: licensePresentation.description,
      rights: licensePresentation.rights,
      creditClause: licensePresentation.creditClause,
    };

    const tmpPath = `/tmp/${purchaseId}.pdf`;
    const rawStoragePath = purchase.contract_pdf_path || `contracts/${purchaseId}.pdf`;
    const storagePath = normalizeStoragePath(rawStoragePath) || `contracts/${purchaseId}.pdf`;
    const shouldGeneratePdf = !purchase.contract_pdf_path;
    const existingEmailSentAt = purchase.contract_email_sent_at;
    const existingEmailLockClaimStartedAtMs = getEmailLockClaimStartedAtMs(existingEmailSentAt);
    const existingEmailLockAgeMs = existingEmailLockClaimStartedAtMs === null
      ? null
      : Date.now() - existingEmailLockClaimStartedAtMs;
    const hasEmailLockMarker = existingEmailLockClaimStartedAtMs !== null;
    const hasStaleEmailLock = hasEmailLockMarker &&
      existingEmailLockAgeMs !== null &&
      existingEmailLockAgeMs >= emailLockTimeoutMs;
    const shouldSendEmail = !existingEmailSentAt || hasStaleEmailLock;

    let fileBuffer: Buffer | null = null;
    let generatedNow = false;

    if (shouldGeneratePdf) {
      try {
        await generatePDF(tmpPath, pdfPayload);
        fileBuffer = await fs.readFile(tmpPath);

        const { error: uploadError } = await supabase.storage
          .from(contractBucket)
          .upload(storagePath, fileBuffer, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (uploadError) {
          console.error("[contract-service] Upload failed", uploadError);
          return res.status(500).json({ error: "Failed to upload contract PDF" });
        }
      } finally {
        await fs.unlink(tmpPath).catch(() => undefined);
      }

      const { error: updateError } = await supabase
        .from("purchases")
        .update({ contract_pdf_path: storagePath })
        .eq("id", purchaseId);

      if (updateError) {
        console.error("[contract-service] Purchase update failed", updateError);
        return res.status(500).json({ error: "Failed to update purchase contract path" });
      }

      generatedNow = true;
    }

    let emailSent = false;
    let emailLockClaimedAt: string | null = null;
    const maskedBuyerEmail = buyerEmail ? maskEmail(buyerEmail) : null;

    if (!shouldSendEmail) {
      if (hasEmailLockMarker) {
        console.log("[contract-service] Notification email claim already in progress", {
          purchaseId,
          lockAgeMs: existingEmailLockAgeMs,
        });
      } else {
        console.log("[contract-service] Notification email already sent", { purchaseId, storagePath });
      }
    } else if (!buyerEmail) {
      console.warn("[contract-service] Missing buyer email, skipping confirmation email", { purchaseId });
    } else {
      const claimTimestamp = buildEmailLockMarker(Date.now());
      let claimQuery = supabase
        .from("purchases")
        .update({ contract_email_sent_at: claimTimestamp })
        .eq("id", purchaseId);

      if (hasStaleEmailLock && existingEmailSentAt) {
        claimQuery = claimQuery.eq("contract_email_sent_at", existingEmailSentAt);
      } else {
        claimQuery = claimQuery.is("contract_email_sent_at", null);
      }

      const { data: claimedRow, error: claimError } = await claimQuery
        .select("id")
        .maybeSingle();

      if (claimError) {
        console.error("[contract-service] Failed to claim email send lock", {
          purchaseId,
          claimMode: hasStaleEmailLock ? "stale_lock_reclaim" : "fresh_claim",
          claimError,
        });
      } else if (!claimedRow) {
        console.log("[contract-service] Notification email already claimed or sent", { purchaseId });
      } else {
        emailLockClaimedAt = claimTimestamp;

        try {
          emailSent = await sendPurchaseConfirmationEmail({
            purchaseId,
            buyerEmail,
            buyerName,
            producerName,
            trackTitle,
            storagePath,
            licensePresentation,
            fileBuffer,
          });
        } catch (emailError) {
          // Email failures are intentionally non-blocking for purchase + contract flow.
          console.error("[contract-service] Failed to send confirmation email", {
            purchaseId,
            buyer: maskedBuyerEmail,
            error: summarizeError(emailError),
          });
        }

        if (!emailSent) {
          const { error: rollbackClaimError } = await supabase
            .from("purchases")
            .update({ contract_email_sent_at: null })
            .eq("id", purchaseId)
            .eq("contract_email_sent_at", claimTimestamp);

          if (rollbackClaimError) {
            console.error("[contract-service] Failed to rollback email send lock", {
              purchaseId,
              rollbackClaimError,
            });
          }
        }
      }
    }

    if (emailSent && emailLockClaimedAt) {
      const { error: markEmailSentError } = await supabase
        .from("purchases")
        .update({ contract_email_sent_at: new Date().toISOString() })
        .eq("id", purchaseId)
        .eq("contract_email_sent_at", emailLockClaimedAt);

      if (markEmailSentError) {
        console.error("[contract-service] Failed to mark contract email as sent", {
          purchaseId,
          markEmailSentError,
        });
      }
    }

    const status = generatedNow
      ? (emailSent ? "contract_generated_and_notified" : "contract_generated")
      : (emailSent ? "already_generated_notified" : "already_generated");

    return res.json({ status, path: storagePath, email_sent: emailSent });
  } catch (error) {
    console.error("[contract-service] Unexpected error", error);
    return res.status(500).json({ error: "Internal error" });
  }
});

app.all("/generate-contract", (_req: Request, res: Response) => {
  res.setHeader("Allow", "POST");
  return res.status(405).json({
    error: "Method Not Allowed",
    message: "Use POST on /generate-contract",
  });
});

export default serverless(app);
