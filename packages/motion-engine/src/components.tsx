import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { entrance, transitionOpacity } from "./motion";
import { readableColor, type MotionConfig } from "./schema";
export function AnimatedText({children,config,delay=0,size=80,style={}}:{children:ReactNode;config:MotionConfig;delay?:number;size?:number;style?:CSSProperties}){
 const frame=useCurrentFrame();const e=entrance(frame-delay,config.brand,config.template);
 return <div data-motion-safe="text" style={{fontSize:size,fontWeight:config.brand.fontWeight,lineHeight:1.12,overflowWrap:"anywhere",whiteSpace:"normal",transform:`translateY(${e.translate}px) scale(${e.scale})`,...style,opacity:e.opacity*(typeof style.opacity==="number"?style.opacity:1)}}>{children}</div>;
}
export function BrandLogo({config,size=92}:{config:MotionConfig;size?:number}){
 const frame=useCurrentFrame();const e=entrance(frame,config.brand,config.template);
 const initial=Array.from(config.brandName)[0]?.toUpperCase() || "M";
 return <div aria-label={`${config.brandName} monogram`} style={{width:size,height:size,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:config.brand.accent,color:readableColor(config.brand.accent,"#ffffff"),borderRadius:config.template==="technology"?8:config.template==="typography"?size:Math.round(size*.26),fontSize:size*.55,fontWeight:700,opacity:e.opacity,transform:`scale(${.8+.2*e.opacity}) rotate(${(1-e.opacity)*-12}deg)`,boxShadow:config.template==="cinematic"?`0 24px 80px ${config.brand.accent}25`:"none"}}>{initial}</div>;
}
export function TransitionController({children,duration,last=false,config,transition}:{children:ReactNode;duration:number;last?:boolean;config:MotionConfig;transition?:"fade"|"slide"|"cut"}){
 const frame=useCurrentFrame();const x=(transition==="slide" || (!transition&&config.template==="technology"))?interpolate(frame,[0,12],[24,0],{extrapolateLeft:"clamp",extrapolateRight:"clamp"}):0;
 return <AbsoluteFill style={{opacity:transition==="cut"?1:transitionOpacity(frame,duration,last),transform:`translateX(${x}px)`}}>{children}</AbsoluteFill>;
}
export function MotionScene({children,config,label}:{children:ReactNode;config:MotionConfig;label:string}){
 const {width,height}=useVideoConfig();const portrait=height>width;
 return <AbsoluteFill style={{padding:portrait?80:90,display:"flex",flexDirection:"column",justifyContent:"center",gap:portrait?40:32}}>
  <div style={{position:"absolute",left:portrait?80:90,top:50,right:portrait?80:90,display:"flex",justifyContent:"space-between",fontSize:17,letterSpacing:3,textTransform:"uppercase",opacity:.65}}><span style={{maxWidth:"55%",overflowWrap:"anywhere"}}>{config.brandName}</span><span style={{textAlign:"right"}}>{label}</span></div>
  {children}
  <div style={{position:"absolute",bottom:42,left:portrait?80:90,right:portrait?80:90,display:"flex",justifyContent:"space-between",fontSize:16,opacity:.6}}><span style={{maxWidth:"65%",overflowWrap:"anywhere"}}>{config.website}</span><span>{config.provenance==="sample"?"SAMPLE BRAND STUDY":"BRAND IN MOTION"}</span></div>
 </AbsoluteFill>;
}
export function WebsiteReveal({config}:{config:MotionConfig}){
 const frame=useCurrentFrame();const {height,width}=useVideoConfig();const portrait=height>width;
 const e=entrance(frame,config.brand,config.template);const camera=interpolate(frame,[0,119],[0,1],{extrapolateRight:"clamp"});
 const tilt=config.template==="cinematic"?4:config.template==="technology"?-3:0;
 const source=config.screenshot==="sample"?staticFile("motion/sample-site.png"):config.screenshot;
 return <div style={{position:"relative",width:"100%",maxWidth:portrait?880:1400,alignSelf:"center",perspective:2400,padding:portrait?24:16}}>
  <div style={{position:"absolute",inset:portrait?8:0,border:`1px solid ${config.brand.accent}55`,borderRadius:32,transform:`translate(${(1-camera)*18}px,${camera*18}px)`,opacity:.5}}/>
  <div data-motion-safe="screenshot" style={{position:"relative",overflow:"hidden",border:`1px solid ${config.brand.foreground}30`,borderRadius:config.template==="technology"?10:22,boxShadow:"0 35px 100px #00000035",background:config.brand.background,opacity:e.opacity,transform:`translateY(${e.translate}px) rotateY(${tilt*(1-camera)}deg) rotateX(${tilt*.3}deg) scale(${.94+.04*camera})`}}>
   <div style={{height:48,display:"flex",alignItems:"center",padding:"0 22px",gap:8,borderBottom:`1px solid ${config.brand.foreground}18`}}>{[0,1,2].map(n=><span key={n} style={{width:10,height:10,borderRadius:10,background:config.brand.foreground,opacity:.25}}/>)}<span style={{fontSize:15,marginLeft:18,opacity:.55}}>{config.website}</span></div>
   <Img src={source} style={{width:"100%",height:portrait?570:530,objectFit:"contain",display:"block",background:config.brand.background}}/>
  </div>
  {config.template==="walkthrough" && <div style={{position:"absolute",bottom:40,right:40,background:config.brand.accent,color:readableColor(config.brand.accent,"#ffffff"),padding:"16px 24px",borderRadius:12,fontSize:22,transform:`translateY(${-camera*18}px)`}}>01 / Your workspace</div>}
 </div>;
}
export function FeatureCard({config,index,title,description}:{config:MotionConfig;index:number;title:string;description:string}){
 const frame=useCurrentFrame();const {height,width}=useVideoConfig();const portrait=height>width;
 const e=entrance(frame-8-index*9,config.brand,config.template);
 return <div data-motion-safe="card" style={{flex:1,minWidth:0,padding:portrait?32:38,borderRadius:config.template==="typography"?0:config.template==="technology"?10:24,border:config.template==="typography"?"none":`1px solid ${config.brand.foreground}22`,borderTop:config.template==="typography"?`2px solid ${config.brand.accent}`:undefined,background:config.template==="typography"?"transparent":`${config.brand.foreground}06`,opacity:e.opacity,transform:`translate${config.template==="technology"?"X":"Y"}(${e.translate}px) scale(${e.scale})`,display:"flex",flexDirection:"column",gap:22}}>
  <span style={{color:readableColor(config.brand.background,config.brand.accent),fontSize:22,letterSpacing:3}}>0{index+1}</span>
  <div style={{fontSize:portrait?36:34,fontWeight:700,lineHeight:1.15,overflowWrap:"anywhere"}}>{title}</div>
  <div style={{fontSize:portrait?25:24,opacity:.72,lineHeight:1.5,overflowWrap:"anywhere"}}>{description}</div>
 </div>;
}
