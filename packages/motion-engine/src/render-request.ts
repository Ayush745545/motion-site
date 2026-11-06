import { z } from "zod";
import { RenderInputSchema } from "./render-input";
import { totalFrames } from "./project";
import { dimensions, durationFor, FPS } from "./schema";

export const OutputSettingsSchema = z.object({
  quality: z.enum(["720p", "1080p"]),
  aspect_ratio: z.enum(["16:9", "9:16"]),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
}).strict();
export const RenderRequestSchema = z.object({
  project_id: z.uuid(),
  project_name: z.string().trim().min(1).max(200),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  input: RenderInputSchema,
  output: OutputSettingsSchema,
}).strict();
export type OutputSettings = z.infer<typeof OutputSettingsSchema>;
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export function renderSource(request: RenderRequest) {
  if ("document" in request.input) return { ...request.input.document.composition, frames: totalFrames(request.input.document) };
  return { ...dimensions(request.output.aspect_ratio === "9:16" ? "portrait" : "landscape"), fps: FPS, frames: durationFor(request.input) };
}
export function renderMetadata(request: RenderRequest) {
  const source = renderSource(request);
  const long = request.output.quality === "1080p" ? 1920 : 1280;
  const short = request.output.quality === "1080p" ? 1080 : 720;
  const durationInFrames = Math.max(1, Math.round(source.frames / source.fps * request.output.fps));
  return {
    width: request.output.aspect_ratio === "9:16" ? short : long,
    height: request.output.aspect_ratio === "9:16" ? long : short,
    fps: request.output.fps,
    durationInFrames,
    duration: durationInFrames / request.output.fps,
    codec: "h264" as const,
  };
}
