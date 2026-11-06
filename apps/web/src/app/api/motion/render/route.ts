import { ZodError } from "zod";
import { getServerEnv } from "@motion-dna/config";
import { RenderServiceError, startRender } from "@/lib/server/renders";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) return Response.json({ error: { message: "Origin not allowed." } }, { status: 403, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) return Response.json({ error: { message: "Missing composition." } }, { status: 422, headers });
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2950000) { await reader.cancel(); return Response.json({ error: { message: "Composition exceeds the 2.95 MB request limit." } }, { status: 413, headers }); } chunks.push(value); }
    const job = await startRender(JSON.parse(Buffer.concat(chunks).toString("utf8")), request.headers.get("cookie"), origin);
    return Response.json(job, { status: 202, headers });
  } catch (error) {
    const status = error instanceof ZodError || error instanceof SyntaxError ? 422 : error instanceof RenderServiceError ? error.status : 422;
    const message = error instanceof RenderServiceError || error instanceof Error && /valid local image/.test(error.message) ? error.message : "The project, assets, or output settings are invalid.";
    return Response.json({ error: { message } }, { status, headers });
  }
}
