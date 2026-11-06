import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/, "Use a stable alphanumeric ID.");
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const frame = z.number().int().min(0).max(21600);
export const CompositionSettingsSchema = z.object({
  width: z.number().int().min(320).max(1920).multipleOf(2),
  height: z.number().int().min(320).max(1920).multipleOf(2),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
}).strict();

export const TimelineSceneSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  durationInFrames: z.number().int().min(1).max(1800),
  background: color,
  transition: z.object({
    preset: z.enum(["cut", "fade", "slide"]),
    durationInFrames: z.number().int().min(0).max(120),
  }).strict(),
}).strict().superRefine((scene, context) => {
  if (scene.transition.durationInFrames > Math.floor(scene.durationInFrames / 2)) {
    context.addIssue({ code: "custom", path: ["transition", "durationInFrames"], message: "A transition must fit within half the scene." });
  }
});

export const KeyframePropertySchema = z.enum(["x", "y", "scale", "rotation", "opacity"]);
export const PROPERTY_BOUNDS = {
  x: [-7680, 7680], y: [-7680, 7680], scale: [0.05, 8], rotation: [-3600, 3600], opacity: [0, 1],
} as const;
export const TimelineKeyframeSchema = z.object({
  id,
  property: KeyframePropertySchema,
  frame,
  value: z.number().finite(),
  easing: z.enum(["linear", "ease-in-out"]),
}).strict().superRefine((keyframe, context) => {
  const [minimum, maximum] = PROPERTY_BOUNDS[keyframe.property];
  if (keyframe.value < minimum || keyframe.value > maximum) {
    context.addIssue({ code: "custom", path: ["value"], message: `Use ${minimum}–${maximum} for ${keyframe.property}.` });
  }
});

const commonLayer = {
  id, sceneId: id, name: z.string().trim().min(1).max(100),
  from: frame,
  durationInFrames: z.number().int().min(1).max(1800),
  x: z.number().min(-7680).max(7680), y: z.number().min(-7680).max(7680),
  width: z.number().min(8).max(3840), height: z.number().min(8).max(3840),
  scale: z.number().min(0.05).max(8), rotation: z.number().min(-3600).max(3600), opacity: z.number().min(0).max(1),
  animation: z.object({ preset: z.enum(["none", "fade", "slide", "scale"]), durationInFrames: z.number().int().min(0).max(120) }).strict(),
  keyframes: z.array(TimelineKeyframeSchema).max(200),
};
export const TextLayerSchema = z.object({
  ...commonLayer, type: z.literal("text"), text: z.string().max(2000),
  fontFamily: z.enum(["sans", "serif", "mono"]), fontSize: z.number().min(8).max(300),
  fontWeight: z.union([z.literal(400), z.literal(700)]), color,
  align: z.enum(["left", "center", "right"]),
}).strict();
export const ImageLayerSchema = z.object({ ...commonLayer, type: z.literal("image"), assetId: id, fit: z.enum(["contain", "cover"]) }).strict();
export const TimelineLayerSchema = z.discriminatedUnion("type", [TextLayerSchema, ImageLayerSchema]);

