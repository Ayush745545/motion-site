import { listJobs } from "@/lib/server/renders";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return Response.json({ jobs: await listJobs(request.headers.get("cookie"), request.headers.get("origin")) }, { headers: { "Cache-Control": "no-store" } }); } catch { return Response.json({ error: { message: "The durable render queue is unavailable." } }, { status: 503 }); } }
