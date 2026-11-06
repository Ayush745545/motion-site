import { getServerEnv } from "@motion-dna/config";

export const runtime = "nodejs";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!path.length || path.some(segment => !/^[A-Za-z0-9._-]{1,180}$/.test(segment))) {
    return Response.json({ error: { message: "Invalid project route." } }, { status: 404 });
  }
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) {
    return Response.json({ error: { message: "Origin not allowed." } }, { status: 403 });
  }
  try {
    const incoming = new URL(request.url);
    const target = new URL(`${getServerEnv().API_BASE_URL}/api/projects/${path.map(encodeURIComponent).join("/")}`);
    target.search = incoming.search;
    const headers = new Headers();
    for (const name of ["cookie", "content-type", "x-file-name"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (origin) headers.set("origin", origin);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const responseHeaders = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition", "content-security-policy", "x-request-id"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: { message: "Project storage is unavailable." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = proxy;
export const PUT = proxy;
export const POST = proxy;
export const DELETE = proxy;
