import { getServerEnv } from "@motion-dna/config";
import { DNAJobSchema, DNAResultSchema } from "@motion-dna/dna-schema";
import { z } from "zod";

const id = "[0-9a-f-]{36}";
async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  const screenshot = new RegExp(`^results/${id}/screenshots/viewport$`).test(route);
  const valid = request.method === "POST" ? route === "analyze" : new RegExp(`^(jobs|results)/${id}$`).test(route) || screenshot;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!valid) return Response.json({ error: { message: "Unknown analysis route." } }, { status: 404, headers });
  try {
    let body: string | undefined;
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) return Response.json({ error: { message: "Origin not allowed." } }, { status: 403, headers });
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (!reader) throw new Error("input");
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); return Response.json({ error: { message: "Request too large." } }, { status: 413, headers }); } chunks.push(value); }
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = z.object({ url: z.string().min(1).max(2048), project_id: z.uuid() }).strict().safeParse(JSON.parse(raw));
      if (!parsed.success) return Response.json({ error: { message: "Enter a public website URL." } }, { status: 422, headers });
      body = JSON.stringify(parsed.data);
    }
    const upstreamHeaders = new Headers({ "Content-Type": "application/json" });
    const cookie = request.headers.get("cookie"); if (cookie) upstreamHeaders.set("cookie", cookie);
    const upstreamOrigin = request.headers.get("origin"); if (upstreamOrigin) upstreamHeaders.set("origin", upstreamOrigin);
    const response = await fetch(`${getServerEnv().API_BASE_URL}/api/dna/${route}`, { method: request.method, body, headers: upstreamHeaders, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      const parsed = z.object({ error: z.object({ message: z.string().max(400) }) }).safeParse(await response.json());
      return Response.json({ error: { message: parsed.success ? parsed.data.error.message : "Analysis is unavailable. Please retry." } }, { status: response.status, headers });
    }
    if (screenshot) return new Response(await response.arrayBuffer(), { headers: { ...headers, "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'; sandbox" } });
    const schema = route.startsWith("results/") ? DNAResultSchema : DNAJobSchema;
    return Response.json(schema.parse(await response.json()), { status: response.status, headers });
  } catch {
    return Response.json({ error: { message: "The analyzer is unavailable or returned an invalid response. Check the local API and retry." } }, { status: 503, headers });
  }
}
export const GET = proxy;
export const POST = proxy;
