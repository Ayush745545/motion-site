# Professional timeline editor

Open `/studio` with a saved project or create a project at `/create`. Existing browser-local projects are preserved and converted to the new document when opened. Text, typography, colors, scene identity, timing, and entrance presets carry over.

## Editing

- The monitor is a real Remotion Player. Space toggles playback; Left/Right step one frame when focus is outside a form control. The frame field, ruler, and scrubber seek exact frames. Preview zoom and timeline zoom are independent.
- Click a scene or layer to inspect it. Drag scene cards to reorder them; the earlier/later buttons provide a keyboard alternative. The ruler and layer lanes scroll horizontally at higher zoom levels.
- Add text layers and local PNG, JPEG, or WebP images. Drag a layer's clip to change its start, or its right handle to change duration. Timing fields provide exact values. Scene shortening clamps layer timing and keyframes to the remaining frames.
- The inspector edits scene background, transitions and duration; layer position, size, scale, rotation, opacity, timing, typography, colors, and entrance presets. Image fit supports contain/cover.
- Choose a keyframe property and value, move the playhead, and add keyframes. Frames are relative to the layer; X/Y are top-left coordinates in composition pixels. Existing keyframes can be moved, edited, removed, and assigned linear or eased interpolation.
- Undo/redo use immutable document snapshots, capped at 50 edits. Continuous typing and drag gestures form one undo group. Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes. A new edit clears the redo branch. History belongs to the current project and lasts for the editing session.

Changes update the Player immediately. Browser persistence is debounced by 300ms, with flushes on page hide/unload and an explicit Save now button. Storage errors keep edits in memory and provide retry guidance.

## One document, one composition

`packages/motion-engine/src/project.ts` defines the runtime-validated `ProjectDocument` schema:

```text
schemaVersion: 1.0
composition: width, height, fps
scenes: stable IDs, names, frame durations, backgrounds, transitions
layers: text/image, scene references, frame timing, transforms, appearance, keyframes
assets: stable IDs and bounded inline raster images
export: H.264, CRF 18, yuv420p
```

`TimelineComposition` reads this document in both the Player and the registered `TimelineDNA` renderer. Presets, easing, transitions, and keyframes use frame-based calculations in the shared engine. Export does not translate the editor into a second animation implementation.

IDs are unique throughout the document. All scene/asset references, frame ranges, keyframe locations, and per-property values are validated. The current limits are 12 scenes, 100 layers, 20 assets, 200 keyframes per layer, 21,600 total frames, and 1,800 frames per scene. Compositions use even dimensions from 320 to 1920 pixels and 24/30/60 FPS. The UI offers landscape, portrait, and square presets.

Images must be readable inline PNG/JPEG/WebP files up to 2 MB and 4096 pixels per side, with a 2.8 MB encoded asset budget per document. Arbitrary remote media and executable source are not loaded by the composition.

## Export

Click **Export MP4**. The client submits its current document to `POST /api/motion/render`, which validates it, records an actual local job, and starts the Remotion renderer. The monitor and job use the same immutable document snapshot. You can continue editing while that snapshot renders. Actual progress, failures, and the completed download appear below the editor and in `/queue`.

Build the motion bundle after changing engine code:

```bash
pnpm motion:bundle
```

For a serialized document saved as `{ "document": ... }`:

```bash
pnpm motion:render --props /absolute/path/project.json --output /absolute/path/video.mp4
```

The existing DNA template and Director compositions remain available at `/generate` and `/director`. Their established render input is still accepted by the same job service.

## Verification

```bash
pnpm check
TIMELINE_RENDER_TESTS=1 VIDEO_RENDER_TESTS=1 pnpm test:e2e
```

Tests cover migration, immutable/coalesced history, branching redo, timing/keyframe clamps, ID validation, duplicate-scene references, safe raster input, debounced saves, unload flushing, live Player updates, frame stepping, image import, keyframe interpolation, drag reorder, responsive layout, and actual export/download.

The acceptance flow creates a project, edits text, changes timing, undoes both changes, redoes the text change, and exports. It verifies that the render request equals the saved editor document. A locally rendered acceptance MP4 was independently checked with FFprobe: 1920×1080, 30 FPS, 12 seconds, 360 decoded frames.

Current scope: text and still-image layers with transform keyframes. Audio tracks, source video clips, arbitrary effect plugins, and cloud collaboration are not part of this phase. Project documents autosave to the signed-in local account with version checks; uploaded images use private owner-scoped storage. Device preferences remain in browser storage.
