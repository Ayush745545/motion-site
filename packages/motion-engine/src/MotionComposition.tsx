import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { AnimatedText, BrandLogo, FeatureCard, MotionScene, TransitionController, WebsiteReveal } from "./components";
import { FONT_NAMES, useCompositionFont } from "./fonts";
import { MotionConfigSchema, compositionScenes, readableColor, type MotionConfig } from "./schema";
function Background({config}:{config:MotionConfig}){
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:config.brand.background}}>
 {config.template!=="typography" && <AbsoluteFill style={{background:config.template==="technology"?`linear-gradient(${config.brand.foreground}08 1px,transparent 1px),linear-gradient(90deg,${config.brand.foreground}08 1px,transparent 1px)`:`radial-gradient(ellipse at 80% 20%, ${config.brand.accent}20, transparent 60%)`,backgroundSize:config.template==="technology"?"64px 64px":"auto"}}/>}
 {config.template==="cinematic" && <div style={{position:"absolute",width:760,height:760,border:`1px solid ${config.brand.accent}30`,borderRadius:"50%",right:-160,top:-220,transform:`translateY(${Math.sin(frame/150)*24}px)`}}/>}
 </AbsoluteFill>;
}
function Intro({config}:{config:MotionConfig}){
 const {width,height}=useVideoConfig();const portrait=height>width;const left=config.template==="typography"||config.template==="walkthrough";
 return <MotionScene config={config} label="01 / Introduction"><div style={{display:"flex",flexDirection:"column",alignItems:left?"flex-start":"center",textAlign:left?"left":"center",gap:32}}><BrandLogo config={config} size={portrait?116:96}/><AnimatedText config={config} delay={5} size={Math.min(portrait?130:174,(portrait?2200:3800)/config.brandName.length)} style={{letterSpacing:config.template==="technology"?3:-3,maxWidth:"100%"}}>{config.brandName}</AnimatedText><AnimatedText config={config} delay={12} size={portrait?38:40} style={{maxWidth:portrait?850:1150,opacity:undefined}}>{config.tagline}</AnimatedText><div style={{height:3,width:90,background:config.brand.accent,marginTop:12}}/></div></MotionScene>;
}
function Reveal({config,headline}:{config:MotionConfig;headline?:string}){
 const portrait=useVideoConfig().height>useVideoConfig().width;
 return <MotionScene config={config} label="02 / The experience"><AnimatedText config={config} size={portrait?64:64} style={{textAlign:config.template==="typography"?"left":"center",letterSpacing:-2}}>{headline || "A new perspective."}</AnimatedText><WebsiteReveal config={config}/><AnimatedText config={config} delay={15} size={portrait?30:26} style={{textAlign:"center",opacity:.75}}>{config.template==="walkthrough"?"One place. Everything in view.":config.tagline}</AnimatedText></MotionScene>;
}
function Features({config,headline}:{config:MotionConfig;headline?:string}){
 const portrait=useVideoConfig().height>useVideoConfig().width;
 return <MotionScene config={config} label="03 / Made for you"><AnimatedText config={config} size={portrait?72:82} style={{letterSpacing:-2,marginBottom:portrait?20:35}}>{headline || <>Small details.<br/>Extraordinary possibilities.</>}</AnimatedText><div style={{display:"flex",flexDirection:portrait?"column":"row",gap:24}}>{config.features.map((feature,index)=><FeatureCard key={index} config={config} index={index} {...feature}/>)}</div></MotionScene>;
}
function CTA({config}:{config:MotionConfig}){
 const portrait=useVideoConfig().height>useVideoConfig().width;
 return <MotionScene config={config} label="04 / Your next move"><div style={{display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",gap:32}}><BrandLogo config={config} size={80}/><AnimatedText config={config} delay={4} size={Math.min(portrait?96:110,(portrait?3800:6000)/config.cta.length)} style={{maxWidth:portrait?880:1500,letterSpacing:-2}}>{config.cta}</AnimatedText><AnimatedText config={config} delay={12} size={30} style={{color:readableColor(config.brand.accent,"#ffffff"),background:config.brand.accent,padding:"22px 34px",borderRadius:config.template==="technology"?4:18,maxWidth:"100%"}}>{config.website} ↗</AnimatedText><AnimatedText config={config} delay={15} size={24} style={{letterSpacing:4,textTransform:"uppercase"}}>{config.brandName}</AnimatedText></div></MotionScene>;
}
function CompositionBody({config}:{config:MotionConfig}){
 useCompositionFont(config.brand);
 const scenes={intro:Intro,reveal:Reveal,features:Features,cta:CTA};
 const timeline=compositionScenes(config);
 return <AbsoluteFill className="motion-composition" style={{color:config.brand.foreground,fontFamily:FONT_NAMES[config.brand.font],fontWeight:config.brand.fontWeight,overflow:"hidden",fontStyle:"normal",textRendering:"geometricPrecision"}}><style>{`.motion-composition, .motion-composition * {box-sizing:border-box;}`}</style><Background config={config}/>{timeline.map((scene,index)=>{
 const Content=scenes[scene.kind];const directed=config.storyboard?.scenes[index];
 const presets={fade:"typography",slide:"technology",spring:"saas",parallax:"cinematic"} as const;
 const sceneConfig=directed?{...config,template:presets[directed.motion_preset],tagline:directed.kind==="intro"?directed.headline:directed.description,cta:directed.headline.slice(0,72),features:[0,1,2].map(i=>({title:directed.supporting_copy[i]?.slice(0,40)||"Website detail",description:directed.supporting_copy[i]?.slice(0,96)||"Review the captured source material."}))}:config;
 return <Sequence key={scene.id} from={scene.from} durationInFrames={scene.duration}><TransitionController duration={scene.duration} last={index===3} config={config} transition={directed?.transition}><Content config={sceneConfig} headline={directed?.headline}/>{directed&&<div style={{position:"absolute",bottom:95,left:90,right:90,fontSize:18,textAlign:"center",opacity:.65,overflowWrap:"anywhere"}}>{directed.description}</div>}</TransitionController></Sequence>;
 })}</AbsoluteFill>;
}
export function MotionComposition({config}:{config:MotionConfig}){const parsed=MotionConfigSchema.parse(config);return <CompositionBody key={`${parsed.brand.font}-${parsed.brand.fontWeight}`} config={parsed}/>;}
