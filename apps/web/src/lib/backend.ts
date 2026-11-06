import { getServerEnv } from "@motion-dna/config";

type Parser<T> = { parse: (value: unknown) => T };

/** The browser calls a same-origin route; only this server module knows the API URL. */
export async function proxyBackend<T>(request: Request, path: string, schema: Parser<T>): Promise<Response> {
  const candidate = request.headers.get("x-request-id");
  const requestId = candidate && /^[a-zA-Z0-9_-]{1,64}$/.test(candidate) ? candidate : crypto.randomUUID();
  const started = performance.now();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  let status = 503;
  try {
    const { API_BASE_URL } = getServerEnv();
    const upstream = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "X-Request-ID": requestId },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) throw new Error("upstream_unavailable");
    const data = schema.parse(await upstream.json());
    status = 200;
    return Response.json(data, { headers });
  } catch {
    return Response.json({ error: {
      code: "SERVICE_UNAVAILABLE",
      message: "The local API is unavailable or returned an invalid response. Check that the API is running.",
      request_id: requestId,
    } }, { status, headers });
  } finally {
    console.info(JSON.stringify({
      level: status === 200 ? "info" : "warn", event: "backend_request",
      path, status, request_id: requestId, duration_ms: Math.round(performance.now() - started),
    }));
  }
}
