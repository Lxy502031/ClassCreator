export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  origin: string | null,
  productionOrigin: string | null
): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-headers", "authorization, apikey, content-type");
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("vary", "Origin");
  } else if (productionOrigin) {
    headers.set("access-control-allow-origin", productionOrigin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function getRequestOrigin(request: Request): {
  origin: string | null;
  productionOrigin: string | null;
  allowedOrigin: boolean;
} {
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/$/, "");
  const productionOrigin = siteUrl ? new URL(siteUrl).origin : null;
  const origin = request.headers.get("origin");
  const allowedLocalOrigins = new Set([
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8083",
    "http://localhost:8097",
    "http://localhost:8099",
    "http://localhost:8100",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
    "http://127.0.0.1:8083",
    "http://127.0.0.1:8097",
    "http://127.0.0.1:8099",
    "http://127.0.0.1:8100"
  ]);
  return {
    origin,
    productionOrigin,
    allowedOrigin: origin === productionOrigin || (origin !== null && allowedLocalOrigins.has(origin))
  };
}
