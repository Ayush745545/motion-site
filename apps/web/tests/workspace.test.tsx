// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeProject, type Project } from "../src/lib/project-schema";
import { WORKSPACE_RECOVERY_KEY, WORKSPACE_STORAGE_KEY, WorkspaceProvider, useWorkspace } from "../src/lib/workspace";

type RecordValue = { id: string; revision: number; document: Project };
let server: RecordValue[] = [];
let failNextSave = false;
let requestLog: Array<{ method: string; path: string }> = [];
let nextId = 1;

function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setAccountApi(signedIn = true) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    requestLog.push({ method, path });
    if (path === "/api/auth/session") return signedIn ? response({ user: { id: "user-a", email: "a@example.com" } }) : response({ error: "Sign in" }, 401);
    if (path === "/api/auth/logout") return response(null, 204);
    if (path === "/api/projects" && method === "GET") return signedIn ? response({ projects: server }) : response({ error: "Sign in" }, 401);
    if (path === "/api/projects" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { document: Project };
      const id = `server-project-${nextId++}`;
      const document = { ...body.document, id };
      const record = { id, revision: 1, document };
      server = [record, ...server];
      return response({ project: record }, 201);
    }
    const match = path.match(/^\/api\/projects\/([^/?]+)$/);
    if (match) {
      const index = server.findIndex((record) => record.id === decodeURIComponent(match[1]!));
      if (method === "DELETE") {
        if (index < 0) return response({ error: "Not found" }, 404);
        server = server.filter((_, recordIndex) => recordIndex !== index);
        return response({ deleted: true }, 202);
      }
      if (method === "PUT") {
        if (failNextSave) { failNextSave = false; return response({ detail: "Database unavailable" }, 503); }
        if (index < 0) return response({ error: "Not found" }, 404);
        const body = JSON.parse(String(init?.body)) as { revision: number; document: Project };
        if (body.revision !== server[index]!.revision) return response({ detail: "Revision conflict" }, 409);
        server[index] = { ...server[index]!, revision: server[index]!.revision + 1, document: body.document };
        return response({ project: server[index] });
      }
    }
    return response({ error: `Unexpected request: ${method} ${path}` }, 500);
  }));
}

function Harness() {
  const workspace = useWorkspace();
  const active = workspace.projects.find((project) => project.id === workspace.activeProjectId);
  return <>
    <output data-testid="hydrated">{String(workspace.hydrated)}</output>
    <output data-testid="count">{workspace.projects.length}</output>
    <output data-testid="active-name">{active?.name ?? "None"}</output>
    <output data-testid="resolution">{workspace.settings.defaultResolution}</output>
    <output data-testid="fps">{workspace.settings.defaultFps}</output>
    <output data-testid="error">{workspace.storageError}</output>
    <output data-testid="saving">{String(workspace.saving)}</output>
    <button onClick={() => void workspace.createProject({ name: "A saved draft", sourceType: "url", source: "https://example.com" }).catch(() => undefined)}>Create</button>
    <button onClick={() => workspace.updateSettings({ defaultResolution: "1080x1920", defaultFps: 60 })}>Change defaults</button>
    <button onClick={() => { if (active) workspace.updateProject(active.id, { name: "Renamed draft", scenes: active.scenes.map((scene, index) => index === 0 ? { ...scene, headline: "Saved headline" } : scene) }); }}>Update</button>
    <button onClick={() => { if (active) void workspace.deleteProject(active.id); }}>Delete current</button>
    <button onClick={() => void workspace.retryStorage().catch(() => undefined)}>Retry save</button>
  </>;
}

function renderWorkspace() { return render(<WorkspaceProvider><Harness/></WorkspaceProvider>); }
async function hydrated() { await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true")); }

beforeEach(() => {
  localStorage.clear();
  server = [];
  failNextSave = false;
  nextId = 1;
  requestLog = [];
  setAccountApi();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("account-backed workspace", () => {
  it("creates on the API and coalesces rapid edits into a debounced versioned save", async () => {
    renderWorkspace();
    await hydrated();
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(server[0]?.id).toBe("server-project-1");
    fireEvent.click(screen.getByText("Update"));
    fireEvent.click(screen.getByText("Update"));
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(server[0]?.revision).toBe(2));
    expect(server[0]?.document.name).toBe("Renamed draft");
    expect(server[0]?.document.scenes[0]?.headline).toBe("Saved headline");
    expect(requestLog.filter((request) => request.method === "PUT")).toHaveLength(1);
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("reopens the server version and keeps only device preferences in browser storage", async () => {
    const project = makeProject({ name: "A saved draft", sourceType: "url", source: "https://example.com" });
    server = [{ id: "project-a", revision: 3, document: { ...project, id: "project-a", name: "Renamed draft", scenes: project.scenes.map((scene, index) => index === 0 ? { ...scene, headline: "Saved headline" } : scene) } }];
    const first = renderWorkspace();
    await hydrated();
    fireEvent.click(screen.getByText("Change defaults"));
    expect(screen.getByTestId("active-name").textContent).toBe("Renamed draft");
    expect(screen.getByTestId("resolution").textContent).toBe("1080x1920");
    expect(JSON.parse(localStorage.getItem("motion-dna.settings.v1") ?? "{}").defaultFps).toBe(60);
    first.unmount();
    renderWorkspace();
    await hydrated();
    expect(screen.getByTestId("active-name").textContent).toBe("Renamed draft");
    expect(server[0]?.revision).toBe(3);
  });

  it("preserves legacy local data for recovery until an account can import it", async () => {
    const unreadable = "{invalid-json";
    localStorage.setItem(WORKSPACE_STORAGE_KEY, unreadable);
    setAccountApi(false);
    renderWorkspace();
    await hydrated();
    expect(localStorage.getItem(WORKSPACE_RECOVERY_KEY)).toBe(unreadable);
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(unreadable);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("keeps edits in memory after a failed save and retries against the account API", async () => {
    const project = makeProject({ name: "A saved draft", sourceType: "url", source: "https://example.com" });
    server = [{ id: "project-a", revision: 1, document: { ...project, id: "project-a" } }];
    failNextSave = true;
    renderWorkspace();
    await hydrated();
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toContain("Database unavailable"));
    expect(screen.getByTestId("active-name").textContent).toBe("Renamed draft");
    fireEvent.click(screen.getByText("Retry save"));
    await waitFor(() => expect(server[0]?.revision).toBe(2));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("") );
  });

  it("deletes the active project on the API and selects another saved project", async () => {
    const a = makeProject({ name: "First project", sourceType: "url", source: "https://example.com" });
    const b = makeProject({ name: "Second project", sourceType: "url", source: "https://example.org" });
    server = [{ id: "project-a", revision: 1, document: { ...a, id: "project-a" } }, { id: "project-b", revision: 1, document: { ...b, id: "project-b" } }];
    renderWorkspace();
    await hydrated();
    expect(screen.getByTestId("count").textContent).toBe("2");
    fireEvent.click(screen.getByText("Delete current"));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(server).toHaveLength(1);
    expect(screen.getByTestId("active-name").textContent).toBe("Second project");
    expect(requestLog.some((request) => request.method === "DELETE" && request.path.endsWith("project-a"))).toBe(true);
  });
});
