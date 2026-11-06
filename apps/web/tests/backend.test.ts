import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "../src/app/api/health/route";
import { GET as ready } from "../src/app/api/ready/route";

const healthy = { status: "ok", service: "motion-dna-ai-api", version: "0.1.0", environment: "test" };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("API_BASE_URL", "http://127.0.0.1:8000");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockReset(); });

describe("health proxy", () => {
  it("validates upstream health and propagates a safe correlation ID", async () => {
    fetchMock.mockResolvedValue(Response.json(healthy));
    const response = await health(new Request("http://localhost:3000/api/health", { headers: { "x-request-id": "test-123" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthy);
    expect(response.headers.get("x-request-id")).toBe("test-123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/api/health", expect.objectContaining({ cache: "no-store", headers: { Accept: "application/json", "X-Request-ID": "test-123" } }));
  });
  it("rejects malformed external responses", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "pretend", service: "unexpected" }));
    const response = await health(new Request("http://localhost:3000/api/health"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
  });
  it("redacts network errors instead of leaking private connection details", async () => {
    fetchMock.mockRejectedValue(new Error("password=secret-value private.internal:8000"));
    const response = await health(new Request("http://localhost:3000/api/health"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret-value|private\.internal/);
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"status":503'));
  });
  it("normalizes non-success upstream responses", async () => {
    fetchMock.mockResolvedValue(new Response("Internal traceback", { status: 500 }));
    const response = await health(new Request("http://localhost:3000/api/health"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("traceback");
  });
  it("replaces correlation IDs with unsafe characters", async () => {
    fetchMock.mockResolvedValue(Response.json(healthy));
    const response = await health(new Request("http://localhost:3000/api/health", { headers: { "x-request-id": "<script>" } }));
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("handles invalid server configuration without exposing its value", async () => {
    vi.stubEnv("API_BASE_URL", "http://user:private-password@localhost:8000");
    const response = await health(new Request("http://localhost:3000/api/health"));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private-password");
  });
});

describe("readiness proxy", () => {
  it("reports a real database connection only when the readiness contract passes", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "ok", database: "connected" }));
    const response = await ready(new Request("http://localhost:3000/api/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "connected" });
  });
  it("does not present a failed database as ready", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: "database unavailable" } }, { status: 503 }));
    const response = await ready(new Request("http://localhost:3000/api/ready"));
    expect(response.status).toBe(503);
  });
});
