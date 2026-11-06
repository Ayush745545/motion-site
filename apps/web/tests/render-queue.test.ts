import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/render-jobs/route";
import { listJobs } from "../src/lib/server/renders";
import { RenderQueueSchema } from "../src/lib/render-schema";
vi.mock("../src/lib/server/renders",()=>({listJobs:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
describe("real local render queue",()=>{
 it("returns an honest empty archive",async()=>{vi.mocked(listJobs).mockResolvedValue([]);const response=await GET(new Request("http://localhost/api/render-jobs"));expect(response.status).toBe(200);expect(await response.json()).toEqual({jobs:[]});});
 it("returns persisted progress and an MP4 link only when recorded",async()=>{const job={id:"12345678-1234-4234-8234-123456789012",project_name:"Atlas",status:"completed" as const,progress:100,stage:"MP4 ready",created_at:new Date().toISOString(),updated_at:new Date().toISOString(),download_url:"/api/motion/render/12345678-1234-4234-8234-123456789012/download"};vi.mocked(listJobs).mockResolvedValue([job]);expect(await (await GET(new Request("http://localhost/api/render-jobs"))).json()).toEqual({jobs:[job]});});
 it("rejects malformed external progress and unsafe download links",()=>{expect(RenderQueueSchema.safeParse({jobs:[{id:"x",project_name:"X",status:"completed",progress:999}]}).success).toBe(false);expect(RenderQueueSchema.safeParse({jobs:[{id:"x",project_name:"X",status:"completed",progress:100,download_url:"https://evil.example"}]}).success).toBe(false);});
 it("sanitizes filesystem errors",async()=>{vi.mocked(listJobs).mockRejectedValue(new Error("private filesystem details"));const response=await GET(new Request("http://localhost/api/render-jobs"));expect(response.status).toBe(503);expect(await response.text()).not.toContain("private filesystem");});
});
