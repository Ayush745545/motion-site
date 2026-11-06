import { z } from "zod";
const confidence = z.number().min(0).max(1);
const short = z.string().max(240);
export const DNAJobSchema = z.object({
  job_id: z.uuid(), status: z.enum(["queued", "running", "completed", "failed"]),
  created_at: z.iso.datetime({ offset: true }), analysis_id: z.uuid().nullable(),
  error: short.nullable(), error_code: short.nullable(),
});
export const DNAResultSchema = z.object({
  content:z.object({title:z.string().max(160),headings:z.array(short).max(12),paragraphs:z.array(short).max(12),ctas:z.array(short).max(8)}).nullable().optional(),
  schema_version: z.literal("1.0"), analysis_id: z.uuid(), source_url: z.string().max(2048),
  final_url: z.string().max(2048), captured_at: z.iso.datetime({ offset: true }),
  palette: z.array(z.object({ value: z.string().regex(/^#[0-9a-f]{6}$/i), role: z.enum(["background", "text", "primary", "accent"]), count: z.number().int().min(1).max(20000), frequency: confidence, confidence })).max(48),
  typography: z.object({ fonts: z.array(z.object({family: short, size: short, weight: short, count: z.number().int().min(1).max(5000), available: z.boolean()})).max(60), headings: z.array(z.object({level: z.number().int().min(1).max(6),count: z.number().int().min(1).max(5000),sizes:z.array(short).max(30)})).max(6), confidence }),
  layout: z.object({features:z.array(z.object({kind:z.enum(["hero","navigation","card","grid","section","button"]),count:z.number().int().min(0).max(5000),confidence})).max(6),visual_density:confidence,sampled_elements:z.number().int().min(0).max(5000),confidence}),
  motion: z.array(z.object({transition:short,transition_duration:short,animation:short,animation_duration:short,timing:short,transform:short,count:z.number().int().min(1).max(5000)})).max(60),
  motion_scope:z.literal("computed-css-only"),
  assets:z.array(z.object({url:z.url().max(2048).refine(url=>["https:","http:"].includes(new URL(url).protocol)),kind:z.enum(["logo_candidate","hero_illustration","visible_image"]),width:z.number().int().min(0).max(100000),height:z.number().int().min(0).max(100000),confidence})).max(60),
  screenshots:z.array(z.object({kind:z.enum(["viewport","hero"]),path:z.string().regex(/^\/api\/dna\/results\/[0-9a-f-]{36}\/screenshots\/(viewport|hero)$/),width:z.number().int().min(1).max(1440),height:z.number().int().min(1).max(1200)})).max(2),
  confidence,warnings:z.array(short).max(20),
});
export type DNAJob = z.infer<typeof DNAJobSchema>;
export type DNAResult = z.infer<typeof DNAResultSchema>;
