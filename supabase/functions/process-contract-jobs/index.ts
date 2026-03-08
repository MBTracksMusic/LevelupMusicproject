import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";
import { invokeContractGeneration, resolveContractGenerateEndpoint } from "../_shared/contract-generation.js";

const INTERNAL_SECRET_HEADER = "x-contract-worker-secret";

const corsHeaders = {
  "Access-Control-Allow-Origin": "null",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, Authorization, ${INTERNAL_SECRET_HEADER}`,
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface ContractGenerationJobRow {
  id: string;
  purchase_id: string;
  attempts: number;
  status: string;
}

const asNonEmptyString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeLimit = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(value)));
};

const normalizeWorkerName = (value: unknown) => {
  const worker = asNonEmptyString(value);
  return worker ?? `contract-worker-${crypto.randomUUID()}`;
};

const computeBackoffSeconds = (attempts: number) => {
  const safeAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const base = 30 * Math.pow(2, Math.max(0, safeAttempts - 1));
  return Math.min(3600, Math.max(60, Math.floor(base)));
};

const sendContractEmailAndStamp = async (
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  purchaseId: string,
  contractPath: string,
) => {
  const { data: purchaseRow, error: purchaseReadError } = await supabaseAdmin
    .from("purchases")
    .select("user_id, contract_email_sent_at")
    .eq("id", purchaseId)
    .maybeSingle();

  if (purchaseReadError) {
    console.error("[process-contract-jobs] failed to load purchase for contract email", {
      purchaseId,
      contractPath,
      purchaseReadError,
    });
    return;
  }

  if (!purchaseRow?.user_id) {
    console.error("[process-contract-jobs] missing purchase row/user_id for contract email", {
      purchaseId,
      contractPath,
    });
    return;
  }

  if (purchaseRow.contract_email_sent_at) {
    return;
  }

  const { data: buyer, error: buyerError } = await supabaseAdmin
    .from("user_profiles")
    .select("email, username, full_name")
    .eq("id", purchaseRow.user_id)
    .maybeSingle();

  if (buyerError) {
    console.error("[process-contract-jobs] failed to load buyer profile for contract email", {
      purchaseId,
      contractPath,
      buyerError,
    });
    return;
  }

  const recipientEmail = asNonEmptyString(buyer?.email);
  if (!recipientEmail) {
    console.warn("[process-contract-jobs] no recipient email for contract notification", {
      purchaseId,
      contractPath,
      userId: purchaseRow.user_id,
    });
    return;
  }

  const resendApiKey = asNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  if (!resendApiKey) {
    console.warn("[process-contract-jobs] RESEND_API_KEY not configured, skipping contract email", {
      purchaseId,
      contractPath,
      recipientEmail,
    });
    return;
  }

  const resendFromEmail = asNonEmptyString(Deno.env.get("RESEND_FROM_EMAIL")) ?? "onboarding@resend.dev";
  const buyerName = asNonEmptyString(buyer?.full_name) ?? asNonEmptyString(buyer?.username) ?? "Utilisateur";
  const resend = new Resend(resendApiKey);

  try {
    await resend.emails.send({
      from: resendFromEmail,
      to: recipientEmail,
      subject: "Votre contrat Beatelion est disponible",
      text: `Bonjour ${buyerName}, votre contrat est maintenant disponible dans votre dashboard Beatelion.`,
      html: `
        <div lang="fr" style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111">
          <h1 style="margin:0 0 12px;">Votre contrat est disponible</h1>
          <p style="margin:0 0 16px;">Bonjour ${buyerName},</p>
          <p style="margin:0 0 16px;">Votre contrat de licence est pret. Vous pouvez le telecharger depuis votre dashboard Beatelion.</p>
          <p style="margin:0;">Reference achat: ${purchaseId}</p>
        </div>
      `,
    });
  } catch (emailError) {
    console.error("[process-contract-jobs] failed to send contract email", {
      purchaseId,
      contractPath,
      recipientEmail,
      emailError,
    });
    return;
  }

  const { error: stampError } = await supabaseAdmin
    .from("purchases")
    .update({ contract_email_sent_at: new Date().toISOString() })
    .eq("id", purchaseId)
    .is("contract_email_sent_at", null);

  if (stampError) {
    console.error("[process-contract-jobs] failed to stamp contract_email_sent_at", {
      purchaseId,
      contractPath,
      recipientEmail,
      stampError,
    });
    return;
  }

  console.log("[process-contract-jobs] contract email sent", {
    purchaseId,
    contractPath,
    recipientEmail,
  });
};

const createAdminClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const requireWorkerSecret = (req: Request): Response | null => {
  const configuredSecret = asNonEmptyString(Deno.env.get("CONTRACT_SERVICE_SECRET"));
  if (!configuredSecret) {
    console.error("[process-contract-jobs] missing CONTRACT_SERVICE_SECRET");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const provided =
    req.headers.get(INTERNAL_SECRET_HEADER) ??
    req.headers.get("Authorization");

  const token = asNonEmptyString(provided?.replace(/^Bearer\s+/i, "") ?? provided);
  if (!token || token !== configuredSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  return null;
};

const markJobSucceeded = async (
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  jobId: string,
  purchaseId: string,
) => {
  const nowIso = new Date().toISOString();

  const { error: jobError } = await supabaseAdmin
    .from("contract_generation_jobs")
    .update({
      status: "succeeded",
      last_error: null,
      next_run_at: nowIso,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("id", jobId);

  if (jobError) {
    console.error("[process-contract-jobs] failed to mark job succeeded", {
      jobId,
      purchaseId,
      jobError,
    });
  }

  const { error: purchaseError } = await supabaseAdmin
    .from("purchases")
    .update({
      contract_generated_by: "contract_worker",
      contract_generated_at: nowIso,
    })
    .eq("id", purchaseId)
    .not("contract_pdf_path", "is", null);

  if (purchaseError) {
    console.error("[process-contract-jobs] failed to stamp purchase provenance", {
      jobId,
      purchaseId,
      purchaseError,
    });
  }
};

const markJobFailed = async (
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  job: ContractGenerationJobRow,
  reason: string,
) => {
  const attempts = Number.isFinite(job.attempts) ? Number(job.attempts) : 1;
  const backoffSeconds = computeBackoffSeconds(attempts);
  const nowMs = Date.now();

  const { error } = await supabaseAdmin
    .from("contract_generation_jobs")
    .update({
      status: "failed",
      last_error: reason,
      next_run_at: new Date(nowMs + backoffSeconds * 1000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date(nowMs).toISOString(),
    })
    .eq("id", job.id);

  if (error) {
    console.error("[process-contract-jobs] failed to mark job failed", {
      jobId: job.id,
      purchaseId: job.purchase_id,
      reason,
      error,
    });
  }
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const authError = requireWorkerSecret(req);
  if (authError) return authError;

  try {
    const resolvedEndpoint = resolveContractGenerateEndpoint({
      CONTRACT_GENERATE_ENDPOINT: Deno.env.get("CONTRACT_GENERATE_ENDPOINT"),
      CONTRACT_SERVICE_URL: Deno.env.get("CONTRACT_SERVICE_URL"),
    });
    const contractServiceSecret = Deno.env.get("CONTRACT_SERVICE_SECRET");

    if (!resolvedEndpoint.endpoint || !contractServiceSecret?.trim()) {
      console.error("[process-contract-jobs] missing endpoint or secret", {
        source: resolvedEndpoint.source,
        endpointError: resolvedEndpoint.error,
        hasSecret: Boolean(contractServiceSecret?.trim()),
      });
      return new Response(JSON.stringify({ error: "Contract generator misconfigured" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const supabaseAdmin = createAdminClient();
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const limit = normalizeLimit(body.limit);
    const worker = normalizeWorkerName(body.worker);

    const { data: claimedRows, error: claimError } = await supabaseAdmin.rpc("claim_contract_generation_jobs", {
      p_limit: limit,
      p_worker: worker,
    });

    if (claimError) {
      console.error("[process-contract-jobs] claim rpc failed", claimError);
      return new Response(JSON.stringify({ error: "Failed to claim contract jobs" }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    const jobs = (claimedRows ?? []) as ContractGenerationJobRow[];
    const results: Array<Record<string, unknown>> = [];
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      const purchaseId = asNonEmptyString(job.purchase_id);
      if (!purchaseId) {
        failed += 1;
        const reason = "invalid_purchase_id";
        await markJobFailed(supabaseAdmin, job, reason);
        results.push({ job_id: job.id, status: "failed", reason });
        continue;
      }

      const invokeResult = await invokeContractGeneration({
        endpoint: resolvedEndpoint.endpoint,
        secret: contractServiceSecret,
        purchaseId,
        timeoutMs: 8000,
      });

      if (!invokeResult.ok) {
        failed += 1;
        const reason = [
          invokeResult.error,
          invokeResult.status ? `status=${invokeResult.status}` : null,
          asNonEmptyString(invokeResult.body),
        ].filter((value): value is string => Boolean(value)).join(" | ");

        await markJobFailed(supabaseAdmin, job, reason || "generation_failed");
        results.push({
          job_id: job.id,
          purchase_id: purchaseId,
          status: "failed",
          reason: reason || "generation_failed",
        });
        continue;
      }

      const { data: refreshedPurchase, error: refreshedPurchaseError } = await supabaseAdmin
        .from("purchases")
        .select("contract_pdf_path")
        .eq("id", purchaseId)
        .maybeSingle();

      const contractPath = asNonEmptyString(refreshedPurchase?.contract_pdf_path);
      if (refreshedPurchaseError || !contractPath) {
        failed += 1;
        const reason = refreshedPurchaseError
          ? `purchase_refresh_failed:${refreshedPurchaseError.message}`
          : "contract_path_missing_after_generation";
        await markJobFailed(supabaseAdmin, job, reason);
        results.push({
          job_id: job.id,
          purchase_id: purchaseId,
          status: "failed",
          reason,
        });
        continue;
      }

      succeeded += 1;
      await markJobSucceeded(supabaseAdmin, job.id, purchaseId);
      await sendContractEmailAndStamp(supabaseAdmin, purchaseId, contractPath);
      results.push({
        job_id: job.id,
        purchase_id: purchaseId,
        status: "succeeded",
        contract_path: contractPath,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      worker,
      claimed: jobs.length,
      succeeded,
      failed,
      results,
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("[process-contract-jobs] unexpected error", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
