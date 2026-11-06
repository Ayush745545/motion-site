// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";
import type { ProjectDocument } from "@motion-dna/motion-engine/project";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionEditor, sceneAtTime } from "../src/components/motion-editor";
import { WorkspaceProvider } from "../src/lib/workspace";
import { makeProject, type Project } from "../src/lib/project-schema";

vi.mock("@remotion/player", () => ({ Player: forwardRef(function TestPlayer({ inputProps }: { inputProps: { request: { input: { document?: ProjectDocument } } } }, ref) { useImperativeHandle(ref, () => ({ addEventListener() {}, removeEventListener() {}, pause() {}, play() {}, seekTo() {}, isPlaying: () => false, getCurrentFrame: () => 0 })); return <div data-testid="shared-player">{inputProps.request.input.document?.layers.map(layer => layer.type === "text" ? layer.text : layer.name).join(" ")}</div>; }) }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("gsap", () => ({ gsap: { context: () => ({ revert: () => {} }), fromTo: () => {} } }));

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

let serverProject: Project | null = null;
let saveCount = 0;

function renderDraft(projectOverride?: Project) {
  const project = projectOverride ?? makeProject({ name: "Launch film", sourceType: "url", source: "https://example.com" });
  serverProject = { ...project, id: "project-server" };
  saveCount = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/auth/session") return new Response(JSON.stringify({ user: { id: "user-a", email: "a@example.com" } }), { status: 200 });
    if (path === "/api/projects" && !init?.method) return new Response(JSON.stringify({ projects: [{ id: "project-server", revision: 1, document: serverProject }] }), { status: 200 });
    if (path === "/api/projects/project-server" && init?.method === "PUT") {
      saveCount++;
      const body = JSON.parse(String(init.body)) as { revision: number; document: Project };
      serverProject = body.document;
      return new Response(JSON.stringify({ project: { id: "project-server", revision: saveCount + 1, document: body.document } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: "Unexpected test request" }), { status: 500 });
  }));
  render(<WorkspaceProvider><MotionEditor/></WorkspaceProvider>);
  return project;
}

describe("manual motion editor", () => {
  it("selects exact scene boundaries and keeps the last frame at composition end", () => {
    const { scenes } = makeProject({ name: "Boundary test", sourceType: "url", source: "https://example.com" });
    expect(sceneAtTime(scenes, 0)?.scene.id).toBe(scenes[0]?.id);
    expect(sceneAtTime(scenes, 4)?.scene.id).toBe(scenes[1]?.id);
    expect(sceneAtTime(scenes, 12)?.scene.id).toBe(scenes[2]?.id);
    expect(sceneAtTime(scenes, 12)?.progress).toBe(1);
    expect(sceneAtTime([], 0)).toBeNull();
  });

  it("opens an honest empty state when no local project exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Sign in" }), { status: 401 })));
    render(<WorkspaceProvider><MotionEditor/></WorkspaceProvider>);
    expect(await screen.findByRole("heading", { name: "A canvas for your next big idea." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create project" }).getAttribute("href")).toBe("/create");
  });

  it("persists edits to the account project and protects required fields while temporarily empty", async () => {
    renderDraft();
    const headline = await screen.findByLabelText("Headline");
    fireEvent.change(headline, { target: { value: "Built for the big screen." } });
    const duration = screen.getByLabelText("Scene duration (seconds)") as HTMLInputElement;
    fireEvent.change(duration, { target: { value: "" } });
    expect(duration.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(duration);
    expect(duration.value).toBe("4");
    fireEvent.change(duration, { target: { value: "0.5" } });
    fireEvent.blur(duration);
    const name = screen.getByLabelText("Scene name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "" } });
    fireEvent.blur(name);
    expect(name.value).toBe("Opening");
    await waitFor(() => expect(serverProject?.timeline?.scenes[0]?.durationInFrames).toBe(15));
    expect(serverProject?.timeline?.layers.find(layer => layer.type === "text")?.text).toBe("Built for the big screen.");
    expect(serverProject?.timeline?.scenes[0]?.name).toBe("Opening");
    expect(saveCount).toBeGreaterThan(0);
  });

  it("creates and removes scenes in the saved project document", async () => {
    renderDraft();
    await screen.findByLabelText("Headline");
    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    await waitFor(() => expect(serverProject?.timeline?.scenes).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate scene" }));
    await waitFor(() => expect(serverProject?.timeline?.scenes).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "Delete scene" }));
    await waitFor(() => expect(serverProject?.timeline?.scenes).toHaveLength(4));
    expect(screen.getByRole("link", { name: "Generate DNA video" }).getAttribute("href")).toContain("/generate?project=");
  });
});
