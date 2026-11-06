import { ProjectDocumentSchema, type ProjectDocument, type TimelineLayer, type TimelineKeyframe } from "@motion-dna/motion-engine/project";

export function clampLayerTiming(layer: TimelineLayer, sceneFrames: number): TimelineLayer {
  const from = Math.min(Math.max(0, layer.from), sceneFrames - 1);
  const durationInFrames = Math.max(1, Math.min(layer.durationInFrames, sceneFrames - from));
  const seen = new Set<string>();
  const keyframes = layer.keyframes.map(keyframe => ({ ...keyframe, frame: Math.min(keyframe.frame, durationInFrames - 1) })).filter(keyframe => {
    const position = `${keyframe.property}:${keyframe.frame}`;
    if (seen.has(position)) return false;
    seen.add(position);
    return true;
  });
  return { ...layer, from, durationInFrames, animation: { ...layer.animation, durationInFrames: Math.min(layer.animation.durationInFrames, durationInFrames) }, keyframes };
}

export function resizeScene(document: ProjectDocument, sceneId: string, frames: number): ProjectDocument {
  const durationInFrames = Math.max(1, Math.min(1800, Math.round(frames)));
  return ProjectDocumentSchema.parse({
    ...document,
    scenes: document.scenes.map(scene => scene.id !== sceneId ? scene : { ...scene, durationInFrames, transition: { ...scene.transition, durationInFrames: Math.min(scene.transition.durationInFrames, Math.floor(durationInFrames / 2)) } }),
    layers: document.layers.map(layer => layer.sceneId === sceneId ? clampLayerTiming(layer, durationInFrames) : layer),
  });
}

export function moveScene(document: ProjectDocument, sceneId: string, targetIndex: number): ProjectDocument {
  const index = document.scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0 || targetIndex < 0 || targetIndex >= document.scenes.length) return document;
  const scenes = [...document.scenes];
  const [scene] = scenes.splice(index, 1);
  if (!scene) return document;
  scenes.splice(targetIndex, 0, scene);
  return { ...document, scenes };
}

export function withKeyframe(layer: TimelineLayer, property: TimelineKeyframe["property"], frame: number, value: number): TimelineLayer {
  const position = Math.max(0, Math.min(layer.durationInFrames - 1, Math.round(frame)));
  const current = layer.keyframes.find(keyframe => keyframe.property === property && keyframe.frame === position);
  const next: TimelineKeyframe = { id: current?.id ?? crypto.randomUUID(), property, frame: position, value, easing: current?.easing ?? "ease-in-out" };
  return { ...layer, keyframes: [...layer.keyframes.filter(keyframe => keyframe.id !== current?.id), next].sort((a, b) => a.frame - b.frame) };
}

export function duplicateScene(document: ProjectDocument, sceneId: string): { document: ProjectDocument; sceneId: string } {
  const original = document.scenes.find(scene => scene.id === sceneId);
  if (!original || document.scenes.length >= 12) return { document, sceneId };
  const nextId = crypto.randomUUID();
  const scene = { ...original, id: nextId, name: `${original.name.slice(0, 90)} copy` };
  const scenes = [...document.scenes];
  scenes.splice(scenes.findIndex(entry => entry.id === sceneId) + 1, 0, scene);
  return {
    sceneId: nextId,
    document: ProjectDocumentSchema.parse({ ...document, scenes, layers: [...document.layers, ...document.layers.filter(layer => layer.sceneId === sceneId).map(layer => ({ ...layer, id: crypto.randomUUID(), sceneId: nextId, keyframes: layer.keyframes.map(keyframe => ({ ...keyframe, id: crypto.randomUUID() })) }))] }),
  };
}
