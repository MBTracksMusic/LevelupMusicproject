import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.CONTRACT_API_BASE_URL || "http://localhost:3000";
const GENERATE_PATH = process.env.CONTRACT_GENERATE_PATH || "/api/generate-contract";
const GET_CONTRACT_URL_PATH = process.env.GET_CONTRACT_URL_PATH || "/functions/v1/get-contract-url";
const CONTRACT_BUCKET = process.env.CONTRACT_BUCKET || "contracts";
const CONTRACT_SERVICE_SECRET = process.env.CONTRACT_SERVICE_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TEST_USER_JWT = process.env.CONTRACT_TEST_USER_JWT || "";
const GET_URL_TEST_PURCHASE_ID = process.env.CONTRACT_TEST_PURCHASE_ID || "";

const joinUrl = (base, path) => new URL(path, base).toString();
const GENERATE_URL = joinUrl(BASE_URL, GENERATE_PATH);
const GET_CONTRACT_URL = joinUrl(BASE_URL, GET_CONTRACT_URL_PATH);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizePathSegment = (value, fallback) => {
  if (!value) return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized.length > 0 ? normalized : fallback;
};

const requestJson = async (url, init) => {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  return { response, status: response.status, ok: response.ok, body, raw };
};

const makeGeneratePayload = (purchaseId, signedUrlExpiresIn = 999_999) => ({
  purchaseId,
  signedUrlExpiresIn,
  purchaseDate: "2026-03-05",
  buyer: {
    id: "itest-buyer",
    fullName: "Integration Buyer",
  },
  track: {
    id: "itest-track",
    title: "Integration Track",
    producerName: "Integration Producer",
  },
  license: {
    name: "Standard",
    youtubeMonetization: true,
    musicVideoAllowed: true,
    maxStreams: 1000,
    maxSales: 100,
    creditRequired: true,
  },
});

const generateContract = async (purchaseId, signedUrlExpiresIn = 999_999) => {
  return await requestJson(GENERATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONTRACT_SERVICE_SECRET}`,
    },
    body: JSON.stringify(makeGeneratePayload(purchaseId, signedUrlExpiresIn)),
  });
};

const hasGenerateAuth = Boolean(CONTRACT_SERVICE_SECRET);
const hasSupabaseAdmin = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const hasGetContractUrlInputs = Boolean(TEST_USER_JWT && GET_URL_TEST_PURCHASE_ID);

test(
  "Test 1 — double génération: deux chemins contrats différents pour le même purchase_id",
  { skip: !hasGenerateAuth && "CONTRACT_SERVICE_SECRET is required" },
  async () => {
    const purchaseId = `itest-contract-${Date.now()}`;
    const expectedPrefix = `contracts/${sanitizePathSegment(purchaseId, "purchase")}/`;

    const first = await generateContract(purchaseId);
    assert.equal(
      first.status,
      200,
      `first generation failed (${first.status}): ${JSON.stringify(first.body ?? first.raw)}`,
    );
    assert.ok(first.body?.contractPath, "first response missing contractPath");

    await sleep(10);

    const second = await generateContract(purchaseId);
    assert.equal(
      second.status,
      200,
      `second generation failed (${second.status}): ${JSON.stringify(second.body ?? second.raw)}`,
    );
    assert.ok(second.body?.contractPath, "second response missing contractPath");

    const firstPath = String(first.body.contractPath);
    const secondPath = String(second.body.contractPath);

    assert.notEqual(
      firstPath,
      secondPath,
      `Expected immutable contract paths; got same path: ${firstPath}`,
    );

    assert.match(firstPath, new RegExp(`^${expectedPrefix}\\d+\\.pdf$`));
    assert.match(secondPath, new RegExp(`^${expectedPrefix}\\d+\\.pdf$`));
  },
);

test(
  "Test 2 — overwrite impossible: upload manuel sur path existant retourne une erreur",
  { skip: (!hasGenerateAuth || !hasSupabaseAdmin) && "CONTRACT_SERVICE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are required" },
  async () => {
    const purchaseId = `itest-overwrite-${Date.now()}`;
    const generated = await generateContract(purchaseId);
    assert.equal(
      generated.status,
      200,
      `generation failed (${generated.status}): ${JSON.stringify(generated.body ?? generated.raw)}`,
    );

    const existingPath = String(generated.body?.contractPath || "");
    assert.ok(existingPath, "missing contractPath for overwrite test");

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bytes = new TextEncoder().encode("manual overwrite attempt");
    const { error } = await supabaseAdmin.storage
      .from(CONTRACT_BUCKET)
      .upload(existingPath, bytes, {
        contentType: "application/pdf",
        upsert: false,
      });

    assert.ok(error, "expected upload conflict error, but upload succeeded");
    assert.match(
      String(error.message || ""),
      /(exist|duplicate|conflict|already)/i,
      `unexpected overwrite error message: ${error.message}`,
    );
  },
);

test(
  "Test 3 — signed URL courte: expiration <= 600s",
  { skip: !hasGenerateAuth && "CONTRACT_SERVICE_SECRET is required" },
  async () => {
    const purchaseId = `itest-expiry-${Date.now()}`;
    const generated = await generateContract(purchaseId, 999_999);
    assert.equal(
      generated.status,
      200,
      `generation failed (${generated.status}): ${JSON.stringify(generated.body ?? generated.raw)}`,
    );

    const expiresIn = Number(generated.body?.expiresIn);
    assert.ok(Number.isFinite(expiresIn), `invalid expiresIn: ${generated.body?.expiresIn}`);
    assert.ok(expiresIn <= 600, `expected expiresIn <= 600, got ${expiresIn}`);
  },
);

test(
  "Test 3bis (optionnel) — get-contract-url retourne expires_in <= 600",
  { skip: !hasGetContractUrlInputs && "CONTRACT_TEST_USER_JWT and CONTRACT_TEST_PURCHASE_ID are required" },
  async () => {
    const response = await requestJson(GET_CONTRACT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_USER_JWT}`,
      },
      body: JSON.stringify({ purchase_id: GET_URL_TEST_PURCHASE_ID }),
    });

    assert.equal(
      response.status,
      200,
      `get-contract-url failed (${response.status}): ${JSON.stringify(response.body ?? response.raw)}`,
    );

    const expiresIn = Number(response.body?.expires_in);
    assert.ok(Number.isFinite(expiresIn), `invalid expires_in: ${response.body?.expires_in}`);
    assert.ok(expiresIn <= 600, `expected expires_in <= 600, got ${expiresIn}`);
  },
);
