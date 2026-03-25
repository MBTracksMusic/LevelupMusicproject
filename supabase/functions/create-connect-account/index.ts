import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  console.warn("[create-connect-account] Deprecated endpoint - use stripe-connect-onboarding");
  return new Response(
    JSON.stringify({
      error: "Deprecated",
      message: "This endpoint is deprecated. Use stripe-connect-onboarding instead.",
    }),
    {
      status: 410,
      headers: { "Content-Type": "application/json" },
    },
  );
});
