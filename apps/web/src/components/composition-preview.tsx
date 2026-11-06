"use client";

import { useEffect, useId, useRef, type CSSProperties } from "react";
import { gsap } from "gsap";
import type { Project, Scene } from "@/lib/project-schema";

export const FONT_FAMILIES: Record<Scene["fontFamily"], string> = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SFMono-Regular', Consolas, monospace",
};

export function CompositionPreview({ scene, resolution, progress = 1, reducedMotion = false, compact = false }: {
  scene: Scene;
  resolution: Project["resolution"];
  progress?: number;
  reducedMotion?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const descriptionId = useId();
  useEffect(() => {
    if (reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(".composition-surface", { opacity: 0.65, y: 5 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
    }, ref);
    return () => context.revert();
  }, [scene.id, reducedMotion]);

  const entrance = reducedMotion ? 1 : Math.min(1, Math.max(0, progress) * 5);
  const transform = scene.animation === "slide" ? `translateY(${(1 - entrance) * 18}px)` : scene.animation === "scale" ? `scale(${0.93 + entrance * 0.07})` : "none";
  const styles = {
    "--composition-bg": scene.background,
    "--composition-fg": scene.foreground,
    "--composition-accent": scene.accent,
    "--composition-font": FONT_FAMILIES[scene.fontFamily],
    "--composition-font-size": `${scene.fontSize}px`,
    aspectRatio: resolution.replace("x", " / "),
  } as CSSProperties;
  return <div ref={ref} className={`composition-preview ${compact ? "composition-compact" : ""}`} style={styles} role="img" aria-label="Composition preview" aria-describedby={descriptionId}>
    <span id={descriptionId} className="sr-only">{scene.headline}. {scene.subline}</span>
    <div className="composition-surface">
      <div className="composition-grid" aria-hidden="true"/>
      <div className="composition-orb composition-orb-one" aria-hidden="true"/>
      <div className="composition-orb composition-orb-two" aria-hidden="true"/>
      <div className="composition-topline"><span className="composition-mark" aria-hidden="true">m.</span><span>MADE TO MOVE</span></div>
      <div className={`composition-copy composition-align-${scene.align}`} style={{ opacity: 0.25 + entrance * 0.75, transform }}>
        <span className="composition-eyebrow">A NEW PERSPECTIVE</span>
        <strong>{scene.headline || "Your headline"}</strong>
        {scene.subline && <p>{scene.subline}</p>}
        <span className="composition-copy-line" aria-hidden="true"/>
      </div>
      <div className="composition-bottomline"><span>MOTION DNA</span><span>LOCAL COMPOSITION <span aria-hidden="true">↗</span></span></div>
    </div>
  </div>;
}
