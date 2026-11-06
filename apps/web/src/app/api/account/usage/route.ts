import { getServerEnv } from "@motion-dna/config";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const response = await fetch(`${getServerEnv().API_BASE_URL}/api/account/usage`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    return new Response(response.body, { status: response.status, headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json" } });
  } catch { return Response.json({ error: { message: "Account usage is unavailable." } }, { status: 503 }); }
}
