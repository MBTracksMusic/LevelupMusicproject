import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeContractGeneration,
  resolveContractGenerateEndpoint,
} from "../../supabase/functions/_shared/contract-generation.js";

test("resolveContractGenerateEndpoint uses explicit CONTRACT_GENERATE_ENDPOINT when provided", () => {
  const warnings = [];
  const resolved = resolveContractGenerateEndpoint(
    {
      CONTRACT_GENERATE_ENDPOINT: "https://example.com/api/generate-contract",
      CONTRACT_SERVICE_URL: "https://legacy.example.com",
    },
    { warn: (message) => warnings.push(message) },
  );

  assert.equal(resolved.endpoint, "https://example.com/api/generate-contract");
  assert.equal(resolved.source, "CONTRACT_GENERATE_ENDPOINT");
  assert.equal(resolved.error, null);
  assert.equal(warnings.length, 0);
});

test("resolveContractGenerateEndpoint falls back to CONTRACT_SERVICE_URL + /generate-contract with warning", () => {
  const warnings = [];
  const resolved = resolveContractGenerateEndpoint(
    {
      CONTRACT_SERVICE_URL: "https://legacy.example.com/base/",
    },
    { warn: (message) => warnings.push(message) },
  );

  assert.equal(resolved.endpoint, "https://legacy.example.com/base/generate-contract");
  assert.equal(resolved.source, "CONTRACT_SERVICE_URL_FALLBACK");
  assert.equal(resolved.error, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /deprecated/i);
});

test("resolveContractGenerateEndpoint returns error when no endpoint config exists", () => {
  const resolved = resolveContractGenerateEndpoint({});
  assert.equal(resolved.endpoint, null);
  assert.equal(resolved.error, "missing_contract_generate_endpoint");
});

test("invokeContractGeneration sends purchase payload and auth header", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const result = await invokeContractGeneration({
    endpoint: "https://example.com/api/generate-contract",
    secret: "secret-value",
    purchaseId: "purchase-123",
    fetchImpl: fakeFetch,
    timeoutMs: 3000,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/api/generate-contract");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.headers?.Authorization, "Bearer secret-value");
  assert.equal(calls[0].init?.body, JSON.stringify({ purchase_id: "purchase-123" }));
});

test("invokeContractGeneration reports non-2xx failures", async () => {
  const fakeFetch = async () => {
    return new Response("unauthorized", { status: 401 });
  };

  const result = await invokeContractGeneration({
    endpoint: "https://example.com/api/generate-contract",
    secret: "bad-secret",
    purchaseId: "purchase-123",
    fetchImpl: fakeFetch,
    timeoutMs: 3000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, "request_failed");
});

test(
  "endpoint contract check: canonical endpoint should not return 404",
  {
    skip: !process.env.CONTRACT_GENERATE_ENDPOINT && "CONTRACT_GENERATE_ENDPOINT not set",
  },
  async () => {
    const endpoint = process.env.CONTRACT_GENERATE_ENDPOINT;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-test-secret",
      },
      body: JSON.stringify({ purchase_id: "00000000-0000-0000-0000-000000000000" }),
    });

    assert.notEqual(response.status, 404, `Expected non-404 from canonical endpoint ${endpoint}`);
    assert.ok(
      response.status === 401 || response.status === 403 || response.status === 400 || response.status === 422,
      `Expected auth/validation response, got ${response.status}`,
    );
  },
);
