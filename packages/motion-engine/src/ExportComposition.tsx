import { useMemo } from "react";
import { AbsoluteFill, Freeze, Sequence, useCurrentFrame } from "remotion";
import { TimelineComposition } from "./TimelineComposition";
import { MotionComposition } from "./MotionComposition";
import { RenderRequestSchema, renderMetadata, renderSource, type RenderRequest } from "./render-request";

/** Output resampling wraps the original composition; it never reimplements scene motion. */
export function ExportComposition({ request }: { request: RenderRequest }) {
  const parsed = useMemo(() => RenderRequestSchema.parse(request), [request]);
  const frame = useCurrentFrame();
  const target = renderMetadata(parsed), source = renderSource(parsed);
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const sourceFrame = Math.min(source.frames - 1, Math.floor(frame * source.fps / target.fps));
  const background = "document" in parsed.input ? parsed.input.document.scenes[0]!.background : parsed.input.brand.background;
  return <AbsoluteFill className="export-composition" style={{ background, overflow: "hidden" }}>
    <div style={{ position: "absolute", width: source.width, height: source.height,
      left: (target.width - source.width * scale) / 2, top: (target.height - source.height * scale) / 2,
      transform: `scale(${scale})`, transformOrigin: "top left" }}>
      <Sequence width={source.width} height={source.height} durationInFrames={target.durationInFrames}>
        <Freeze frame={sourceFrame}>
          {"document" in parsed.input ? <TimelineComposition document={parsed.input.document}/> : <MotionComposition config={{ ...parsed.input, format: parsed.output.aspect_ratio === "9:16" ? "portrait" : "landscape" }}/>} 
        </Freeze>
      </Sequence>
    </div>
  </AbsoluteFill>;
}
