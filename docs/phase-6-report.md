# Phase 6 — Professional motion timeline editor

Implemented in `/Users/aysuh/Desktop/motion-dna`.

## Completed

- Real Remotion Player and `TimelineDNA` MP4 composition consume the same versioned project document.
- Scene ruler/tracks, text/image layer tracks, scrubbing, frame stepping, playback, timeline/preview zoom, and scene selection.
- Scene dragging and accessible reorder controls; layer clip dragging/resizing and exact frame timing fields.
- Transform, typography, color, background, animation, transition, and keyframe inspector controls.
- Immutable history with grouped edits, 50-step undo/redo, keyboard shortcuts, and branching redo invalidation.
- Debounced browser autosave with lifecycle flushing, explicit saving state, error recovery, and a manual save action.
- Existing drafts migrate with their scene identities and content retained. The prior DNA-analysis controls bridge into the timeline while preserving added layers.
- Inline raster asset validation and bounded rendering input. Actual job progress and MP4 downloads use the existing local render queue.

## Files

Created:

- `packages/motion-engine/src/project.ts`, `TimelineComposition.tsx`, and `render-input.ts`.
- `packages/motion-engine/tests/project.test.ts`.
- `apps/web/src/lib/timeline-document.ts` and `timeline-state.ts`.
- `apps/web/src/components/timeline-editor-model.ts`, `timeline-inspector.tsx`, `timeline-tracks.tsx`, and `timeline-editor.css`.
- `apps/web/src/lib/server/image-data.ts`.
- `apps/web/tests/timeline-state.test.ts` and `image-data.test.ts`.
- `tests/e2e/timeline.spec.ts`, this report, and `docs/timeline-editor.md`.

Updated the engine root/exports/fonts/render script; project schema/workspace persistence; motion editor; local render service/route; related persistence/editor/browser tests; and README. The existing Director and DNA-template compositions remain operational.

## Commands and results

```bash
uv run --directory apps/api pytest tests/test_director.py
pnpm --filter @motion-dna/motion-engine build
pnpm check
TIMELINE_RENDER_TESTS=1 VIDEO_RENDER_TESTS=1 pnpm exec playwright test
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_read_frames,duration \
  -of json storage/renders/b414fb70-eba8-4cb8-903a-c06a41e0222c/video.mp4
```

- `pnpm check` passed lint, strict TypeScript, **151 unit tests** (15 engine, 5 shared contracts, 45 web, 86 API), Remotion bundling, Next.js production build, and Python source/wheel builds.
- **14 browser tests passed**, including real timeline and DNA-template MP4 encoding and downloads. One live public-site capture test was skipped. Three Docker-only capture tests were also skipped in the default API unit run.
- The Director was separately revalidated: **24 tests passed**, covering the three website fixtures, category/content changes, model provenance, and graceful fallback.
- The timeline acceptance flow edited text and timing, undid both, redid the text, and exported. The submitted render document was identical to the saved editor document.
- FFprobe verified the actual acceptance artifact: **1920×1080, 30 FPS, 12.000 seconds, 360 decoded frames**. Artifact: `storage/renders/b414fb70-eba8-4cb8-903a-c06a41e0222c/video.mp4`.
- Browser tests verified image import, actual keyframe interpolation, scene drag reorder, zoom, frame stepping, reload persistence, and keyboard playback. Visual checks found no document overflow at 320, 390, 768, 1024, and 1600px.

Screenshots: `.cache/screenshots/phase6-editor-desktop-final.png` and `phase6-editor-mobile-final.png`. Detailed logs are under `.cache/phase6-*`.

## Limits

The editor supports text and still-image layers with transform keyframes. Audio/video footage tracks, effect plugins, cloud project persistence, and collaborative editing are outside this phase. Browser storage quota still limits large image archives; failures preserve in-memory edits and offer retry. History is session-local. Raster imports and document/frame counts have explicit bounds documented in the editor guide.

The current acceptance tests exercise local, real rendering. They do not claim that external paid LLM services or public-site capture were revalidated by this timeline work.
