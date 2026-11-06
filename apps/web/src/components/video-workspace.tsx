"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { DNAJobSchema, DNAResultSchema } from "@motion-dna/dna-schema";
import { ExportComposition, DURATION, MotionConfigSchema, normalizeDNA, compositionScenes, SCENES, TEMPLATES, VideoDraftSchema, type Brand, type VideoDraft } from "@motion-dna/motion-engine";
import { sampleConfig, sampleDraft, sampleDNA } from "@motion-dna/motion-engine/sample";
import { renderMetadata, type OutputSettings } from "@motion-dna/motion-engine/render-request";
import { RenderSettings, RenderJobStatus } from "./render-settings";
import { useRenderJob, activeRender, SAMPLE_RENDER_PROJECT_ID } from "./use-render-job";
import { Button } from "./ui/button";
import { useWorkspace, type Project } from "@/lib/workspace";
import { ArrowLeft, Download, Film, LoaderCircle, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import "./video-workspace.css";
async function json(response:Response){const data:unknown=await response.json();if(!response.ok)throw new Error((data as {error?:{message?:string}}).error?.message || "The local service is unavailable.");return data;}
async function pngData(response:Response){if(!response.ok)throw new Error("The saved screenshot is unavailable. Run website analysis again.");const blob=await response.blob();if(blob.size>2*1024*1024)throw new Error("Capture exceeds the 2 MB limit.");return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Capture could not be read."));reader.readAsDataURL(blob);});}
export function VideoWorkspace(){
 const {projects,activeProjectId,hydrated}=useWorkspace();const search=useSearchParams();const id=search.get("project");const project=id?projects.find(item=>item.id===id):projects.find(item=>item.id===activeProjectId);
 if(!hydrated)return <p role="status">Loading local video settings…</p>;
 return <Generator key={project?.id || "sample"} project={project}/>;
}
function Generator({project}:{project?:Project}){
 const {updateProject,storageError}=useWorkspace();
 const [draft,setDraft]=useState<VideoDraft>(()=>({...project?.videoDraft || sampleDraft,...(project?{brandName:project.name.slice(0,32),website:project.sourceType==="url"?new URL(project.source).hostname:"your-website.example"}:{}),...(project?.storyboard?{format:project.storyboard.brief.aspect_ratio,template:project.storyboard.brief.motion_style}:{})}));
 const [source,setSource]=useState<"sample"|"analysis">(project?.dnaJobId?"analysis":"sample");
 const [brand,setBrand]=useState<Brand>(sampleConfig.brand);const [screenshot,setScreenshot]=useState("sample");
 const [loading,setLoading]=useState(Boolean(project?.dnaJobId));const [sourceError,setSourceError]=useState<string|null>(null);const [retry,setRetry]=useState(0);
 const [frame,setFrame]=useState(0);const player=useRef<PlayerRef>(null);
 const [output,setOutput]=useState<OutputSettings>(()=>({quality:"1080p",aspect_ratio:draft.format==="portrait"?"9:16":"16:9",fps:30}));
 const renderJob=useRenderJob(project?.id??SAMPLE_RENDER_PROJECT_ID,project?.name??"Atlas sample");
 const {job}=renderJob;
 const [formError,setFormError]=useState<string|null>(null);
 const story=project?.storyboard?.analysis_id===(source==="sample"?sampleDNA.analysis_id:project?.dnaJobId)?project?.storyboard:undefined;
 const config=useMemo(()=>MotionConfigSchema.safeParse({...draft,brand,screenshot,provenance:source,...(story?{storyboard:story}:{})}),[draft,brand,screenshot,source,story]);
 const sourceFrames=story?.total_frames ?? DURATION;
 const previewRequest=useMemo(()=>({project_id:project?.id??SAMPLE_RENDER_PROJECT_ID,project_name:project?.name??"Atlas sample",idempotency_key:"preview-configuration",input:config.success?config.data:sampleConfig,output}),[project?.id,project?.name,config,output]);
 const metadata=renderMetadata(previewRequest);
 const totalFrames=metadata.durationInFrames;
 const timeline=(config.success?compositionScenes(config.data):SCENES).map(scene=>({...scene,from:Math.round(scene.from*output.fps/30),duration:Math.round(scene.duration*output.fps/30)}));
 const activeScene=timeline.find(scene=>frame>=scene.from&&frame<scene.from+scene.duration) ?? timeline[timeline.length-1]!;
 const size={width:metadata.width,height:metadata.height};
 const previewKey=`${draft.format}-${source}-${output.quality}-${output.aspect_ratio}-${output.fps}`;
 useEffect(()=>{
  const controller=new AbortController();let cancelled=false;
  async function load(){
   setLoading(true);setSourceError(null);
   try{
    if(source==="sample"){setBrand(sampleConfig.brand);setScreenshot("sample");return;}
    if(!project?.dnaJobId)throw new Error("Analyze this website first, or choose the labeled sample fixture.");
    const options={signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),cache:"no-store" as const};
    const analysisJob=DNAJobSchema.parse(await json(await fetch(`/api/dna/jobs/${project.dnaJobId}`,options)));
    if(analysisJob.status!=="completed"||!analysisJob.analysis_id)throw new Error("Website analysis is not complete. Open DNA analysis to finish the capture.");
    const dna=DNAResultSchema.parse(await json(await fetch(`/api/dna/results/${analysisJob.analysis_id}`,options)));
    const capture=dna.screenshots.find(item=>item.kind==="viewport");if(!capture)throw new Error("The analysis has no screenshot. Run capture again.");
    const image=await pngData(await fetch(capture.path,options));
    if(!cancelled){setBrand(normalizeDNA(dna));setScreenshot(image);}
   }catch(error){if(!cancelled)setSourceError(error instanceof Error?error.message:"DNA could not be loaded.");}
   finally{if(!cancelled)setLoading(false);}
  }
  void load();return()=>{cancelled=true;controller.abort();};
 },[source,project?.dnaJobId,retry]);

 function edit(patch:Partial<VideoDraft>){const next={...draft,...patch};setDraft(next);player.current?.pause();const parsed=VideoDraftSchema.safeParse(next);setFormError(parsed.success?null:"Complete every field. Exactly three feature highlights are required.");if(parsed.success&&project)updateProject(project.id,{videoDraft:parsed.data});}
 function seek(target:number){const next=Math.max(0,Math.min(totalFrames-1,target));player.current?.pause();player.current?.seekTo(next);setFrame(next);}
 async function render(){if(!config.success||loading||sourceError)return;await renderJob.submit(config.data,output,Boolean(job&&!activeRender(job.status)));}
 const busy=renderJob.busy;
 const valid=config.success&&!loading&&!sourceError;
 return <div className="video-page">
  <div className="page-heading"><div><p className="page-kicker">FROM BRAND DNA TO MOVING PICTURE</p><h1>DNA video studio</h1><p className="muted">Four scenes. Source-backed stories. Made from your visual identity.</p></div><Button asChild variant="outline"><Link href={project?`/studio?project=${project.id}`:"/studio"}><ArrowLeft size={15}/>Manual editor</Link></Button></div>
  {project&&<p className="video-footnote"><Link href={`/director?project=${project.id}`}>Open AI Director →</Link>{story&&` · ${story.generation.model} · ${story.edited?"Edited storyboard":"Generated storyboard"}`}</p>}
  <div className="video-layout"><aside className="panel video-templates"><span className="video-eyebrow">01 / CHOOSE A DIRECTION</span>{TEMPLATES.map(template=><button key={template.id} type="button" aria-pressed={draft.template===template.id} className={draft.template===template.id?"video-template selected":"video-template"} onClick={()=>edit({template:template.id})}><span className={`video-template-art ${template.id}`}><span>Aa</span><i/><i/></span><strong>{template.name}</strong><small>{template.description}</small></button>)}</aside>
  <main className="video-preview-column"><section className="panel video-player-panel"><div className="video-toolbar"><span><Film size={15}/>MotionDNA · {draft.brandName || "Untitled"}</span><label><span className="sr-only">Video resolution</span><select aria-label="Video resolution" value={draft.format} onChange={event=>{edit({format:event.target.value as VideoDraft["format"]});setOutput(value=>({...value,aspect_ratio:event.target.value==="portrait"?"9:16":"16:9"}));seek(0);}}><option value="landscape">1920 × 1080</option><option value="portrait">1080 × 1920</option></select></label></div>
   <div className={`video-stage ${output.aspect_ratio==="9:16"?"portrait":"landscape"}`}>
    {loading?<p role="status"><LoaderCircle className="spinning"/>Loading captured DNA and screenshot…</p>:sourceError?<div role="alert"><p>{sourceError}</p><Button variant="outline" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={14}/>Retry capture load</Button></div>:config.success?<Player key={previewKey} ref={player} component={ExportComposition} inputProps={{request:previewRequest}} durationInFrames={totalFrames} compositionWidth={size.width} compositionHeight={size.height} fps={output.fps} controls loop={false} autoPlay={false} clickToPlay style={{width:"100%",maxHeight:630,aspectRatio:`${size.width}/${size.height}`}} acknowledgeRemotionLicense/>:<p role="status">Complete the text fields to preview your video.</p>}
   </div>
   <div className="video-frame-controls"><Button size="icon" variant="ghost" aria-label="Previous frame" disabled={!valid||frame===0} onClick={()=>seek(frame-1)}><SkipBack size={15}/></Button><label>Frame <input aria-label="Video frame" disabled={!valid} type="number" min={0} max={totalFrames-1} value={frame} onChange={event=>{const value=Number(event.target.value);if(Number.isInteger(value))seek(value);}}/> / {totalFrames-1}</label><Button size="icon" variant="ghost" aria-label="Next frame" disabled={!valid||frame===totalFrames-1} onClick={()=>seek(frame+1)}><SkipForward size={15}/></Button><span>{output.fps} FPS · {sourceFrames/30}s</span></div>
   <FrameTracker key={previewKey} player={player} onFrame={setFrame} enabled={valid}/>
  </section>
  <section className="panel video-timeline" aria-label="Generated scene timeline"><div className="video-eyebrow">02 / THE STORY · {activeScene.name}</div><div>{timeline.map(scene=><button type="button" key={scene.id} className={activeScene.id===scene.id?"active":""} style={{flex:scene.duration}} onClick={()=>seek(scene.from)} disabled={!valid}><strong>{scene.name}</strong><span>{scene.from}–{scene.from+scene.duration-1}f</span></button>)}</div><input type="range" aria-label="Video timeline frame" min={0} max={totalFrames-1} step={1} value={frame} onChange={event=>seek(Number(event.target.value))} disabled={!valid}/></section>
  <section className="panel video-export"><div><h2>Ready for the final frame?</h2><p>Local H.264 MP4 · {size.width} × {size.height} · {totalFrames} frames</p></div><Button onClick={()=>void render()} disabled={!valid||busy}>{busy?<LoaderCircle size={15} className="spinning"/>:<Download size={15}/>} {busy?"Rendering locally…":"Render MP4"}</Button>
   <RenderSettings value={output} onChange={next=>{player.current?.pause();setOutput(next);setFrame(0);}} disabled={renderJob.submitting}/>
   <RenderJobStatus job={job} error={renderJob.error} action={renderJob.action} onCancel={()=>void renderJob.cancel()} onRetry={()=>void renderJob.retry()} downloadLabel="Download finished MP4"/>
  </section><p className="video-footnote">{source==="sample"?"Authored Atlas sample DNA and screenshot. These are not extracted from your project.":"Uses the saved website capture. Font declarations map to bundled Inter, Lora or IBM Plex Mono for reproducible output."} Animated brand marks are generated monograms. CSS observations guide motion; JavaScript animations are not reconstructed.</p>
  </main>
  <aside className="panel video-properties"><span className="video-eyebrow">03 / MAKE IT YOURS</span><label className="video-field">DNA source<select aria-label="Video DNA source" value={source} onChange={event=>setSource(event.target.value as "sample"|"analysis")}><option value="sample">Atlas sample fixture</option><option value="analysis" disabled={!project?.dnaJobId}>Project website analysis{!project?.dnaJobId?" — analyze first":""}</option></select></label>{project&&<Link className="video-analysis-link" href={`/analysis?project=${project.id}`}>Open DNA analysis ↗</Link>}
   <div className="video-dna-summary"><span style={{background:brand.background}}/><span style={{background:brand.foreground}}/><span style={{background:brand.accent}}/><p>{brand.font} · {brand.fontWeight} weight<br/>{brand.entranceFrames}-frame entrance · {brand.travel}px travel</p></div>
   <label className="video-field">Brand name<input aria-label="Video brand name" value={draft.brandName} maxLength={32} onChange={event=>edit({brandName:event.target.value})}/></label><label className="video-field">Brand promise<textarea aria-label="Video tagline" value={draft.tagline} maxLength={100} rows={3} onChange={event=>edit({tagline:event.target.value})}/></label>
   {draft.features.map((feature,index)=><fieldset key={index}><legend>Feature 0{index+1}</legend><label className="video-field"><span className="sr-only">Feature {index+1} title</span><input aria-label={`Feature ${index+1} title`} value={feature.title} maxLength={40} onChange={event=>edit({features:draft.features.map((value,i)=>i===index?{...value,title:event.target.value}:value)})}/></label><label className="video-field"><span className="sr-only">Feature {index+1} description</span><textarea aria-label={`Feature ${index+1} description`} rows={3} value={feature.description} maxLength={96} onChange={event=>edit({features:draft.features.map((value,i)=>i===index?{...value,description:event.target.value}:value)})}/></label></fieldset>)}
   <label className="video-field">Call to action<textarea aria-label="Video CTA" rows={3} value={draft.cta} maxLength={72} onChange={event=>edit({cta:event.target.value})}/></label><label className="video-field">Website address<input aria-label="Video website" value={draft.website} maxLength={90} onChange={event=>edit({website:event.target.value})}/></label>
   {(formError||storageError)&&<p role="alert">{formError||storageError}</p>}<small>{project?"Valid text edits save with this local draft.":"Sample edits last for this visit. Create a project to save a video draft."}</small>
  </aside></div>
 </div>;
}
function FrameTracker({player,onFrame,enabled}:{player:React.RefObject<PlayerRef|null>;onFrame:(frame:number)=>void;enabled:boolean}){
 useEffect(()=>{const instance=player.current;if(!instance)return;const update=({detail}:{detail:{frame:number}})=>onFrame(detail.frame);instance.addEventListener("frameupdate",update);return()=>instance.removeEventListener("frameupdate",update);},[player,onFrame,enabled]);return null;
}
