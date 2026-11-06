import { z } from "zod";
import { getServerEnv } from "@motion-dna/config";
import { controlRender, RenderServiceError } from "./renders";
export async function renderControl(request: Request, id: string, action: "cancel" | "retry") {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) return Response.json({ error: { message: "Origin not allowed." } }, { status: 403, headers });
  try {
    const text = await request.text(); if (text.length > 1024) return Response.json({ error: { message: "Request too large." } }, { status: 413, headers });
    const body = z.object({ project_id: z.uuid() }).strict().parse(JSON.parse(text));
    return Response.json(await controlRender(id, action, body.project_id, request.headers.get("cookie"), origin), { headers });
  } catch (error) { return Response.json({ error: { message: error instanceof RenderServiceError ? error.message : "Invalid render control request." } }, { status: error instanceof RenderServiceError ? error.status : 422, headers }); }
}
