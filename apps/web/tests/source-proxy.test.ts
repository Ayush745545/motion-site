import { afterEach, describe, expect, it, vi } from "vitest";
import sourceResult from "./fixtures/source-next-dna.json";
import { POST } from "../src/app/api/source/analyze/route";

afterEach(() => vi.unstubAllGlobals());

describe("source analyzer proxy", () => {
  it("validates the static source result and forwards only supported GitHub input", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(sourceResult));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_url: "https://github.com/example/source-next" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).source_type).toBe("local_directory");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8000/api/source/analyze");
    expect(fetcher.mock.calls[0]?.[1].body).toBe('{"github_url":"https://github.com/example/source-next"}');
  });

  it("streams ZIPs with a fixed maximum and preserves only its filename header", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(sourceResult));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/zip", "X-Source-Filename": "sample.zip" },
      body: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    }));
    expect(response.status).toBe(200);
    const options = fetcher.mock.calls[0]?.[1];
    expect(new Headers(options?.headers).get("content-type")).toBe("application/zip");
    expect(new Headers(options?.headers).get("x-source-filename")).toBe("sample.zip");
  });

  it("rejects oversized, malformed and cross-origin requests before contacting the API", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const oversized = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/zip", "Content-Length": String(20 * 1024 * 1024 + 1) },
      body: "small",
    }));
    const malformed = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "not-json",
    }));
    const denied = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}",
    }));
    expect(oversized.status).toBe(413);
    expect(malformed.status).toBe(422);
    expect(denied.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not display malformed upstream DNA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ schema_version: "1.0" })));
    const response = await POST(new Request("http://localhost:3000/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_url: "https://github.com/example/repository" }),
    }));
    expect(response.status).toBe(503);
  });
});
