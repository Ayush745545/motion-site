# Motion engine

A real Remotion 4.0.539 project shared by the Next.js Player and local H.264 renderer. It produces 450 frames at 30 FPS (15 seconds), in 1920×1080 or 1080×1920.

```bash
pnpm motion:bundle
pnpm motion:render --output ../../storage/renders/sample.mp4
pnpm motion:render --format portrait --template technology --output ../../storage/renders/portrait.mp4
```

CLI relative output/props paths resolve from `packages/motion-engine`. A props file contains a validated `MotionConfig` object directly. Use `--props /absolute/config.json`. Render a diagnostic PNG with `--still 280 --output /absolute/frame.png`. Rebuild after composition changes. The CLI builds automatically only if the bundle is missing.

Open `/generate` for the labeled sample, or follow Generate DNA video from a project. Select a completed website analysis to use its actual normalized DNA and captured screenshot. Valid copy/template edits persist with that local project.

Templates: `cinematic`, `saas`, `typography`, `technology`, `walkthrough`. Four contiguous sequences cover intro (0–89), reveal (90–209), features (210–359) and CTA (360–449). Frame hooks, interpolation, easing and deterministic springs drive all video motion; wall-clock timers only govern job orchestration/polling.

The engine maps observed fonts to bundled Inter, Lora or IBM Plex Mono, with OFL license files in `public/motion/fonts`. RGB role frequencies choose palette values; a contrast check protects text readability. CSS duration/timing/transform observations influence entrance frames, spring damping and travel. The sample DNA JSON and authored website HTML/PNG demonstrate this mapping; they are clearly labeled sample content.

`components.tsx` exports MotionScene, AnimatedText, WebsiteReveal, FeatureCard, BrandLogo and TransitionController. `MotionComposition` is the shared component. The brand mark is an animated generated monogram, rather than an automatically downloaded logo candidate. Capture references arrive as bounded PNG data URLs; arbitrary remote resources and HTML are rejected.

See [motion-generation guide](../../docs/motion-generation.md) for setup, operational limits and verification.
