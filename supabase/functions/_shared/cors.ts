export const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://beatelion.com",
  "https://www.beatelion.com",
];

export function resolveCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": "null",
    };
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}
