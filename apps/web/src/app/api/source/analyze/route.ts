import { getServerEnv } from "@motion-dna/config";
import { SourceDNASchema } from "@motion-dna/dna-schema";
import { z } from "zod";

export const runtime = "nodejs";
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const githubRequest = z.object({ github_url: z.string().url().max(2048) }).strict();
const sourceRequest = z.object({ source_name: z.string().min(1).max(180), source: z.string().min(1).max(2 * 1024 * 1024) }).strict();
const errorHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return data;
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const env = getServerEnv();
    if (origin && !env.CORS_ALLOWED_ORIGINS.includes(origin)) {
      return Response.json({ error: { message: "Origin not allowed." } }, { status: 403, headers: errorHeaders });
    }
    const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    let body: BodyInit;
    let contentType: string;
    let sourceFilename: string | null = null;
    if (mediaType === "application/zip" || mediaType === "application/x-zip-compressed") {
      const data = await readBoundedBody(request, MAX_ZIP_BYTES);
      if (!data) return Response.json({ error: { message: "Choose a ZIP smaller than 20 MB." } }, { status: 413, headers: errorHeaders });
      if (!data.byteLength) return Response.json({ error: { message: "Choose a ZIP smaller than 20 MB." } }, { status: 413, headers: errorHeaders });
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      body = bytes.buffer as ArrayBuffer;
      contentType = "application/zip";
      sourceFilename = (request.headers.get("x-source-filename") || "Source project.zip").slice(0, 255);
    } else if (mediaType === "application/json") {
      const data = await readBoundedBody(request, 2_100_000);
      if (!data) return Response.json({ error: { message: "Source request is too large." } }, { status: 413, headers: errorHeaders });
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); } catch { return Response.json({ error: { message: "Invalid source request." } }, { status: 422, headers: errorHeaders }); }
      const github = githubRequest.safeParse(parsed);
      const source = sourceRequest.safeParse(parsed);
      if (!github.success && !source.success) return Response.json({ error: { message: "Provide a public GitHub repository URL or a supported source file." } }, { status: 422, headers: errorHeaders });
      body = JSON.stringify(github.success ? github.data : source.data);
      contentType = "application/json";
    } else {
      return Response.json({ error: { message: "Upload a ZIP archive or provide JSON input." } }, { status: 415, headers: errorHeaders });
    }
    const headers = new Headers({ "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
    if (sourceFilename) headers.set("X-Source-Filename", sourceFilename);
    const response = await fetch(`${env.API_BASE_URL}/api/source/analyze`, {
      method: "POST", body, headers, cache: "no-store", signal: AbortSignal.timeout(30000),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const parsed = z.object({ detail: z.string().max(500).optional(), error: z.object({ message: z.string().max(500) }).optional() }).safeParse(payload);
      const message = parsed.success ? parsed.data.detail || parsed.data.error?.message : undefined;
      return Response.json({ error: { message: message || "Static source analysis failed. Retry with a smaller source project." } }, { status: response.status, headers: errorHeaders });
    }
    return Response.json(SourceDNASchema.parse(payload), { headers: errorHeaders });
  } catch {
    return Response.json({ error: { message: "Source analysis is unavailable or returned an invalid result. Check the local API and retry." } }, { status: 503, headers: errorHeaders });
  }
}
