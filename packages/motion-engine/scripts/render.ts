import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { RenderInputSchema } from "../src/render-input";
import { RenderRequestSchema } from "../src/render-request";
import { sampleConfig } from "../src/sample";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = path.resolve(root, "../..");
const allowed = new Set(["--request-file", "--output", "--metadata", "--props", "--template", "--format", "--still"]);
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1];
  if (!allowed.has(key) || value === undefined || args.has(key)) {
    console.error(JSON.stringify({ event: "render_failed", code: "invalid_arguments" })); process.exit(2);
  }
  args.set(key, value);
}
const { cancelSignal, cancel } = makeCancelSignal();
process.once("SIGTERM", cancel); process.once("SIGINT", cancel);
const timer = setTimeout(cancel, 10 * 60 * 1000);
// A killed supervisor must not leave an orphan renderer encoding after its lease expires.
const parentPid = Number(process.env.MOTION_RENDER_PARENT_PID);
const parentWatch = Number.isSafeInteger(parentPid) && parentPid > 0 ? setInterval(() => {
  let alive = process.ppid === parentPid;
  try { process.kill(parentPid, 0); } catch { alive = false; }
  if (!alive) { cancel(); process.exitCode = 75; }
}, 500) : undefined;
parentWatch?.unref();
try {
  const requestPath = args.get("--request-file"), propsPath = requestPath ?? args.get("--props");
  const raw = propsPath ? JSON.parse(readFileSync(path.resolve(propsPath), "utf8")) : { ...sampleConfig, template: args.get("--template") ?? sampleConfig.template, format: args.get("--format") ?? sampleConfig.format };
  const input = requestPath ? RenderRequestSchema.parse(raw) : RenderInputSchema.parse(raw);
  const output = path.resolve(args.get("--output") ?? path.join(workspace, "storage/renders/sample.mp4"));
  mkdirSync(path.dirname(output), { recursive: true });
  const serveUrl = path.join(root, "dist");
  if (!existsSync(path.join(serveUrl, "index.html"))) await bundle({ entryPoint: path.join(root, "src/entry.tsx"), outDir: serveUrl, publicDir: path.join(root, "public") });
  const inputProps = "project_id" in input ? { request: input } : "document" in input ? { document: input.document } : { config: input };
  const id = "project_id" in input ? "ExportDNA" : "document" in input ? "TimelineDNA" : "MotionDNA";
  const composition = await selectComposition({ serveUrl, id, inputProps });
  if (args.has("--still")) {
    const frame = Number(args.get("--still"));
    if (!Number.isInteger(frame) || frame < 0 || frame >= composition.durationInFrames) throw new Error("invalid_frame");
    await renderStill({ serveUrl, composition, inputProps, output, imageFormat: "png", frame });
  } else {
    let previous = -1;
    await renderMedia({ serveUrl, composition, inputProps, outputLocation: output, codec: "h264", pixelFormat: "yuv420p", crf: 18,
      concurrency: 2, overwrite: true, cancelSignal,
      onProgress: ({ progress, renderedFrames, encodedFrames }) => {
        const percent = Math.min(99, Math.floor(progress * 100));
        if (percent !== previous) { previous = percent; console.log(JSON.stringify({ event: "render_progress", percent, renderedFrames, encodedFrames })); }
      },
    });
  }
  const metadata = { width: composition.width, height: composition.height, fps: composition.fps,
    frames: composition.durationInFrames, duration: composition.durationInFrames / composition.fps,
    codec: "h264", bytes: statSync(output).size };
  if (args.has("--metadata")) writeFileSync(path.resolve(args.get("--metadata")!), JSON.stringify(metadata));
  console.log(JSON.stringify({ event: "render_completed", ...metadata }));
} catch (error) {
  const invalid = error && typeof error === "object" && ("issues" in error || (error instanceof Error && /invalid_frame|JSON|ENOENT/.test(error.message)));
  console.error(JSON.stringify({ event: "render_failed", code: invalid ? "invalid_input" : "render_failed", message: error instanceof Error ? error.message.slice(0, 1500) : "Render failed" }));
  process.exitCode = process.exitCode === 75 ? 75 : invalid ? 2 : 1;
} finally { clearTimeout(timer); if (parentWatch) clearInterval(parentWatch); }
