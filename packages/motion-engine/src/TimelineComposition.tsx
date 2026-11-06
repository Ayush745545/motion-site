import { useMemo } from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame } from "remotion";
import { FONT_NAMES, useCompositionFont } from "./fonts";
import {
  ProjectDocumentSchema, sceneTimeline,
  type ProjectDocument, type TextLayer, type TimelineLayer, type TimelineKeyframe, type TimelineScene,
} from "./project";

function progress(frame: number, duration: number) {
  if (duration <= 1) return 1;
  return Math.min(1, Math.max(0, frame / (duration - 1)));
}

function ease(value: number, easing: TimelineKeyframe["easing"]) {
  return easing === "linear" ? value : value * value * (3 - 2 * value);
}

/** Keyframes are relative to their layer, and hold their endpoint values outside a segment. */
export function keyframeValue(layer: TimelineLayer, property: TimelineKeyframe["property"], frame: number) {
  const keys = layer.keyframes.filter(key => key.property === property).sort((a, b) => a.frame - b.frame);
  if (!keys.length) return layer[property];
  if (frame <= keys[0]!.frame) return keys[0]!.value;
  for (let index = 1; index < keys.length; index++) {
    const right = keys[index]!, left = keys[index - 1]!;
    if (frame <= right.frame) {
      const amount = ease((frame - left.frame) / (right.frame - left.frame), left.easing);
      return left.value + (right.value - left.value) * amount;
    }
  }
  return keys[keys.length - 1]!.value;
}

/** This frame math is shared by the Player and renderer without wall-clock timers. */
export function layerFrameValues(layer: TimelineLayer, frame: number) {
  const entrance = layer.animation.preset === "none" ? 1 : ease(progress(frame, layer.animation.durationInFrames), "ease-in-out");
  return {
    x: keyframeValue(layer, "x", frame),
    y: keyframeValue(layer, "y", frame) + (layer.animation.preset === "slide" ? (1 - entrance) * 48 : 0),
    scale: keyframeValue(layer, "scale", frame) * (layer.animation.preset === "scale" ? .88 + .12 * entrance : 1),
    rotation: keyframeValue(layer, "rotation", frame),
    opacity: keyframeValue(layer, "opacity", frame) * entrance,
  };
}

export function sceneFrameValues(scene: TimelineScene, frame: number, last: boolean, width: number) {
  const duration = scene.transition.durationInFrames;
  if (scene.transition.preset === "cut" || duration === 0) return { opacity: 1, x: 0 };
  const entrance = ease(progress(frame, duration), "ease-in-out");
  const exit = last ? 0 : ease(progress(frame - (scene.durationInFrames - duration), duration), "ease-in-out");
  return {
    opacity: scene.transition.preset === "fade" ? entrance * (1 - exit) : 1,
    x: scene.transition.preset === "slide" ? (1 - entrance - exit) * width : 0,
  };
}

function TextContent({ layer }: { layer: TextLayer }) {
  useCompositionFont({ font: layer.fontFamily, fontWeight: layer.fontWeight });
  return <div style={{
    width: "100%", height: "100%", display: "flex", alignItems: "center",
    color: layer.color, fontFamily: FONT_NAMES[layer.fontFamily], fontWeight: layer.fontWeight,
    fontSize: layer.fontSize, lineHeight: 1.15, textAlign: layer.align, whiteSpace: "pre-wrap",
    overflowWrap: "anywhere", overflow: "hidden", fontStyle: "normal", letterSpacing: "normal",
  }}><div style={{ width: "100%" }}>{layer.text}</div></div>;
}

function LayerContent({ layer, document }: { layer: TimelineLayer; document: ProjectDocument }) {
  const frame = useCurrentFrame();
  const values = layerFrameValues(layer, frame);
  const asset = layer.type === "image" ? document.assets.find(item => item.id === layer.assetId) : undefined;
  return <div data-layer-id={layer.id} style={{
    position: "absolute", left: values.x, top: values.y, width: layer.width, height: layer.height,
    opacity: values.opacity, transform: `rotate(${values.rotation}deg) scale(${values.scale})`,
    transformOrigin: "center", overflow: "hidden",
  }}>
    {layer.type === "text" ? <TextContent key={`${layer.fontFamily}-${layer.fontWeight}`} layer={layer} /> : asset && <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: layer.fit }} />}
  </div>;
}

function SceneContent({ document, scene, last }: { document: ProjectDocument; scene: TimelineScene; last: boolean }) {
  const frame = useCurrentFrame();
  const transition = sceneFrameValues(scene, frame, last, document.composition.width);
  return <AbsoluteFill data-scene-id={scene.id} style={{
    background: scene.background, opacity: transition.opacity, transform: `translateX(${transition.x}px)`, overflow: "hidden",
  }}>
    {document.layers.filter(layer => layer.sceneId === scene.id).map(layer => <Sequence key={layer.id} from={layer.from} durationInFrames={layer.durationInFrames} layout="none">
      <LayerContent layer={layer} document={document} />
    </Sequence>)}
  </AbsoluteFill>;
}

export function TimelineComposition({ document }: { document: ProjectDocument }) {
  const parsed = useMemo(() => ProjectDocumentSchema.parse(document), [document]);
  const timeline = sceneTimeline(parsed);
  return <AbsoluteFill className="motion-composition timeline-composition" style={{
    background: parsed.scenes[0]!.background, overflow: "hidden", textRendering: "geometricPrecision",
  }}>
    <style>{`.timeline-composition, .timeline-composition * {box-sizing:border-box;}`}</style>
    {timeline.map((scene, index) => <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames}>
      <SceneContent document={parsed} scene={scene} last={index === timeline.length - 1} />
    </Sequence>)}
  </AbsoluteFill>;
}
