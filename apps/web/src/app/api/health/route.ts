import { HealthResponseSchema } from "@motion-dna/dna-schema";
import { proxyBackend } from "@/lib/backend";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return proxyBackend(request, "/api/health", HealthResponseSchema);
}
