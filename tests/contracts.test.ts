import assert from "node:assert/strict";
import test from "node:test";
import { getServerEnv } from "../packages/config/src/index";
import { HealthResponseSchema, ReadyResponseSchema, SourceDNASchema } from "../packages/dna-schema/src/index";

test("server env has a local default and normalizes trailing slash", () => {
  assert.equal(getServerEnv({}).API_BASE_URL, "http://127.0.0.1:8000");
  assert.equal(getServerEnv({ API_BASE_URL: "http://localhost:8000/" }).API_BASE_URL, "http://localhost:8000");
});

test("server env rejects non-HTTP, credentials, and ambiguous base URLs", () => {
  for (const value of ["file:///tmp/x", "ftp://localhost", "no-url", "http://user:secret@localhost", "http://localhost/api", "http://localhost?token=secret"]) {
    assert.throws(() => getServerEnv({ API_BASE_URL: value }));
  }
});

test("health wire contract rejects malformed external responses", () => {
  assert.equal(HealthResponseSchema.safeParse({ status: "ok", service: "motion-dna-ai-api", version: "0.1.0", environment: "test" }).success, true);
  assert.equal(HealthResponseSchema.safeParse({ status: "ok" }).success, false);
  assert.equal(HealthResponseSchema.safeParse({ status: "down", service: "motion-dna-ai-api", version: "0.1.0", environment: "test" }).success, false);
});

test("readiness requires an actual connected state", () => {
  assert.equal(ReadyResponseSchema.safeParse({ status: "ok", database: "connected" }).success, true);
  assert.equal(ReadyResponseSchema.safeParse({ status: "ok", database: "unknown" }).success, false);
});

test("source DNA contract requires a grounded, four-scene static storyboard", () => {
  const scene = (id: "intro" | "reveal" | "features" | "cta") => ({
    id,
    headline: id,
    description: "Static source observation.",
    motion_preset: "fade" as const,
    evidence: ["package.json"],
    visual_assets: [],
    visual_assets_available: false as const,
  });
  const source = {
    schema_version: "1.0",
    source_type: "zip",
    source_name: "Sample repository",
    analyzed_at: new Date().toISOString(),
    technology_fingerprint: [], dependencies: [], styling_systems: [], theme_tokens: [],
    ui_components: [], animation_libraries: [], routes: [], readme_summary: "",
    product_summary: "No product description was found.", summary_evidence: [],
    product_category: "technology", category_confidence: 0.2,
    motion_opportunities: [{ suggestion: "Reveal the source structure.", evidence: [], confidence: 0.4 }],
    assets: [],
    storyboard: {
      creative_concept: "A source-grounded introduction.", opening_hook: "Sample repository",
      scenes: [scene("intro"), scene("reveal"), scene("features"), scene("cta")],
      cta: "Explore the project", confidence: 0.4, fallback_used: true, model: "static-rules-v1",
    },
    confidence: 0.4, warnings: [],
  };
  assert.equal(SourceDNASchema.safeParse(source).success, true);
  assert.equal(SourceDNASchema.safeParse({
    ...source,
    storyboard: {
      ...source.storyboard,
      scenes: [scene("intro"), scene("intro"), scene("features"), scene("cta")],
    },
  }).success, false);
});

test("analysis origins use the explicit validated allowlist", () => {
  assert.deepEqual(getServerEnv({}).CORS_ALLOWED_ORIGINS, ["http://localhost:3000", "http://127.0.0.1:3000"]);
  for (const value of ['["*"]', '[]', '["https://example.com/path"]', 'not-json']) {
    assert.throws(() => getServerEnv({CORS_ALLOWED_ORIGINS:value}));
  }
});
