import { ProjectDocumentSchema, type ProjectDocument } from "@motion-dna/motion-engine/project";
import type { Project, Scene } from "./project-schema";

/** Legacy drafts become frame-based documents without changing scene identities. */
export function timelineFromProject(project: Project): ProjectDocument {
  if (project.timeline) return ProjectDocumentSchema.parse(project.timeline);
  const [width = 1920, height = 1080] = project.resolution.split("x").map(Number);
  return ProjectDocumentSchema.parse({
    schemaVersion: "1.0",
    composition: { width, height, fps: project.fps },
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      durationInFrames: Math.max(1, Math.round(scene.duration * project.fps)),
      background: scene.background,
      transition: { preset: "cut", durationInFrames: 0 },
    })),
    layers: project.scenes.flatMap((scene, index) => {
      const durationInFrames = Math.max(1, Math.round(scene.duration * project.fps));
      const shared = {
        sceneId: scene.id,
        type: "text",
        from: 0,
        durationInFrames,
        x: Math.round(width * 0.1),
        width: Math.round(width * 0.8),
        scale: 1,
        rotation: 0,
        opacity: 1,
        fontFamily: scene.fontFamily,
        fontWeight: 700,
        color: scene.foreground,
        align: scene.align,
        animation: { preset: scene.animation, durationInFrames: Math.min(18, durationInFrames) },
        keyframes: [],
      };
      return [
        {
          ...shared,
          id: `headline-${index}-${scene.id.slice(0, 60)}`,
          name: "Headline",
          text: scene.headline,
          y: Math.round(height * 0.36),
          height: Math.round(height * 0.22),
          fontSize: scene.fontSize,
        },
        {
          ...shared,
          id: `supporting-${index}-${scene.id.slice(0, 60)}`,
          name: "Supporting text",
          text: scene.subline,
          y: Math.round(height * 0.62),
          height: Math.round(height * 0.16),
          fontSize: Math.max(20, Math.round(scene.fontSize * 0.42)),
          fontWeight: 400,
        },
      ];
    }),
    assets: [],
    export: { codec: "h264", crf: 18, pixelFormat: "yuv420p" },
  });
}

/** Keep older dashboard/analysis readers working; the timeline is authoritative. */
export function projectPatchFromTimeline(project: Project, input: ProjectDocument): Partial<Project> {
  const document = ProjectDocumentSchema.parse(input);
  const scenes: Scene[] = document.scenes.map((scene) => {
    const previous = project.scenes.find((entry) => entry.id === scene.id);
    const textLayers = document.layers.filter((layer) => layer.sceneId === scene.id && layer.type === "text");
    const title = textLayers.find((layer) => layer.name === "Headline") ?? textLayers[0];
    const supporting = textLayers.find((layer) => layer.name === "Supporting text") ?? textLayers[1];
    return {
      id: scene.id,
      name: scene.name.slice(0, 80),
      headline: title?.type === "text" ? title.text.slice(0, 180) : "",
      subline: supporting?.type === "text" ? supporting.text.slice(0, 360) : "",
      duration: scene.durationInFrames / document.composition.fps,
      background: scene.background,
      foreground: title?.type === "text" ? title.color : previous?.foreground ?? "#F5F5F5",
      accent: previous?.accent ?? "#2563EB",
      fontFamily: title?.type === "text" ? title.fontFamily : previous?.fontFamily ?? "sans",
      fontSize: title?.type === "text" ? Math.max(24, Math.min(120, title.fontSize)) : 68,
      animation: title && title.animation.preset !== "none" ? title.animation.preset : "fade",
      align: title?.type === "text" && title.align === "center" ? "center" : "left",
    };
  });
  const resolution = `${document.composition.width}x${document.composition.height}`;
  return {
    timeline: document,
    scenes,
    activeSceneId: scenes.some((scene) => scene.id === project.activeSceneId) ? project.activeSceneId : scenes[0]!.id,
    fps: document.composition.fps,
    resolution: resolution === "1920x1080" || resolution === "1080x1920" || resolution === "1080x1080" ? resolution : project.resolution,
  };
}

