# AI Video Director

Open `/director` for the labeled sample or follow **Open AI Director** from a project's video studio. A project needs a completed website analysis. The Director loads its actual DNA, screenshot, public headings, paragraphs and CTA labels. Add optional source-backed notes in Website content summary, choose category/audience/duration/style/aspect ratio, then generate.

Four scenes are returned as validated JSON: concept, opening hook, ordered scene kinds, descriptions, headlines, evidence IDs, asset references, motion presets, transitions, exact frame durations, CTA, classification confidence and generation/fallback metadata. Duration is 8–60 seconds at 30 FPS. SaaS weights prioritize the interface reveal and documented benefits. E-commerce, portfolio, agency, mobile-app and technology-startup rules have distinct category signals and pacing. Weak classification is marked explicitly and can be overridden.

## Grounding

Public source snippets and the user-supplied summary form a bounded evidence table. Generated claims are verbatim excerpts from that table, with neutral visual instructions for scene descriptions. The optional LLM selects fact IDs and motion/timing; it cannot introduce free-form product claims, new URLs or unsupported functionality. Unknown facts, extra claim fields, invalid scene kinds or mismatched frame totals reject the provider plan and trigger deterministic fallback.

Source excerpts can themselves be inaccurate, and supplied summaries are not independently verified. Confidence values are heuristic, not calibrated truth probabilities. A manual category selection records that choice rather than claiming automatic certainty. With no source evidence, neutral website language and a low confidence score are used. Missing screenshots and sparse evidence receive warnings.

Public content extraction excludes forms, editable surfaces, script/style contents and elements marked `data-private`. It runs in the existing anonymous browser context. No browser session, passwords or form values are collected. Public page text and pixels can include publicly displayed personal information; this is not a general-purpose redaction service. The optional `content` field is an additive schema-1.0 DNA extension; older saved analyses still validate and can use a supplied summary or be recaptured.

## Editing and preview

- Regenerate requests another deterministic variant (or optional provider plan), replacing scene edits. Identical input and variant produce identical fallback output.
- Edit individual headlines/descriptions; changes commit on blur and update the preview. Descriptions appear as direction captions, not arbitrary natural-language animation code.
- Move scenes earlier/later with keyboard-accessible controls. Presets and transitions can be changed per scene. Generated scenes begin with intro and end with CTA; manual reordering is an explicit user choice.
- Preview each scene in the real Remotion Player. Scene order, copy, description captions, timing, presets and transitions also reach MP4 export.
- Valid storyboards save in the local project, including generator/model identity and a user-edited flag. The sample is ephemeral and downloadable as JSON. JSON exports include evidence and fallback information.
- Open video studio to export. A storyboard for another analysis ID is not applied. The brief's initial orientation/style seed the video studio, where the output format can also be changed.

## Providers

Default configuration requires no model, credentials or AI service:

```dotenv
DIRECTOR_PROVIDER=deterministic
```

The adapter protocol is `generate(context) -> validated Plan`. The context includes bounded source facts, inferred category, audience, frame budget, style, aspect ratio, DNA signatures and regeneration variant. Responses are validated again before locally assembling the complete storyboard.

### Optional local Ollama

Run your chosen installed model in Ollama, then set the server configuration and restart FastAPI:

```dotenv
DIRECTOR_PROVIDER=local
DIRECTOR_MODEL=qwen2.5:7b
DIRECTOR_URL=http://127.0.0.1:11434/api/chat
```

The adapter uses Ollama's `/api/chat`, `stream:false`, a JSON Schema `format`, temperature zero and the brief variant as seed. The model must already be installed; this app does not silently download or start models. See [Ollama's API specification](https://github.com/ollama/ollama/blob/main/docs/api.md).

### Optional API gateway

`DIRECTOR_PROVIDER=api` supports a provider-neutral JSON gateway, rather than coupling the project to a vendor SDK. Configure `DIRECTOR_URL` to an HTTPS endpoint and `DIRECTOR_MODEL` to your model. An optional `DIRECTOR_API_TOKEN` is sent as a Bearer credential only from FastAPI. Credentials stay out of frontend bundles, logs, source fixtures and storyboards.

Request contract:

```json
{"model":"configured-model","instructions":"grounding instructions","input":{"facts":[],"total_frames":450,"category":"saas","target_audience":"Website visitors","style":"saas","aspect_ratio":"landscape","variant":0,"dna_signatures":{}},"output_schema":{"type":"object"}}
```

The real `output_schema` is `Plan.model_json_schema()`. Response contract:

```json
{"model":"actual-model-version","plan":{"opening_fact_id":null,"scenes":[]}}
```

The `scenes` array must contain exactly one intro, reveal, features and CTA, each with allowed fact IDs, `duration_frames`, `motion_preset` and `transition`. It must sum to the requested frame budget. Consult `/docs` or the backend Plan model for the full contract. The empty array above illustrates the envelope and intentionally is not a valid complete plan. A direct vendor endpoint may require a gateway to translate its API; no vendor credentials or paid calls are required by default.

Reported model identity is recorded when supplied; otherwise the configured model is recorded. Generation metadata retains requested provider/model separately from the actual provider/model used after fallback. API and local transports have 12-second HTTP deadlines, a 64 KB response limit, no ambient proxy/cookie use, no redirects, and no automatic retry. The overall provider call is bounded at 13 seconds. Only server configuration can select endpoints; browser input cannot choose a provider URL.

`POST /api/director/storyboard` accepts the DNA plus brief and returns Storyboard schema 1.0. Next.js exposes the same endpoint and validates both boundaries. Requests are bounded to 128 KB with explicit origin checks and two concurrent Director calls per API process. Invalid user input is rejected; provider failures fall back to a valid, grounded storyboard. If FastAPI itself is unreachable, the UI preserves the current board and offers retry through generation.

## Verification

```bash
pnpm check
pnpm test:analyzer
VIDEO_RENDER_TESTS=1 DNA_LIVE_TESTS=1 pnpm test:e2e
```

Three fixture sites live under `apps/api/tests/fixtures/director`: SaaS, e-commerce and portfolio. Tests capture all three in real isolated Chromium, then validate the four-scene outputs. Committed sample outputs are in `packages/dna-schema/fixtures/storyboard-*.json`; the JSON Schema is `packages/dna-schema/storyboard-v1.schema.json`.

Tests cover meaningful content changes, all six categories, deterministic regeneration, exact frame totals, grounding, invalid output, provider errors/timeouts, oversized responses, redirects, real local HTTP transport for both adapter contracts, persisted edits, reorder/style preview and render integration. Local/API adapters were exercised against fixture servers; no external paid model call is required or implied by those tests.
