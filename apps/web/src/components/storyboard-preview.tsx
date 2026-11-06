"use client";
import { useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { MotionComposition, dimensions, durationFor, compositionScenes, type MotionConfig } from "@motion-dna/motion-engine";
export default function StoryboardPreview({config}:{config:MotionConfig}){
 const player=useRef<PlayerRef>(null);const size=dimensions(config.format);
 return <><Player ref={player} component={MotionComposition} inputProps={{config}} durationInFrames={durationFor(config)} compositionWidth={size.width} compositionHeight={size.height} fps={30} controls acknowledgeRemotionLicense style={{width:"100%",aspectRatio:`${size.width}/${size.height}`}}/><div className="director-preview-seek">{compositionScenes(config).map(scene=><button type="button" key={scene.id} onClick={()=>{player.current?.pause();player.current?.seekTo(scene.from+Math.min(30,scene.duration-1));}}>Preview {scene.kind}</button>)}</div></>;
}
