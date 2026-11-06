import { z } from "zod";

/** Phase 1 wire contracts. Project and motion schemas belong to later phases. */
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("motion-dna-ai-api"),
  version: z.string().min(1),
  environment: z.enum(["development", "test", "production"]),
});

export const ReadyResponseSchema = z.object({
  status: z.literal("ok"),
  database: z.literal("connected"),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

export { DNAJobSchema, DNAResultSchema, type DNAJob, type DNAResult } from "./analysis";
export { StoryboardSchema, DirectedSceneSchema, BriefSchema, CategorySchema, StyleSchema, type Storyboard, type DirectorBrief } from "./director";
export { SourceDNASchema, type SourceDNA } from "./source";
