import { renderControl } from "@/lib/server/render-control";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { return renderControl(request, (await params).id, "cancel"); }
