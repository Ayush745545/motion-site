import { getServerEnv } from "@motion-dna/config";

export const runtime = "nodejs";
const allowed = new Set(["login", "register", "logout", "session"]);

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length !== 1 || !allowed.has(path[0] ?? "")) {
    return Response.json({ error: { message: "Unknown account route." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) {
    return Response.json({ error: { message: "Origin not allowed." } }, { status: 403 });
  }
  try {
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const cookie = request.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    if (origin) headers.set("origin", origin);
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const response = await fetch(`${getServerEnv().API_BASE_URL}/api/auth/${path[0]}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "set-cookie", "x-request-id", "retry-after"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: { message: "The local account service is unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = proxy;
export const POST = proxy;
