import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const GET_MASTER_URL_PATH = process.env.GET_MASTER_URL_PATH || "/functions/v1/get-master-url";
const GET_MASTER_URL = new URL(GET_MASTER_URL_PATH, BASE_URL).toString();

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MASTER_TEST_USER_JWT = process.env.MASTER_TEST_USER_JWT || "";
const MASTER_TEST_PRODUCT_ID = process.env.MASTER_TEST_PRODUCT_ID || "";

const hasRuntimeInputs = Boolean(MASTER_TEST_USER_JWT && MASTER_TEST_PRODUCT_ID);
const hasAdmin = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const requestJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const raw = await response.text();

  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  return { response, status: response.status, ok: response.ok, body, raw };
};

const callGetMasterUrl = async (productId: string, jwt: string) => {
  return await requestJson(GET_MASTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ product_id: productId }),
  });
};

test(
  "1) téléchargement normal: signed URL valide pour un user autorisé",
  { skip: !hasRuntimeInputs && "MASTER_TEST_USER_JWT and MASTER_TEST_PRODUCT_ID are required" },
  async () => {
    const result = await callGetMasterUrl(MASTER_TEST_PRODUCT_ID, MASTER_TEST_USER_JWT);

    assert.equal(
      result.status,
      200,
      `get-master-url failed (${result.status}): ${JSON.stringify(result.body ?? result.raw)}`,
    );

    const body = (result.body as { url?: string; expires_in?: number } | null) ?? null;
    assert.ok(body?.url && typeof body.url === "string", "response missing signed url");
    assert.ok(body.url.includes("/storage/v1/object/sign/"), "unexpected signed url format");
    assert.ok(typeof body.expires_in === "number", "response missing expires_in");
    assert.ok(body.expires_in <= 120, `expected expires_in <= 120, got ${body.expires_in}`);
  },
);

test(
  "2) master_path invalide: retourne invalid_master_path",
  {
    skip: (!hasRuntimeInputs || !hasAdmin)
      && "MASTER_TEST_USER_JWT, MASTER_TEST_PRODUCT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are required",
  },
  async () => {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("id, producer_id, master_path")
      .eq("id", MASTER_TEST_PRODUCT_ID)
      .maybeSingle();

    assert.ifError(productError);
    assert.ok(product, "test product not found");
    assert.ok(product.master_path, "test product has no master_path");

    const originalMasterPath = String(product.master_path);
    const invalidMasterPath = `${product.producer_id}/${product.id}/../tampered.wav`;

    const { error: updateError } = await supabaseAdmin
      .from("products")
      .update({ master_path: invalidMasterPath })
      .eq("id", MASTER_TEST_PRODUCT_ID);

    assert.ifError(updateError);

    try {
      const result = await callGetMasterUrl(MASTER_TEST_PRODUCT_ID, MASTER_TEST_USER_JWT);
      const body = (result.body as { code?: string; error?: string } | null) ?? null;

      assert.equal(
        result.status,
        500,
        `expected 500 invalid_master_path, got ${result.status}: ${JSON.stringify(result.body ?? result.raw)}`,
      );
      assert.equal(body?.code, "invalid_master_path", `unexpected error code: ${body?.code}`);
    } finally {
      await supabaseAdmin
        .from("products")
        .update({ master_path: originalMasterPath })
        .eq("id", MASTER_TEST_PRODUCT_ID);
    }
  },
);

test(
  "3) rate-limit: >30 appels/min retourne 429 rate_limit_exceeded",
  { skip: !hasRuntimeInputs && "MASTER_TEST_USER_JWT and MASTER_TEST_PRODUCT_ID are required" },
  async () => {
    let hitRateLimit = false;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await callGetMasterUrl(MASTER_TEST_PRODUCT_ID, MASTER_TEST_USER_JWT);
      const body = (result.body as { code?: string } | null) ?? null;

      if (result.status === 429 && body?.code === "rate_limit_exceeded") {
        hitRateLimit = true;
        break;
      }
    }

    assert.ok(hitRateLimit, "expected to hit get-master-url rate limit (429 rate_limit_exceeded)");
  },
);
