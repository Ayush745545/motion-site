import { z } from "zod";

const confidence = z.number().min(0).max(1);
const text = z.string().min(1).max(240);
const evidence = z.object({ path: z.string().min(1).max(240), claim: text, confidence }).strict();

export const SourceDNASchema = z.object({
  schema_version: z.literal("1.0"),
  source_type: z.enum(["zip", "github", "local_directory", "source_file"]),
  source_name: z.string().min(1).max(180),
  analyzed_at: z.iso.datetime({ offset: true }),
  technology_fingerprint: z.array(z.object({ name: text, version: z.string().max(80), evidence: z.string().min(1).max(240), confidence }).strict()).max(24),
  dependencies: z.array(z.object({ name: z.string().min(1).max(120), version: z.string().max(80), group: z.enum(["runtime", "development"]) }).strict()).max(120),
  styling_systems: z.array(z.object({ name: text, version: z.string().max(80), evidence: z.string().min(1).max(240), confidence }).strict()).max(16),
  theme_tokens: z.array(z.object({ name: z.string().min(1).max(120), value: z.string().min(1).max(120), kind: z.enum(["color", "font", "spacing", "radius"]), evidence: z.string().min(1).max(240) }).strict()).max(100),
  ui_components: z.array(z.object({ path: z.string().min(1).max(240), exports: z.array(z.string().max(120)).max(16) }).strict()).max(80),
  animation_libraries: z.array(z.object({ name: text, version: z.string().max(80), evidence: z.string().min(1).max(240), confidence }).strict()).max(20),
  routes: z.array(z.object({ path: z.string().min(1).max(180), kind: z.enum(["page", "api"]), evidence: z.string().min(1).max(240) }).strict()).max(120),
  readme_summary: z.string().max(600),
  product_summary: z.string().max(600),
  summary_evidence: z.array(evidence).max(12),
  product_category: z.enum(["saas", "ecommerce", "portfolio", "agency", "mobile", "technology"]),
  category_confidence: confidence,
  motion_opportunities: z.array(z.object({ suggestion: text, evidence: z.array(z.string().max(240)).max(8), confidence }).strict()).max(12),
  assets: z.array(z.object({ path: z.string().min(1).max(240), kind: z.enum(["logo_candidate", "image"]), available_for_render: z.literal(false), reason: z.string().max(180) }).strict()).max(80),
  storyboard: z.object({
    creative_concept: text,
    opening_hook: text,
    scenes: z.array(z.object({ id: z.enum(["intro", "reveal", "features", "cta"]), headline: text, description: text, motion_preset: z.enum(["fade", "slide", "spring", "parallax"]), evidence: z.array(z.string().max(240)).max(8), visual_assets: z.array(z.string().max(240)).max(8), visual_assets_available: z.literal(false) }).strict()).length(4),
    cta: text,
    confidence,
    fallback_used: z.literal(true),
    model: z.literal("static-rules-v1"),
  }).strict().superRefine((storyboard, context) => {
    const ids = storyboard.scenes.map(scene => scene.id);
    if (new Set(ids).size !== 4) {
      context.addIssue({ code: "custom", message: "Source storyboard must contain four distinct scenes." });
    }
  }),
  confidence,
  warnings: z.array(z.string().max(240)).max(16),
}).strict();

export type SourceDNA = z.infer<typeof SourceDNASchema>;
