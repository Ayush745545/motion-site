import { Composition } from "remotion";
import { MotionComposition } from "./MotionComposition";
import { TimelineComposition } from "./TimelineComposition";
import { defaultProjectDocument, ProjectDocumentSchema, totalFrames } from "./project";
import { sampleConfig } from "./sample";
import { dimensions, DURATION, durationFor, FPS, MotionConfigSchema } from "./schema";
import { ExportComposition } from "./ExportComposition";
import { RenderRequestSchema, renderMetadata } from "./render-request";

const timelineDefault = defaultProjectDocument();

export function Root() {
  return <>
    <Composition id="ExportDNA" component={ExportComposition}
      width={1920} height={1080} fps={30} durationInFrames={450}
      defaultProps={{ request: { project_id: "00000000-0000-4000-8000-000000000001", project_name: "Atlas sample", idempotency_key: "sample-default", input: sampleConfig, output: { quality: "1080p" as const, aspect_ratio: "16:9" as const, fps: 30 as const } } }}
      calculateMetadata={({props}) => {
        const request = RenderRequestSchema.parse(props.request);
        const { width, height, fps, durationInFrames } = renderMetadata(request);
        return { width, height, fps, durationInFrames, props: { request } };
      }}/>
    <Composition
      id="MotionDNA"
      component={MotionComposition}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ config: sampleConfig }}
      calculateMetadata={({ props }) => {
        const config = MotionConfigSchema.parse(props.config);
        return { ...dimensions(config.format), fps: FPS, durationInFrames: durationFor(config), props: { config } };
      }}
    />
    <Composition
      id="TimelineDNA"
      component={TimelineComposition}
      durationInFrames={totalFrames(timelineDefault)}
      fps={timelineDefault.composition.fps}
      width={timelineDefault.composition.width}
      height={timelineDefault.composition.height}
      defaultProps={{ document: timelineDefault }}
      calculateMetadata={({ props }) => {
        const document = ProjectDocumentSchema.parse(props.document);
        return { ...document.composition, durationInFrames: totalFrames(document), props: { document } };
      }}
    />
  </>;
}
