import { describe, expect, it } from "vitest";
import { defaultProjectDocument, ProjectDocumentSchema } from "@motion-dna/motion-engine/project";
import { commitTimelineHistory, createTimelineHistory, redoTimelineHistory, undoTimelineHistory } from "../src/lib/timeline-state";
import { timelineFromProject, timelineFromLegacyPatch, projectPatchFromTimeline } from "../src/lib/timeline-document";
import { makeProject } from "../src/lib/project-schema";
import { duplicateScene, moveScene, resizeScene, withKeyframe } from "../src/components/timeline-editor-model";

describe("serializable timeline editing", () => {
  it("coalesces a typing gesture, undoes timing separately, and discards redo after a new edit", () => {
    const document = defaultProjectDocument("Original");
    let history = createTimelineHistory("project", document);
    const text = (value: string) => ({ ...document, layers: document.layers.map((layer, index) => index === 0 && layer.type === "text" ? { ...layer, text: value } : layer) });
    history = commitTimelineHistory(history, text("N"), "typing");
    history = commitTimelineHistory(history, text("New copy"), "typing");
    expect(history.past).toHaveLength(1);
    history = commitTimelineHistory(history, resizeScene(history.present, "scene-1", 60));
    const undone = undoTimelineHistory(history);
    expect(undone.present.scenes[0]?.durationInFrames).toBe(120);
    expect(undone.present.layers[0]).toHaveProperty("text", "New copy");
    expect(undoTimelineHistory(undone).present.layers[0]).toHaveProperty("text", "Original");
    expect(redoTimelineHistory(undone).present.scenes[0]?.durationInFrames).toBe(60);
    const branch = commitTimelineHistory(undone, text("Another idea"));
    expect(branch.future).toHaveLength(0);
    expect(document.layers[0]).toHaveProperty("text", "Original");
  });
  it("keeps legacy draft identities and preserves extra layers during DNA changes", () => {
    const project = makeProject({ name: "Saved project", sourceType: "url", source: "https://example.com" });
    const legacy = { ...project, timeline: undefined };
    const document = timelineFromProject(legacy);
    expect(document.scenes.map(scene => scene.id)).toEqual(project.scenes.map(scene => scene.id));
    const layer = { ...document.layers[0]!, id: "extra-layer", name: "Custom layer", opacity: 0.5 };
    const withExtra = { ...project, timeline: { ...document, layers: [...document.layers, layer] } };
    const updated = timelineFromLegacyPatch(withExtra, { scenes: project.scenes.map(scene => ({ ...scene, background: "#112233" })) })!;
    expect(updated.layers.find(item => item.id === "extra-layer")?.opacity).toBe(0.5);
    expect(updated.scenes[0]?.background).toBe("#112233");
    expect(ProjectDocumentSchema.safeParse(updated).success).toBe(true);
    expect(projectPatchFromTimeline(project, updated).timeline).toEqual(updated);
  });
  it("clamps shortened layers and keyframes, and duplicates with fresh IDs", () => {
    let document = defaultProjectDocument();
    const original = document.layers[0]!;
    document = { ...document, layers: [withKeyframe(original, "x", 110, 500), ...document.layers.slice(1)] };
    const shorter = resizeScene(document, "scene-1", 10);
    expect(shorter.layers[0]?.durationInFrames).toBe(10);
    expect(shorter.layers[0]?.keyframes[0]?.frame).toBe(9);
    const copied = duplicateScene(shorter, "scene-1");
    expect(copied.document.scenes).toHaveLength(4);
    expect(ProjectDocumentSchema.safeParse(copied.document).success).toBe(true);
    const moved = moveScene(copied.document, copied.sceneId, 0);
    expect(moved.scenes[0]?.id).toBe(copied.sceneId);
    expect(document.scenes[0]?.durationInFrames).toBe(120);
  });
});
