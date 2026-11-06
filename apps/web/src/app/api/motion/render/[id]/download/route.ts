import { z } from "zod";
import { renderAPI } from "@/lib/server/renders";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const projectId = new URL(request.url).searchParams.get("project_id");
    if (!projectId) return Response.json({ error: { message: "Project reference is required." } }, { status: 404 });
    z.uuid().parse(projectId);
    const range = request.headers.get("range");
    const response = await renderAPI(`/${id}/download?project_id=${projectId}`, {
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(600000)]),
    }, request.headers.get("cookie"), request.headers.get("origin"));
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const key of ["content-type", "content-length", "content-disposition", "content-range", "accept-ranges"]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ error: { message: "Video not found or render service unavailable." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
