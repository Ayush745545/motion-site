import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultProjectDocument, isInlineRaster, ProjectDocumentSchema, sceneTimeline, totalFrames,
  type ProjectDocument,
} from "../src/project";
import { keyframeValue, layerFrameValues, sceneFrameValues } from "../src/TimelineComposition";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=";
const valid = () => defaultProjectDocument("A real timeline");
function invalid(change: (document: ProjectDocument) => void) {
  const document = valid(); change(document);
  assert.equal(ProjectDocumentSchema.safeParse(document).success, false);
}

test("timeline document serializes with version, layers, assets, timing and export settings", () => {
  const document = valid();
  assert.deepEqual(ProjectDocumentSchema.parse(JSON.parse(JSON.stringify(document))), document);
  assert.equal(document.schemaVersion, "1.0");
  assert.equal(document.layers[0]?.type, "text");
  assert.equal(document.layers[0]?.name, "Headline");
  assert.deepEqual(document.export, { codec: "h264", crf: 18, pixelFormat: "yuv420p" });
  assert.equal(totalFrames(document), 360);
  assert.equal(totalFrames(defaultProjectDocument("24 FPS", { width: 1080, height: 1920, fps: 24 })), 288);
});

test("reordered scene timelines remain contiguous and retain their own layer references", () => {
  const document = valid();
  const reordered = { ...document, scenes: [document.scenes[2]!, document.scenes[0]!, document.scenes[1]!] };
  const timeline = sceneTimeline(ProjectDocumentSchema.parse(reordered));
  assert.deepEqual(timeline.map(scene => scene.from), [0, 120, 240]);
  assert.deepEqual(timeline.map(scene => scene.id), ["scene-3", "scene-1", "scene-2"]);
  assert.equal(reordered.layers[0]?.sceneId, "scene-1");
  assert.equal(totalFrames(reordered), totalFrames(document));
});

test("IDs are unique across the document and all scene/asset references resolve", () => {
  invalid(document => { document.layers[0]!.id = document.scenes[0]!.id; });
  invalid(document => { document.layers[0]!.sceneId = "missing-scene"; });
  invalid(document => { document.scenes[1]!.id = document.scenes[0]!.id; });
  invalid(document => {
    document.layers.push({ ...document.layers[0]!, id: "missing-image", type: "image", assetId: "missing-asset", fit: "contain" } as ProjectDocument["layers"][number]);
  });
  invalid(document => {
    document.layers[0]!.keyframes = [{ id: document.layers[1]!.id, frame: 0, property: "opacity", value: 1, easing: "linear" }];
  });
});

test("invalid frames, out-of-scene layers and overlong transitions cannot reach rendering", () => {
  invalid(document => { document.scenes[0]!.durationInFrames = 1.5; });
  invalid(document => { document.layers[0]!.from = -1; });
  invalid(document => { document.layers[0]!.from = 1; });
  invalid(document => { document.layers[0]!.durationInFrames = 0; });
  invalid(document => { document.layers[0]!.animation.durationInFrames = 121; });
  invalid(document => { document.scenes[0]!.transition.durationInFrames = 61; });
  invalid(document => { document.composition.width = 1919; });
  invalid(document => { document.composition.fps = 25 as 30; });
});

test("keyframes enforce property bounds, unique frame positions and layer-local timing", () => {
  invalid(document => { document.layers[0]!.keyframes = [{ id: "opacity-bad", property: "opacity", frame: 0, value: 1.1, easing: "linear" }]; });
  invalid(document => { document.layers[0]!.keyframes = [{ id: "scale-bad", property: "scale", frame: 0, value: 0, easing: "linear" }]; });
  invalid(document => { document.layers[0]!.keyframes = [{ id: "time-bad", property: "x", frame: 120, value: 50, easing: "linear" }]; });
  invalid(document => { document.layers[0]!.keyframes = [{ id: "nan-bad", property: "x", frame: 0, value: NaN, easing: "linear" }]; });
  invalid(document => {
    document.layers[0]!.keyframes = [
      { id: "duplicate-a", property: "x", frame: 0, value: 50, easing: "linear" },
      { id: "duplicate-b", property: "x", frame: 0, value: 60, easing: "linear" },
    ];
  });
});

test("image assets are bounded inline rasters and cannot load remote resources", () => {
  assert.equal(isInlineRaster(png), true);
  for (const src of ["https://example.com/asset.png", "file:///etc/passwd", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,AAAA", "data:image/jpeg;base64,AAAA", "data:image/webp;base64,AAAA"]) {
    assert.equal(isInlineRaster(src), false);
    invalid(document => { document.assets.push({ id: "unsafe-image", name: "Unsafe", src }); });
  }
  const document = valid();
  document.assets = [{ id: "image-asset", name: "Imported pixel", src: png }];
  const text = document.layers[0]!;
  document.layers.push({
    id: "image-layer", sceneId: text.sceneId, name: "Imported image", type: "image", assetId: "image-asset", fit: "contain",
    from: 0, durationInFrames: 120, x: 100, y: 100, width: 200, height: 200, scale: 1, rotation: 0, opacity: 1,
    animation: { preset: "none", durationInFrames: 0 }, keyframes: [],
  });
  assert.equal(ProjectDocumentSchema.parse(document).layers[3]?.type, "image");
});

test("frame interpolation is deterministic, eases exact endpoints and never mutates keyframes", () => {
  const layer = valid().layers[0]!;
  layer.keyframes = [
    { id: "key-end", property: "x", frame: 100, value: 1000, easing: "linear" },
    { id: "key-start", property: "x", frame: 0, value: 0, easing: "ease-in-out" },
    { id: "opacity-end", property: "opacity", frame: 100, value: .5, easing: "linear" },
    { id: "opacity-start", property: "opacity", frame: 0, value: 1, easing: "linear" },
  ];
  const before = JSON.stringify(layer);
  assert.equal(keyframeValue(layer, "x", -1), 0);
  assert.equal(keyframeValue(layer, "x", 25), 156.25);
  assert.equal(keyframeValue(layer, "x", 50), 500);
  assert.equal(keyframeValue(layer, "x", 1000), 1000);
  assert.equal(keyframeValue(layer, "opacity", 50), .75);
  assert.deepEqual(layerFrameValues(layer, 37), layerFrameValues(layer, 37));
  assert.equal(JSON.stringify(layer), before);
});

test("preset motion and scene transitions use exact frame budgets and settle on the final frame", () => {
  const document = valid();
  const layer = document.layers[0]!;
  layer.animation = { preset: "slide", durationInFrames: 12 };
  assert.equal(layerFrameValues(layer, 0).opacity, 0);
  assert.equal(layerFrameValues(layer, 0).y, layer.y + 48);
  assert.equal(layerFrameValues(layer, 11).opacity, 1);
  assert.equal(layerFrameValues(layer, 11).y, layer.y);
  const scene = { ...document.scenes[0]!, transition: { preset: "fade" as const, durationInFrames: 10 } };
  assert.equal(sceneFrameValues(scene, 0, false, 1920).opacity, 0);
  assert.equal(sceneFrameValues(scene, 9, false, 1920).opacity, 1);
  assert.equal(sceneFrameValues(scene, 119, false, 1920).opacity, 0);
  assert.equal(sceneFrameValues(scene, 119, true, 1920).opacity, 1);
});
