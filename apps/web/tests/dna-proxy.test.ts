import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/dna/[...path]/route";
const id = "12345678-1234-4234-8234-123456789012";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
afterEach(() => vi.unstubAllGlobals());
describe("DNA proxy", () => {
  it("accepts an owned job request and forwards its project reference", async () => {
    const job = {job_id:id,status:"queued",created_at:new Date().toISOString(),analysis_id:null,error:null,error_code:null};
    const fetcher=vi.fn().mockResolvedValue(Response.json(job,{status:202})); vi.stubGlobal("fetch",fetcher);
    const response=await POST(new Request("http://localhost:3000/api/dna/analyze",{method:"POST",body:JSON.stringify({url:"https://example.com",project_id:id})}),context(["analyze"]));
    expect(response.status).toBe(202); expect(await response.json()).toEqual(job);
    expect(fetcher.mock.calls[0]?.[1].body).toBe(`{"url":"https://example.com","project_id":"${id}"}`);
  });
  it("rejects cross-origin requests without contacting the API", async () => {
    const fetcher=vi.fn(); vi.stubGlobal("fetch",fetcher);
    const response=await POST(new Request("http://localhost:3000/api/dna/analyze",{method:"POST",headers:{Origin:"https://evil.example"},body:'{}'}),context(["analyze"]));
    expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds inbound requests and denies arbitrary upstream paths", async () => {
    expect((await POST(new Request("http://localhost:3000/api/dna/analyze",{method:"POST",body:"x".repeat(5000)}),context(["analyze"]))).status).toBe(413);
    expect((await GET(new Request("http://localhost:3000/api/dna/health"),context(["health"]))).status).toBe(404);
  });
  it("rejects malformed upstream analysis instead of displaying invented results", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({palette:[]})));
    expect((await GET(new Request(`http://localhost:3000/api/dna/results/${id}`),context(["results",id]))).status).toBe(503);
  });
  it("preserves actionable, sanitized backend errors", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:{message:"Internal addresses are blocked."}},{status:422})));
    const response=await POST(new Request("http://localhost:3000/api/dna/analyze",{method:"POST",body:JSON.stringify({url:"http://127.0.0.1",project_id:id})}),context(["analyze"]));
    expect(response.status).toBe(422); expect(await response.json()).toEqual({error:{message:"Internal addresses are blocked."}});
  });
});
