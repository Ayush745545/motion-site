# Phase 4 — motion generation engine

Implemented in `/Users/aysuh/Desktop/motion-dna` on 2026-10-28.

## Delivered

- A real Remotion 4.0.539 project inside `packages/motion-engine`, with matching Player/bundler/renderer versions and a reproducible pnpm lockfile.
- Five template directions: cinematic product launch, modern SaaS promotion, minimal typography, dynamic technology showcase and app interface walkthrough.
- Shared MotionScene, AnimatedText, WebsiteReveal, FeatureCard, BrandLogo, TransitionController and MotionComposition components.
- Four frame-driven scenes, 450 frames / 30 FPS / 15 seconds, in 1920×1080 and 1080×1920. Easing, springs, safe margins and wrapping use deterministic input/frame state.
- Strong runtime-validated animation parameters and backend DNA normalization. Colors, font mapping/weight, entrance duration, spring damping and travel respond to the actual DNA document.
- Authored Atlas DNA/HTML/PNG fixture; bundled Inter, Lora and IBM Plex Mono with OFL license files. The sample is visibly labeled.
- `/generate` with a working Remotion Player, exact frame input/stepping, scene seeking, template/resolution selection, persisted project copy and actual backend capture loading.
- Local disk-backed MP4 jobs, progress from Remotion, archive/status routes, streamed downloads and HTTP byte-range support. The render queue shows the same job records.

## Main files

- `packages/motion-engine/src/{schema,motion,sample,jobs,index}.ts`, `sample-dna.json`, `{components,fonts,MotionComposition,Root,entry}.tsx`
- `packages/motion-engine/scripts/{bundle.mjs,render.ts}` and `tests/engine.test.ts`
- `packages/motion-engine/fixtures/sample-site.html`, `public/motion/sample-site.png` and bundled licensed fonts
- `apps/web/src/components/{video-generator.tsx,video-workspace.tsx,video-workspace.css}`
- `apps/web/src/app/generate/page.tsx`
- `apps/web/src/lib/server/renders.ts`
- `apps/web/src/app/api/motion/render/route.ts`, `[id]/route.ts`, `[id]/download/route.ts`
- Updated project schema, studio/analysis/dashboard links, navigation, render queue, commands and configuration
- `tests/e2e/video-generation.spec.ts`, extended DNA acceptance test and updated render queue/editor tests
- `docs/motion-generation.md`, package README and updated root/development/architecture guides

## Verification

Commands executed include `pnpm install`, `pnpm motion:bundle`, `pnpm motion:render`, `pnpm check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, the video/browser suites, FFprobe inspection and FFmpeg frame extraction.

Actual encoded outputs:

| File under storage/renders | Encoding | Dimensions | FPS | Duration | Decoded frames |
| --- | --- | --- | --- | --- | --- |
| phase4-cinematic-landscape.mp4 | H.264 | 1920×1080 | 30 | 15.000 s | 450 |
| phase4-technology-portrait.mp4 | H.264 | 1080×1920 | 30 | 15.000 s | 450 |

`VIDEO_RENDER_TESTS=1 DNA_LIVE_TESTS=1 pnpm test:e2e` passed all **11 browser acceptance tests**, including real backend DNA ingestion, frame seeking, saved copy, existing editor regressions, MP4 encoding/download and byte-range behavior. `pnpm peers check` reports no peer dependency issues.

The UI also submitted and completed a real sample export; its UUID folder contains the input, job status, log and actual MP4. Rendered landscape/portrait frames and desktop/mobile Player screenshots were inspected for layout and text safety. Ignored verification artifacts are under `.cache/phase4-frames` and `.cache/screenshots`.

`pnpm check` passed 111 unit tests (6 motion-engine, 5 shared, 38 web and 62 API/security), lint, strict TypeScript, Remotion bundling, Next.js production build and Python package build. Two Docker-only analyzer tests remain opt-in in the standard unit run.

Unit checks cover all five templates/both formats, exact scene boundaries, repeatable frame math, DNA influence, contrast fallback, unsafe resources and bounded input. Existing web/API checks remain part of `pnpm check`. The initial parallel browser invocations collided in Playwright's shared artifact directory; acceptance is rerun sequentially. The browser integration also caught a seek-during-loading race; frame input is now disabled until the actual capture/Player is ready.

## Limitations

- This exports the four-scene DNA composition; arbitrary manual timeline export is separate future work.
- Brand logos are animated monograms. External logo candidates and website font binaries are not downloaded automatically.
- Typography maps to bundled Latin font families; glyphs outside those fonts may use platform fallback. Motion uses observed CSS signals, not reconstructed website JavaScript behavior.
- Exports are silent. Music, voiceovers, captions and distributed rendering are not included.
- One UI render at a time, 100 archived jobs, ten-minute cancellation deadline. This local Node/disk implementation is not a serverless or authenticated hosted service.
- The first export requires a Chromium download. Rendering after setup uses local assets and encoding binaries, without a paid AI video API.

See [motion generation](motion-generation.md) for exact setup, endpoint behavior and CLI options.
