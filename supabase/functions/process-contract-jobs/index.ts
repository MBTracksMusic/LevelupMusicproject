import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
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
