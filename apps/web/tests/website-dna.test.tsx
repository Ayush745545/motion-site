// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WebsiteDNA } from "../src/components/website-dna";
import { WorkspaceProvider, useWorkspace } from "../src/lib/workspace";
import { makeProject, type Project } from "../src/lib/project-schema";

const id = "12345678-1234-4234-8234-123456789012";
const job = { job_id: id, status: "queued", created_at: new Date().toISOString(), analysis_id: null, error: null, error_code: null };
let serverProject: Project;
let extraFetch: ReturnType<typeof vi.fn> | null = null;
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
beforeEach(() => {
  serverProject = { ...makeProject({ name: "Website", sourceType: "url", source: "https://example.com" }), id: "project-server" };
  extraFetch = null;
});

function open(project: Project) {
  serverProject = { ...project, id: "project-server" };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/auth/session") return Response.json({ user: { id: "user-a", email: "a@example.com" } });
    if (path === "/api/projects" && !init?.method) return Response.json({ projects: [{ id: serverProject.id, revision: 1, document: serverProject }] });
    if (path === "/api/projects/project-server" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { document: Project };
      serverProject = body.document;
      return Response.json({ project: { id: serverProject.id, revision: 2, document: serverProject } });
    }
    if (extraFetch) return await extraFetch(input, init);
    return Response.json({ error: `Unexpected request ${path}` }, { status: 500 });
  }));
  render(<WorkspaceProvider><Draft/></WorkspaceProvider>);
}

function Draft() {
  const { projects, hydrated } = useWorkspace();
  return hydrated && projects[0] ? <WebsiteDNA project={projects[0]}/> : null;
}

it("never executes source code projects", async () => {
  open(makeProject({ name: "Source", sourceType: "code", source: "alert(1)" }));
  expect((await screen.findByRole("button", { name: "Analyze website" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Uploaded source code is never executed/)).toBeTruthy();
});

it("persists a real job reference and shows actionable failure", async () => {
  extraFetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/dna/analyze") return Response.json(job, { status: 202 });
    return Response.json({ ...job, status: "failed", error: "Start Docker and run pnpm setup:analyzer.", error_code: "browser_unavailable" });
  });
  open(makeProject({ name: "Website", sourceType: "url", source: "https://example.com" }));
  fireEvent.click(await screen.findByRole("button", { name: "Analyze website" }));
  expect(await screen.findByText("Start Docker and run pnpm setup:analyzer.")).toBeTruthy();
  await waitFor(() => expect(serverProject.dnaJobId).toBe(id));
});

it("recovers from an unavailable saved job through retry", async () => {
  const project = makeProject({ name: "Saved", sourceType: "url", source: "https://example.com" });
  project.dnaJobId = id;
  extraFetch = vi.fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(Response.json({ ...job, status: "failed", error: "Capture timed out.", error_code: "timeout" }));
  open(project);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  await waitFor(() => expect(screen.getByText("Capture timed out.")).toBeTruthy());
});
