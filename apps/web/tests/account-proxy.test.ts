import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as proxyProjectGet, POST as proxyProjectPost } from "../src/app/api/projects/[...path]/route";
import { POST as proxyAccountPost } from "../src/app/api/auth/[...path]/route";

vi.mock("@motion-dna/config", () => ({
  getServerEnv: () => ({
    API_BASE_URL: "http://127.0.0.1:8000",
    CORS_ALLOWED_ORIGINS: ["http://localhost:3000"],
  }),
}));

afterEach(() => vi.restoreAllMocks());

describe("protected account proxies", () => {
  it("forwards cookies, explicit origin, and query strings to owned project routes", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ project: { revision: 2 } }));
    vi.stubGlobal("fetch", upstream);
    const response = await proxyProjectGet(
      new Request("http://localhost/api/projects/project-id/versions?limit=10", {
        headers: { cookie: "motion_dna_session=private", origin: "http://localhost:3000" },
      }),
      { params: Promise.resolve({ path: ["project-id", "versions"] }) },
    );
    expect(response.status).toBe(200);
    const [target, options] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(String(target)).toBe("http://127.0.0.1:8000/api/projects/project-id/versions?limit=10");
    expect(new Headers(options.headers).get("cookie")).toBe("motion_dna_session=private");
    expect(new Headers(options.headers).get("origin")).toBe("http://localhost:3000");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("preserves request bodies for private image uploads and rejects untrusted origins", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ asset: { id: "asset-id" } }, { status: 201 }));
    vi.stubGlobal("fetch", upstream);
    const body = new Uint8Array([1, 2, 3, 4]);
    const request = new Request("http://localhost/api/projects/project-id/assets", {
      method: "POST",
      headers: {
        cookie: "motion_dna_session=private",
        origin: "http://localhost:3000",
        "content-type": "image/png",
        "x-file-name": "brand.png",
      },
      body,
    });
    const accepted = await proxyProjectPost(request, { params: Promise.resolve({ path: ["project-id", "assets"] }) });
    expect(accepted.status).toBe(201);
    const [, options] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(new Uint8Array(options.body as ArrayBuffer)).toEqual(body);
    expect(new Headers(options.headers).get("x-file-name")).toBe("brand.png");
    const denied = await proxyProjectGet(
      new Request("http://localhost/api/projects/project-id", { headers: { origin: "https://outside.example" } }),
      { params: Promise.resolve({ path: ["project-id"] }) },
    );
    expect(denied.status).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("forwards local account requests and keeps the HttpOnly session cookie", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: "user-id" } }), {
      status: 201,
      headers: { "Content-Type": "application/json", "Set-Cookie": "motion_dna_session=secret; HttpOnly; SameSite=Lax" },
    }));
    vi.stubGlobal("fetch", upstream);
    const response = await proxyAccountPost(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ email: "local@example.test", password: "long-local-password" }),
      }),
      { params: Promise.resolve({ path: ["register"] }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, options] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/auth/register");
    expect(JSON.parse(new TextDecoder().decode(options.body as ArrayBuffer))).toEqual({ email: "local@example.test", password: "long-local-password" });
  });
});