/** Apply controls in the existing DNA view without rebuilding the layer document. */
export function timelineFromLegacyPatch(project: Project, patch: Partial<Project>): ProjectDocument | undefined {
  if (!project.timeline || patch.timeline || (!patch.scenes && !patch.resolution && !patch.fps)) return patch.timeline;
  const legacy = { ...project, ...patch, timeline: undefined };
  const defaults = timelineFromProject(legacy);
  const previous = project.timeline;
  const fps = patch.fps ?? previous.composition.fps;
  const ratio = fps / previous.composition.fps;
  const oldSceneIds = new Set(previous.scenes.map((scene) => scene.id));
  const scenes = defaults.scenes.map((candidate) => {
    const scene = previous.scenes.find((entry) => entry.id === candidate.id);
    if (!scene) return candidate;
    const before = project.scenes.find((entry) => entry.id === scene.id);
    const after = legacy.scenes.find((entry) => entry.id === scene.id)!;
    const durationInFrames = after.duration !== before?.duration
      ? candidate.durationInFrames
      : Math.max(1, Math.min(1800, Math.round(scene.durationInFrames * ratio)));
    return {
      ...scene,
      name: after.name !== before?.name ? candidate.name : scene.name,
      background: after.background !== before?.background ? candidate.background : scene.background,
      durationInFrames,
      transition: { ...scene.transition, durationInFrames: Math.min(Math.floor(durationInFrames / 2), Math.round(scene.transition.durationInFrames * ratio)) },
    };
  });
  const sceneMap = new Map(scenes.map((scene) => [scene.id, scene]));
  const layers = previous.layers.filter((layer) => sceneMap.has(layer.sceneId)).map((layer) => {
    const scene = sceneMap.get(layer.sceneId)!;
    const from = Math.min(scene.durationInFrames - 1, Math.round(layer.from * ratio));
    const durationInFrames = Math.max(1, Math.min(scene.durationInFrames - from, Math.round(layer.durationInFrames * ratio)));
    const common = {
      ...layer,
      from,
      durationInFrames,
      animation: { ...layer.animation, durationInFrames: Math.min(durationInFrames, Math.round(layer.animation.durationInFrames * ratio)) },
      keyframes: layer.keyframes.map((keyframe) => ({ ...keyframe, frame: Math.round(keyframe.frame * ratio) })).filter((keyframe) => keyframe.frame < durationInFrames),
    };
    if (layer.type !== "text") return common;
    const before = project.scenes.find((entry) => entry.id === layer.sceneId);
    const after = legacy.scenes.find((entry) => entry.id === layer.sceneId)!;
    const peers = previous.layers.filter((entry) => entry.sceneId === layer.sceneId && entry.type === "text");
    const title = peers.find((entry) => entry.name === "Headline") ?? peers[0];
    const supporting = peers.find((entry) => entry.name === "Supporting text") ?? peers[1];
    return {
      ...common,
      type: "text" as const,
      text: layer.id === title?.id && after.headline !== before?.headline ? after.headline : layer.id === supporting?.id && after.subline !== before?.subline ? after.subline : layer.text,
      color: after.foreground !== before?.foreground ? after.foreground : layer.color,
      fontFamily: after.fontFamily !== before?.fontFamily ? after.fontFamily : layer.fontFamily,
      fontSize: layer.id === title?.id && after.fontSize !== before?.fontSize ? after.fontSize : layer.fontSize,
      fontWeight: layer.fontWeight,
      align: after.align !== before?.align ? after.align : layer.align,
      animation: after.animation !== before?.animation ? { preset: after.animation, durationInFrames: Math.min(18, durationInFrames) } : common.animation,
    };
  });
  const freshLayers = defaults.layers.filter((layer) => !oldSceneIds.has(layer.sceneId));
  return ProjectDocumentSchema.parse({
    ...previous,
    composition: { ...previous.composition, ...(patch.resolution ? defaults.composition : { fps }) },
    scenes,
    layers: [...layers, ...freshLayers],
  });
}
