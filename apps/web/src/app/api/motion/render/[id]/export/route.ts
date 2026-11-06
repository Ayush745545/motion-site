import { getServerEnv } from "@motion-dna/config";
import { RenderServiceError, deleteRenderExport } from "@/lib/server/renders";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (origin && !getServerEnv().CORS_ALLOWED_ORIGINS.includes(origin)) {
    return Response.json({ error: { message: "Origin not allowed." } }, { status: 403, headers });
  }
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId) return Response.json({ error: { message: "Project reference is required." } }, { status: 404, headers });
  try {
    const result = await deleteRenderExport((await params).id, projectId, request.headers.get("cookie"), origin);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof RenderServiceError ? error.message : "The export could not be removed." } },
      { status: error instanceof RenderServiceError ? error.status : 422, headers },
    );
  }
}
