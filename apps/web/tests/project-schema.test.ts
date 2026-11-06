import { describe, expect, it } from "vitest";
import { CreateProjectSchema, DEFAULT_SETTINGS, MAX_SOURCE_BYTES, ProjectSchema, WorkspaceSchema, makeProject } from "../src/lib/project-schema";

const input = { name: "Launch film", sourceType: "url" as const, source: "https://example.com/product" };

describe("local draft validation", () => {
  it("accepts HTTP references and rejects executable URLs and embedded credentials", () => {
    expect(CreateProjectSchema.safeParse(input).success).toBe(true);
    for (const source of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "https://user:password@example.com", "example.com"]) {
      expect(CreateProjectSchema.safeParse({ ...input, source }).success).toBe(false);
    }
  });

  it("measures source limits in UTF-8 bytes and rejects blank source files", () => {
    expect(CreateProjectSchema.safeParse({ ...input, sourceType: "code", source: "  \n " }).success).toBe(false);
    expect(CreateProjectSchema.safeParse({ ...input, sourceType: "code", source: "a".repeat(MAX_SOURCE_BYTES) }).success).toBe(true);
    expect(CreateProjectSchema.safeParse({ ...input, sourceType: "code", source: "💙".repeat(70_000) }).success).toBe(false);
  });

  it("creates editable starter scenes using chosen defaults without claiming an analysis", () => {
    const project = makeProject(input, { ...DEFAULT_SETTINGS, defaultResolution: "1080x1920", defaultFps: 24 });
    expect(project.scenes).toHaveLength(3);
    expect(project.scenes[0]?.headline).toBe("Launch film");
    expect(project.scenes.map((scene) => scene.id)).toContain(project.activeSceneId);
    expect(project.resolution).toBe("1080x1920");
    expect(project.fps).toBe(24);
    expect(project.source).toBe(input.source);
    expect(Object.keys(project)).not.toContain("analysis");
  });

  it("rejects broken scene references, duplicate scene IDs and invalid animation values", () => {
    const project = makeProject(input);
    expect(ProjectSchema.safeParse({ ...project, activeSceneId: "missing" }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...project, scenes: [project.scenes[0], project.scenes[0]] }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...project, scenes: project.scenes.map((scene) => ({ ...scene, duration: 0 })) }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...project, scenes: project.scenes.map((scene) => ({ ...scene, background: "url(https://example.com)" })) }).success).toBe(false);
  });

  it("rejects stale active projects and duplicate project IDs in restored storage", () => {
    const project = makeProject(input);
    const state = { version: 1, projects: [project], activeProjectId: project.id, settings: DEFAULT_SETTINGS };
    expect(WorkspaceSchema.safeParse(state).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...state, activeProjectId: "missing" }).success).toBe(false);
    expect(WorkspaceSchema.safeParse({ ...state, projects: [project, project] }).success).toBe(false);
  });
});
