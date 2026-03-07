const trimString = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Resolve the canonical contract generation endpoint.
 * Preferred: CONTRACT_GENERATE_ENDPOINT (full URL).
 * Legacy fallback: CONTRACT_SERVICE_URL + "/generate-contract".
 */
export function resolveContractGenerateEndpoint(env, logger = console) {
  const explicitEndpoint = trimString(env?.CONTRACT_GENERATE_ENDPOINT);
  if (explicitEndpoint) {
    if (!isValidHttpUrl(explicitEndpoint)) {
      return {
        endpoint: null,
        source: "CONTRACT_GENERATE_ENDPOINT",
        error: "invalid_contract_generate_endpoint",
      };
    }
    return {
      endpoint: explicitEndpoint,
      source: "CONTRACT_GENERATE_ENDPOINT",
      error: null,
    };
  }

  const legacyBaseUrl = trimString(env?.CONTRACT_SERVICE_URL);
  if (!legacyBaseUrl) {
    return {
      endpoint: null,
      source: "missing",
      error: "missing_contract_generate_endpoint",
    };
  }

  const legacyEndpoint = legacyBaseUrl.endsWith("/generate-contract")
    ? legacyBaseUrl
    : `${legacyBaseUrl.replace(/\/$/, "")}/generate-contract`;

  if (!isValidHttpUrl(legacyEndpoint)) {
    return {
      endpoint: null,
      source: "CONTRACT_SERVICE_URL_FALLBACK",
      error: "invalid_contract_service_url",
    };
  }

  logger?.warn?.(
    "[contract-generation] CONTRACT_SERVICE_URL fallback is deprecated. Set CONTRACT_GENERATE_ENDPOINT to the full URL (for example: https://your-host/api/generate-contract).",
  );

  return {
    endpoint: legacyEndpoint,
    source: "CONTRACT_SERVICE_URL_FALLBACK",
    error: null,
  };
}

/**
 * Calls the contract generation endpoint with the shared secret.
 */
export async function invokeContractGeneration({
  endpoint,
  secret,
  purchaseId,
  timeoutMs = 8000,
  fetchImpl = fetch,
}) {
  const safeEndpoint = trimString(endpoint);
  const safeSecret = trimString(secret);
  const safePurchaseId = trimString(purchaseId);

  if (!safeEndpoint) {
    return { ok: false, status: null, error: "missing_endpoint", body: null };
  }

  if (!safeSecret) {
    return { ok: false, status: null, error: "missing_contract_service_secret", body: null };
  }

  if (!safePurchaseId) {
    return { ok: false, status: null, error: "missing_purchase_id", body: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  try {
    const response = await fetchImpl(safeEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${safeSecret}`,
      },
      body: JSON.stringify({ purchase_id: safePurchaseId }),
      signal: controller.signal,
    });

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: "request_failed",
        body: bodyText,
      };
    }

    return {
      ok: true,
      status: response.status,
      error: null,
      body: bodyText,
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: null,
      error: isTimeout ? "request_timeout" : "request_exception",
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