/** Decode only bounded, inline raster assets; composition input never starts network requests. */
export function isInlineRaster(src: string): boolean {
  if (src.length > 2_800_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return false;
  try {
    const data = atob(src.slice(src.indexOf(",") + 1));
    if (data.length > 2 * 1024 * 1024) return false;
    if (src.startsWith("data:image/png;")) {
      if (data.length < 24 || data.slice(0, 8) !== "\x89PNG\r\n\x1a\n") return false;
      const integer = (offset: number) => Array.from(data.slice(offset, offset + 4)).reduce((value, character) => value * 256 + character.charCodeAt(0), 0);
      const width = integer(16), height = integer(20);
      return width > 0 && height > 0 && width <= 4096 && height <= 4096;
    }
    if (src.startsWith("data:image/jpeg;")) return data.length >= 4 && data.slice(0, 3) === "\xff\xd8\xff";
    return data.length >= 16 && data.slice(0, 4) === "RIFF" && data.slice(8, 12) === "WEBP";
  } catch { return false; }
}

export const TimelineAssetSchema = z.object({
  id, name: z.string().trim().min(1).max(255),
  storageAssetId: z.uuid().optional(),
  src: z.string().max(2_800_000).refine(isInlineRaster, "Use an inline PNG, JPEG, or WebP up to 2 MB."),
}).strict();

export const ProjectDocumentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  composition: CompositionSettingsSchema,
  scenes: z.array(TimelineSceneSchema).min(1).max(12),
  layers: z.array(TimelineLayerSchema).max(100),
  assets: z.array(TimelineAssetSchema).max(20),
  export: z.object({ codec: z.literal("h264"), crf: z.literal(18), pixelFormat: z.literal("yuv420p") }).strict(),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  const claim = (value: string, path: (string | number)[]) => {
    if (ids.has(value)) context.addIssue({ code: "custom", path, message: "IDs must be unique throughout the project document." });
    ids.add(value);
  };
  document.scenes.forEach((scene, index) => claim(scene.id, ["scenes", index, "id"]));
  document.assets.forEach((asset, index) => claim(asset.id, ["assets", index, "id"]));
  const scenes = new Map(document.scenes.map(scene => [scene.id, scene]));
  const assets = new Set(document.assets.map(asset => asset.id));
  document.layers.forEach((layer, index) => {
    const path = ["layers", index] as (string | number)[];
    claim(layer.id, [...path, "id"]);
    const scene = scenes.get(layer.sceneId);
    if (!scene) context.addIssue({ code: "custom", path: [...path, "sceneId"], message: "Choose an existing scene." });
    else if (layer.from + layer.durationInFrames > scene.durationInFrames) context.addIssue({ code: "custom", path, message: "Layer timing must fit within its scene." });
    if (layer.animation.durationInFrames > layer.durationInFrames) context.addIssue({ code: "custom", path: [...path, "animation"], message: "The animation must fit within the layer." });
    if (layer.type === "image" && !assets.has(layer.assetId)) context.addIssue({ code: "custom", path: [...path, "assetId"], message: "Choose an existing image asset." });
    const positions = new Set<string>();
    layer.keyframes.forEach((keyframe, keyframeIndex) => {
      const keyframePath = [...path, "keyframes", keyframeIndex];
      claim(keyframe.id, [...keyframePath, "id"]);
      if (keyframe.frame >= layer.durationInFrames) context.addIssue({ code: "custom", path: [...keyframePath, "frame"], message: "Keyframes must fit within the layer." });
      const position = `${keyframe.property}:${keyframe.frame}`;
      if (positions.has(position)) context.addIssue({ code: "custom", path: keyframePath, message: "Use one keyframe per property at each frame." });
      positions.add(position);
    });
  });
  if (document.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0) > 21600) context.addIssue({ code: "custom", path: ["scenes"], message: "Use at most 21,600 frames per project." });
  if (document.assets.reduce((sum, asset) => sum + asset.src.length, 0) > 2_800_000) context.addIssue({ code: "custom", path: ["assets"], message: "The combined encoded asset budget is 2.8 MB." });
});

export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;
export type TimelineLayer = z.infer<typeof TimelineLayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type TimelineKeyframe = z.infer<typeof TimelineKeyframeSchema>;
export type TimelineAsset = z.infer<typeof TimelineAssetSchema>;

export function totalFrames(document: ProjectDocument): number {
  return document.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
}

export function sceneTimeline(document: ProjectDocument) {
  let from = 0;
  return document.scenes.map(scene => {
    const entry = { ...scene, from, duration: scene.durationInFrames };
    from += scene.durationInFrames;
    return entry;
  });
}

export function defaultProjectDocument(name = "Untitled project", composition: ProjectDocument["composition"] = { width: 1920, height: 1080, fps: 30 }): ProjectDocument {
  const titles = [name, "Designed to move.", "Make your next move."];
  return ProjectDocumentSchema.parse({
    schemaVersion: "1.0", composition,
    scenes: titles.map((_, index) => ({ id: `scene-${index + 1}`, name: ["Opening", "The story", "Call to action"][index], durationInFrames: composition.fps * 4, background: "#101216", transition: { preset: "cut", durationInFrames: 0 } })),
    layers: titles.map((text, index) => ({
      id: `text-${index + 1}`, sceneId: `scene-${index + 1}`, name: "Headline", type: "text", text,
      from: 0, durationInFrames: composition.fps * 4, x: composition.width * .1, y: composition.height * .38,
      width: composition.width * .8, height: composition.height * .24, scale: 1, rotation: 0, opacity: 1,
      animation: { preset: "none", durationInFrames: 0 }, keyframes: [], fontFamily: "sans", fontSize: 68, fontWeight: 700, color: "#F5F5F5", align: "center",
    })),
    assets: [], export: { codec: "h264", crf: 18, pixelFormat: "yuv420p" },
  });
}
