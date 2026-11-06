import { z } from "zod";
import { DNAResultSchema, StoryboardSchema, type DNAResult } from "@motion-dna/dna-schema";
export const FPS = 30;
export const DURATION = 450;
export const TEMPLATE_IDS = ["cinematic", "saas", "typography", "technology", "walkthrough"] as const;
export const TEMPLATES = [
  {id:"cinematic",name:"Cinematic product launch",description:"Large titles, restrained reveals and dimensional framing."},
  {id:"saas",name:"Modern SaaS promotion",description:"Bright brand accents, rounded cards and spring entrances."},
  {id:"typography",name:"Minimal typography",description:"Editorial hierarchy, quiet fades and clean compositions."},
  {id:"technology",name:"Dynamic technology showcase",description:"Technical grids, sliding panels and precision motion."},
  {id:"walkthrough",name:"App interface walkthrough",description:"A browser-led tour with numbered feature callouts."},
] as const;
export const FormatSchema = z.enum(["landscape", "portrait"]);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const BrandSchema = z.object({
  background:hex,foreground:hex,accent:hex,
  font:z.enum(["sans","serif","mono"]), fontWeight:z.union([z.literal(400),z.literal(700)]),
  entranceFrames:z.number().int().min(8).max(36), travel:z.number().min(12).max(100), damping:z.number().min(14).max(30),
}).strict();
export const CopySchema = z.object({
  brandName:z.string().trim().min(1).max(32),tagline:z.string().trim().min(1).max(100),
  features:z.array(z.object({title:z.string().trim().min(1).max(40),description:z.string().trim().min(1).max(96)}).strict()).length(3),
  cta:z.string().trim().min(1).max(72),website:z.string().trim().min(1).max(90),
}).strict();
export const VideoDraftSchema = CopySchema.extend({template:z.enum(TEMPLATE_IDS),format:FormatSchema}).strict();
export const MotionConfigSchema = VideoDraftSchema.extend({
  storyboard:StoryboardSchema.optional(),
  brand:BrandSchema,
  screenshot:z.string().max(2800000).refine(value=>value==="sample" || /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value),"Use a local PNG capture"),
  provenance:z.enum(["sample","analysis"]),
}).strict();
export type MotionConfig = z.infer<typeof MotionConfigSchema>;
export type VideoDraft = z.infer<typeof VideoDraftSchema>;
export type Brand = z.infer<typeof BrandSchema>;
export function dimensions(format:MotionConfig["format"]){return format==="portrait"?{width:1080,height:1920}:{width:1920,height:1080};}
export const SCENES = [{id:"intro",name:"Brand introduction",from:0,duration:90},{id:"reveal",name:"Website reveal",from:90,duration:120},{id:"features",name:"Feature showcase",from:210,duration:150},{id:"cta",name:"Final CTA",from:360,duration:90}] as const;
export function sceneForFrame(frame:number){return SCENES.find(s=>frame>=s.from && frame<s.from+s.duration) ?? SCENES[3];}
function luminance(hexColor:string){const rgb=[1,3,5].map(i=>parseInt(hexColor.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return .2126*rgb[0]!+.7152*rgb[1]!+.0722*rgb[2]!;}
export function readableColor(background:string,preferred:string){const a=luminance(background),b=luminance(preferred);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5?preferred:a>.179?"#101216":"#f8fafc";}
export function normalizeDNA(input:unknown):Brand {
  const dna=DNAResultSchema.parse(input);
  const color=(role:DNAResult["palette"][number]["role"],fallback:string)=>[...dna.palette].filter(c=>c.role===role).sort((a,b)=>b.frequency-a.frequency)[0]?.value ?? fallback;
  const background=color("background","#101216"),accent=color("primary",color("accent","#2563eb"));
  const fonts=[...dna.typography.fonts].sort((a,b)=>b.count-a.count);
  const family=fonts[0]?.family.toLowerCase() ?? "sans-serif";
  const font= /mono|courier|consolas|code/.test(family)?"mono": /georgia|times|lora|playfair|garamond|(?<!sans-)serif/.test(family)?"serif":"sans";
  const duration=dna.motion.flatMap(m=>[m.transition_duration,m.animation_duration]).flatMap(s=>s.split(",")).map(s=>parseFloat(s)*(s.trim().endsWith("ms")?.001:1)).filter(n=>Number.isFinite(n)&&n>0)[0] ?? .6;
  return BrandSchema.parse({background,foreground:readableColor(background,color("text","#f8fafc")),accent,font,fontWeight:Number(fonts[0]?.weight ?? 700)>=600?700:400,entranceFrames:Math.round(Math.max(8,Math.min(36,duration*FPS))),travel:dna.motion.some(m=>m.transform!=="none")?64:28,damping:dna.motion.some(m=>m.timing.includes("linear"))?28:18});
}

export function compositionScenes(config:MotionConfig){
 if(!config.storyboard)return SCENES.map(scene=>({...scene,kind:scene.id}));
 let start=0;return config.storyboard.scenes.map(scene=>{const entry={id:scene.id,kind:scene.kind,name:scene.headline,from:start,duration:scene.duration_frames};start+=scene.duration_frames;return entry;});
}
export function durationFor(config:MotionConfig){return config.storyboard?.total_frames ?? DURATION;}
