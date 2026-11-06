import { z } from "zod";
export const RenderStatusSchema = z.enum(["queued", "running", "retrying", "cancelling", "cancelled", "completed", "failed"]);
export const RenderMetadataSchema = z.object({
  width: z.number().int().positive(), height: z.number().int().positive(),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  duration: z.number().positive(), frames: z.number().int().positive(),
  codec: z.literal("h264"), bytes: z.number().int().positive().optional(),
});
export const RenderJobSchema = z.object({
  id: z.uuid(), project_id: z.uuid().optional(), project_name: z.string().min(1).max(200),
  status: RenderStatusSchema, progress: z.number().min(0).max(100), stage: z.string().max(100),
  created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
  export_available: z.boolean().optional(),
  download_url: z.string().regex(/^\/api\/motion\/render\/[0-9a-f-]{36}\/download(?:\?project_id=[0-9a-f-]{36})?$/).optional(),
  error: z.string().max(300).nullable().optional(), error_code: z.string().max(100).nullable().optional(),
  attempt: z.number().int().min(0).max(2).optional(), max_attempts: z.number().int().min(1).max(2).optional(),
  output: RenderMetadataSchema.nullable().optional(), exit_code: z.number().int().nullable().optional(),
  pid: z.number().int().positive().optional(),
});
export const LocalRenderQueueSchema = z.object({ jobs: z.array(RenderJobSchema).max(100) });
export type LocalRenderJob = z.infer<typeof RenderJobSchema>;
