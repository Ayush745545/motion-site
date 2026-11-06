# Motion generation

## Local setup on macOS

Use the existing root `.env` and Phase 3 setup. From `/Users/aysuh/Desktop/motion-dna`:

```bash
pnpm install --frozen-lockfile
pnpm motion:bundle
pnpm dev
```

Open [DNA video studio](http://127.0.0.1:3000/generate). The sample plays immediately without an AI API. A project's Generate DNA video link opens the same workspace with persisted editable copy. Select Project website analysis to load a completed backend analysis and its actual screenshot. Docker/PostgreSQL are needed for website capture; the video engine can preview/render its bundled sample independently.

Click Render MP4. The disk-backed job records actual Remotion rendering/encoding progress; completion exposes the MP4 download. Render queue lists those same records. Only one UI render is admitted at a time. The worker runs independently of the request, and browser refresh does not interrupt encoding. Opening the queue recovers its status.

The first export downloads Remotion's Chromium runtime (about 171 MB) and requires internet. Later exports use the cached runtime in the motion-engine package. All fonts and sample imagery are bundled locally. No paid video generation API, provider key, Redis or external rendering service is required.

## Composition and input

Both Player and export use `MotionComposition`. `MotionConfigSchema` validates the normalized brand, three feature highlights, copy, template and orientation. Without a Director storyboard, the video is 450 frames, 30 FPS, 15 seconds. A validated Director storyboard can supply four reordered scenes and an 8–60 second frame budget:

| Frames | Scene |
| --- | --- |
| 0–89 | Animated monogram and brand introduction |
| 90–209 | Actual screenshot, camera transform and parallax outline |
| 210–359 | Three staggered feature cards and typography reveals |
| 360–449 | Brand identity, CTA and website address |

Five templates change geometry, decorative treatment, title alignment, transition style and spring behavior. Portrait uses a vertical card stack and adjusted safe margins. Text bounds, wrapping and adaptive large-title sizes protect the composition. Composition animation uses frame state, interpolation/easing and springs; no random or wall-clock state determines rendered frames. The last frame holds the CTA.

`normalizeDNA()` validates the backend's schema 1.0 JSON before selecting role-frequency colors, readable foreground, bundled font family/weight, entrance duration, transform travel and spring damping. Exact website fonts are mapped to Inter/Lora/IBM Plex Mono for reproducible local loading; original font binaries are not downloaded. CSS observations guide the motion style; website JavaScript animations are not reconstructed. Unicode glyphs outside the bundled Latin fonts may use platform fallback.

The fixture is `packages/motion-engine/src/sample-dna.json`, paired with authored `fixtures/sample-site.html` and `public/motion/sample-site.png`. It is explicitly sample data. Unit tests mutate its palette, type and motion observations to verify their actual influence on normalized parameters.

## Renderer and safety

The Next.js Node routes validate the composition and forward the signed-in account session to FastAPI. FastAPI persists an owner-scoped render job in PostgreSQL; the separate local Python worker claims one job at a time and invokes the fixed Remotion CLI:

- `POST /api/motion/render` accepts a bounded validated composition and returns HTTP 202 plus a real job record.
- `GET /api/motion/render/{id}?project_id={uuid}` retrieves an owned project's persisted status.
- `GET /api/motion/render/{id}/download?project_id={uuid}` streams an owned completed H.264/yuv420p MP4.
- `GET /api/render-jobs` returns the signed-in account's recent render history.

Each render is stored under `storage/renders/{uuid}/` with the immutable request, bounded attempt logs, verified metadata, and completed `video.mp4`. Render rows and export downloads are scoped to the owning account and active project. Remote image URLs, SVG and executable HTML are rejected; screenshots are bounded PNG data URLs. Explicit origin checks and a 2.95 MB request limit protect the local endpoint. Captures are limited to 2 MB and 4096 pixels per side. No URL fetching is performed by the renderer beyond its own bundle/font server.

PostgreSQL idempotency prevents duplicate queue admission, and the worker claim transaction allows one active render at a time. Jobs have bounded retries and cancellation; progress comes from Remotion callbacks. The worker probes output metadata before publishing the MP4. This is a local service rather than a hosted render platform.

The manual scene editor remains a separate editing mode. Its freely edited scene timeline is not automatically converted to the fixed four-scene DNA composition. Music, voiceovers, uploaded logos, distributed scheduling and arbitrary scene export are later work. Generated monograms are used for brand marks.

## CLI and verification

```bash
pnpm motion:bundle
pnpm motion:render --template cinematic --output ../../storage/renders/launch.mp4
pnpm motion:render --template technology --format portrait --output ../../storage/renders/portrait.mp4
pnpm check
pnpm test:video:e2e
pnpm test:dna:e2e
```

The CLI can take `--props /absolute/config.json` and diagnostic `--still FRAME --output /absolute/frame.png`. Input is a MotionConfig object, not a wrapper object. Rebuild the bundle after engine source changes.

Use FFprobe when installed to inspect actual output:

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate,duration,nb_read_frames \
  -of json storage/renders/launch.mp4
```

Expected: H.264, requested dimensions, `30/1`, `15.000000`, 450 decoded frames. Remotion includes its own encoding binaries; a separate FFmpeg installation is useful for inspection but not required for export. Browser suites should run sequentially because they share the Playwright output directory.

API references: [Remotion Player](https://www.remotion.dev/docs/player/player), [parameterized compositions](https://www.remotion.dev/docs/parameterized-rendering), [server rendering](https://www.remotion.dev/docs/renderer/render-media). See [Remotion licensing](https://www.remotion.dev/license) for its project usage terms.
