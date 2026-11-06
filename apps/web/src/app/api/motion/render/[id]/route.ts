import { readJob, RenderServiceError } from "@/lib/server/renders";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  try { const { id } = await params; const job = await readJob(id, new URL(request.url).searchParams.get("project_id") ?? undefined, request.headers.get("cookie"), request.headers.get("origin")); return Response.json(job ?? { error: { message: "Render job not found." } }, { status: job ? 200 : 404, headers }); }
  catch (error) { return Response.json({ error: { message: "Render job unavailable." } }, { status: error instanceof RenderServiceError ? error.status : 404, headers }); }
}
