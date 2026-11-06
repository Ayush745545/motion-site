import { Easing, interpolate, spring } from "remotion";
import type { Brand, MotionConfig } from "./schema";
export function entrance(frame:number,brand:Brand,template:MotionConfig["template"]){
  const progress=interpolate(frame,[0,brand.entranceFrames],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp",easing:Easing.bezier(.22,1,.36,1)});
  const bounce=spring({frame:Math.max(0,frame),fps:30,durationInFrames:brand.entranceFrames,config:{damping:brand.damping,stiffness:120,mass:.8}});
  return {opacity:progress,translate:template==="typography"?0:(1-progress)*brand.travel,scale:template==="saas"?.94+.06*bounce:1};
}
export function transitionOpacity(frame:number,duration:number,last=false){return interpolate(frame,last?[0,10]:[0,10,duration-10,duration-1],last?[0,1]:[0,1,1,0],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});}
