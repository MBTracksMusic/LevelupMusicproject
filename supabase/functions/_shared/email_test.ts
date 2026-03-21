import {
  buildStandardEmailShell,
  classifySendError,
  getEmailConfig,
  normalizeCampaignKey,
  normalizeEmailForKey,
  normalizeNewsKey,
  resolveMarketingSendWindow,
} from "./email.ts";

Deno.test("marketing shell includes unsubscribe and preferences", () => {
  const result = buildStandardEmailShell({
    type: "marketing",
    title: "News",
    bodyHtml: "<p>Hello</p>",
    bodyText: "Hello",
  });

  if (!result.html.includes("Unsubscribe:")) throw new Error("missing unsubscribe html");
  if (!result.text.includes("Preferences:")) throw new Error("missing preferences text");
});

Deno.test("transactional shell omits unsubscribe and includes support guidance", () => {
  const result = buildStandardEmailShell({
    type: "transactional",
    title: "Receipt",
    bodyHtml: "<p>Hello</p>",
    bodyText: "Hello",
  });

  if (result.html.includes("Unsubscribe:")) throw new Error("unexpected unsubscribe html");
  if (!result.text.includes("Need help?")) throw new Error("missing support text");
});

Deno.test("email and business keys are normalized consistently", () => {
  if (normalizeEmailForKey("  USER@Example.COM ") !== "user@example.com") {
    throw new Error("email normalization failed");
  }
  if (normalizeCampaignKey(" Waitlist Launch ") !== "waitlist_launch") {
    throw new Error("campaign normalization failed");
  }
  if (normalizeNewsKey(" News:Video 01 ") !== "news:video_01") {
    throw new Error("news normalization failed");
  }
});

Deno.test("missing resend env vars fail with actionable error", () => {
  const previousApiKey = Deno.env.get("RESEND_API_KEY");
  const previousFrom = Deno.env.get("RESEND_FROM_EMAIL");
  Deno.env.delete("RESEND_API_KEY");
  Deno.env.delete("RESEND_FROM_EMAIL");

  try {
    let threw = false;
    try {
      getEmailConfig();
    } catch (error) {
      threw = true;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Missing required email configuration")) {
        throw new Error("expected actionable config error");
      }
    }
    if (!threw) throw new Error("expected getEmailConfig to throw");
  } finally {
    if (previousApiKey) Deno.env.set("RESEND_API_KEY", previousApiKey);
    if (previousFrom) Deno.env.set("RESEND_FROM_EMAIL", previousFrom);
  }
});

Deno.test("warmup mode caps marketing sends only", () => {
  const previousWarmup = Deno.env.get("EMAIL_DOMAIN_WARMUP_MODE");
  const previousLimit = Deno.env.get("EMAIL_MAX_BATCH_SIZE");
  const previousEnabled = Deno.env.get("EMAIL_MARKETING_SENDS_ENABLED");
  const previousWarmupDay = Deno.env.get("EMAIL_WARMUP_DAY");
  const previousApiKey = Deno.env.get("RESEND_API_KEY");
  const previousFrom = Deno.env.get("RESEND_FROM_EMAIL");

  Deno.env.set("EMAIL_DOMAIN_WARMUP_MODE", "true");
  Deno.env.set("EMAIL_MAX_BATCH_SIZE", "25");
  Deno.env.set("EMAIL_MARKETING_SENDS_ENABLED", "true");
  Deno.env.set("EMAIL_WARMUP_DAY", "3");
  Deno.env.set("RESEND_API_KEY", previousApiKey ?? "test_key");
  Deno.env.set("RESEND_FROM_EMAIL", previousFrom ?? "Beatelion <contact@beatelion.com>");

  try {
    const window = resolveMarketingSendWindow(40, "email-test");
    if (window.allowedCount !== 25 || window.warmupLimited !== true) {
      throw new Error("warmup window did not cap send volume");
    }
  } finally {
    if (previousWarmup) Deno.env.set("EMAIL_DOMAIN_WARMUP_MODE", previousWarmup);
    else Deno.env.delete("EMAIL_DOMAIN_WARMUP_MODE");
    if (previousLimit) Deno.env.set("EMAIL_MAX_BATCH_SIZE", previousLimit);
    else Deno.env.delete("EMAIL_MAX_BATCH_SIZE");
    if (previousEnabled) Deno.env.set("EMAIL_MARKETING_SENDS_ENABLED", previousEnabled);
    else Deno.env.delete("EMAIL_MARKETING_SENDS_ENABLED");
    if (previousWarmupDay) Deno.env.set("EMAIL_WARMUP_DAY", previousWarmupDay);
    else Deno.env.delete("EMAIL_WARMUP_DAY");
    if (previousApiKey) Deno.env.set("RESEND_API_KEY", previousApiKey);
    else Deno.env.delete("RESEND_API_KEY");
    if (previousFrom) Deno.env.set("RESEND_FROM_EMAIL", previousFrom);
    else Deno.env.delete("RESEND_FROM_EMAIL");
  }
});

Deno.test("ambiguous provider errors are not blindly retried", () => {
  const classification = classifySendError(new Error("Network timeout while sending"));
  if (classification.nextState !== "sending" || classification.ambiguous !== true) {
    throw new Error("expected ambiguous timeout classification");
  }
});
