import { getServerEnv } from "@motion-dna/config";
export const runtime = "nodejs";

async function proxy(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) return Response.json({ error: { message: "Origin not allowed." } }, { status: 403 });
  try {
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    const cookie = request.headers.get("cookie"); if (cookie) headers.set("cookie", cookie);
    if (origin) headers.set("origin", origin);
    const response = await fetch(`${getServerEnv().API_BASE_URL}/api/projects`, { method: request.method, headers, body: request.method === "POST" ? await request.arrayBuffer() : undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "Content-Type": response.headers.get("content-type") || "application/json" });
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch { return Response.json({ error: { message: "Project storage is unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}

export const GET = proxy;
export const POST = proxy;
