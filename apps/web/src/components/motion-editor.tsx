"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { ExportComposition } from "@motion-dna/motion-engine";
import { renderMetadata, type OutputSettings } from "@motion-dna/motion-engine/render-request";
import { ProjectDocumentSchema, TimelineAssetSchema, sceneTimeline, totalFrames, type ProjectDocument, type TimelineLayer, type TimelineScene } from "@motion-dna/motion-engine/project";
import { ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp, Clapperboard, Copy, Download, Film, Folder, Image as ImageIcon, Layers3, LoaderCircle, Pause, Play, Plus, Redo2, Save, SkipBack, SkipForward, Trash2, Type, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { RESOLUTIONS, type Project, type Scene } from "@/lib/project-schema";
import { useTimelineProject } from "@/lib/timeline-state";
import { clampLayerTiming, duplicateScene, moveScene, resizeScene } from "./timeline-editor-model";
import { TimelineInspector, NumberField } from "./timeline-inspector";
import { TimelineTracks } from "./timeline-tracks";
import { RenderSettings, RenderJobStatus } from "./render-settings";
import { useRenderJob, activeRender } from "./use-render-job";
import "./editor.css";
import "./timeline-editor.css";

/** Retained for consumers of the old seconds-based draft timeline. */
export function sceneAtTime(scenes: Scene[], time: number) {
  let start = 0;
  for (const [index, scene] of scenes.entries()) {
    if (time < start + scene.duration || index === scenes.length - 1) return { scene, index, start, progress: Math.max(0, Math.min(1, (time - start) / scene.duration)) };
    start += scene.duration;
  }
  return null;
}

function timecode(frame: number, fps: number) {
  const seconds = Math.floor(frame / fps);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frame % fps).padStart(2, "0")}`;
}

export function EditorEmpty({ missing = false }: { missing?: boolean }) {
  return <section className="editor-empty panel"><span className="editor-empty-icon"><Clapperboard size={30}/></span><p className="page-kicker">YOUR NEXT STORY STARTS HERE</p><h1>{missing ? "This project isn't in your account." : "A canvas for your next big idea."}</h1><p>{missing ? "Open a saved project from the dashboard, or create a new one." : "Create a project to arrange scenes, shape your typography, and preview your motion. Your work saves to your local account."}</p><Button asChild><Link href="/create"><Plus size={16}/>Create project</Link></Button><Link href="/" className="editor-back-link"><ArrowLeft size={14}/>Back to dashboard</Link></section>;
}

export function MotionEditor() {
  const { projects, activeProjectId, hydrated, selectProject } = useWorkspace();
  const requested = useSearchParams().get("project");
  const project = requested ? projects.find(entry => entry.id === requested) : projects.find(entry => entry.id === activeProjectId) ?? projects[0];
  useEffect(() => { if (project && project.id !== activeProjectId) selectProject(project.id); }, [project, activeProjectId, selectProject]);
  if (!hydrated) return <div className="editor-loading" role="status">Opening your local studio…<div/></div>;
  if (!project) return <EditorEmpty missing={Boolean(requested)}/>;
  return <EditorWorkspace key={project.id} project={project}/>;
}

function EditorWorkspace({ project }: { project: Project }) {
  const { projects, saving, storageError, flushStorage, user } = useWorkspace();
  const { document, commitDocument, endHistoryGroup, undo, redo, canUndo, canRedo } = useTimelineProject(project);
  const [selectedSceneId, setSelectedSceneId] = useState(project.activeSceneId);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [frame, setFrame] = useState(Math.min(24, totalFrames(document) - 1));
  const [playing, setPlaying] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [timelineZoom, setTimelineZoom] = useState(100);
  const [library, setLibrary] = useState<"layers" | "assets" | "projects">("layers");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [output, setOutput] = useState<OutputSettings>(() => ({ quality: "1080p", aspect_ratio: document.composition.height > document.composition.width ? "9:16" : "16:9", fps: document.composition.fps }));
  const render = useRenderJob(project.id, project.name);
  const { job } = render;
  const player = useRef<PlayerRef>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const timeline = useMemo(() => sceneTimeline(document), [document]);
  const total = totalFrames(document);
  const currentFrame = Math.max(0, Math.min(total - 1, frame));
  const active = document.scenes.find(scene => scene.id === selectedSceneId) ?? document.scenes[0]!;
  const sceneIndex = document.scenes.findIndex(scene => scene.id === active.id);
  const activeEntry = timeline.find(scene => scene.id === active.id)!;
  const sceneLayers = document.layers.filter(layer => layer.sceneId === active.id);
  const layer = sceneLayers.find(item => item.id === selectedLayerId) ?? sceneLayers[0];
  const previewRequest = useMemo(() => ({ project_id: project.id, project_name: project.name, idempotency_key: "preview-configuration", input: { document }, output }), [project.id, project.name, document, output]);
  const metadata = renderMetadata(previewRequest);
  const compositionKey = `${document.composition.width}-${document.composition.height}-${document.composition.fps}-${output.quality}-${output.aspect_ratio}-${output.fps}-${previewRevision}`;
  const inputProps = useMemo(() => ({ request: previewRequest }), [previewRequest]);

  const seek = useCallback((target: number) => {
    const next = Math.max(0, Math.min(total - 1, Math.round(target)));
    player.current?.pause();
    player.current?.seekTo(Math.min(metadata.durationInFrames - 1, Math.round(next * output.fps / document.composition.fps)));
    setPlaying(false);
    setFrame(next);
  }, [total, metadata.durationInFrames, output.fps, document.composition.fps]);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const update = ({ detail }: { detail: { frame: number } }) => setFrame(Math.min(total - 1, Math.floor(detail.frame * document.composition.fps / output.fps)));
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    instance.addEventListener("frameupdate", update);
    instance.addEventListener("play", play);
    instance.addEventListener("pause", pause);
    instance.addEventListener("ended", pause);
    return () => { instance.removeEventListener("frameupdate", update); instance.removeEventListener("play", play); instance.removeEventListener("pause", pause); instance.removeEventListener("ended", pause); };
  }, [compositionKey, document.composition.fps, output.fps, total]);

  useEffect(() => {
    if (frame >= total) player.current?.seekTo(metadata.durationInFrames - 1);
  }, [frame, total, metadata.durationInFrames]);

  const togglePlayback = useCallback(() => {
    const instance = player.current;
    if (!instance) return;
    if (instance.isPlaying()) instance.pause();
    else { if (instance.getCurrentFrame() >= metadata.durationInFrames - 1) instance.seekTo(0); instance.play(); }
  }, [metadata.durationInFrames]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        player.current?.pause();
        endHistoryGroup();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, button, a, [contenteditable=true]")) return;
      if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") { event.preventDefault(); seek(currentFrame + (event.code === "ArrowLeft" ? -1 : 1)); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [currentFrame, endHistoryGroup, redo, seek, togglePlayback, undo]);


  function commit(next: ProjectDocument, group?: string) {
    const result = ProjectDocumentSchema.safeParse(next);
    if (!result.success) { setError(result.error.issues[0]?.message ?? "This change is outside the project limits."); return; }
    player.current?.pause();
    setError(null);
    commitDocument(result.data, group);
  }
  function chooseScene(id: string) {
    const entry = timeline.find(scene => scene.id === id);
    if (!entry) return;
    endHistoryGroup();
    setSelectedSceneId(id);
    setSelectedLayerId(document.layers.find(item => item.sceneId === id)?.id ?? null);
    seek(entry.from + Math.min(24, entry.durationInFrames - 1));
  }
  function chooseLayer(next: TimelineLayer) {
    setSelectedSceneId(next.sceneId);
    setSelectedLayerId(next.id);
    endHistoryGroup();
    const entry = timeline.find(scene => scene.id === next.sceneId);
    if (entry) seek(entry.from + next.from + Math.min(next.animation.durationInFrames, next.durationInFrames - 1));
  }
  function editLayer(next: TimelineLayer, group?: string) {
    const parent = document.scenes.find(scene => scene.id === next.sceneId);
    if (!parent) return;
    const clamped = clampLayerTiming(next, parent.durationInFrames);
    commit({ ...document, layers: document.layers.map(item => item.id === next.id ? clamped : item) }, group);
  }
  function editScene(next: TimelineScene, group?: string) {
    commit({ ...document, scenes: document.scenes.map(scene => scene.id === next.id ? next : scene) }, group);
  }
  function changeDuration(frames: number) {
    try { commit(resizeScene(document, active.id, frames), `scene-duration-${active.id}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "The scene could not be resized."); }
  }
  function addText() {
    if (document.layers.length >= 100) return;
    const id = crypto.randomUUID();
    const next: TimelineLayer = { id, sceneId: active.id, name: "Text layer", type: "text", text: "Your next idea.", from: 0, durationInFrames: active.durationInFrames, x: document.composition.width * .1, y: document.composition.height * .4, width: document.composition.width * .8, height: document.composition.height * .2, scale: 1, rotation: 0, opacity: 1, fontFamily: "sans", fontSize: 68, fontWeight: 700, color: "#F5F5F5", align: "center", animation: { preset: "none", durationInFrames: 0 }, keyframes: [] };
    endHistoryGroup();
    commit({ ...document, layers: [...document.layers, next] });
    setSelectedLayerId(id);
    seek(activeEntry.from);
  }
  function addScene(copy = false) {
    if (document.scenes.length >= 12) return;
    endHistoryGroup();
    if (copy) {
      try { const result = duplicateScene(document, active.id); commit(result.document); setSelectedSceneId(result.sceneId); setSelectedLayerId(null); } catch { setError("This scene would exceed the project’s 100-layer limit."); }
      return;
    }
    const scene: TimelineScene = { id: crypto.randomUUID(), name: `Scene ${document.scenes.length + 1}`, durationInFrames: document.composition.fps * 4, background: active.background, transition: { preset: "cut", durationInFrames: 0 } };
    commit({ ...document, scenes: [...document.scenes, scene] });
    setSelectedSceneId(scene.id);
    setSelectedLayerId(null);
    seek(total);
  }
  function deleteScene() {
    if (document.scenes.length <= 1) return;
    endHistoryGroup();
    const scenes = document.scenes.filter(scene => scene.id !== active.id);
    const next = scenes[Math.min(sceneIndex, scenes.length - 1)]!;
    commit({ ...document, scenes, layers: document.layers.filter(item => item.sceneId !== active.id) });
    setSelectedSceneId(next.id);
    setSelectedLayerId(null);
    seek(0);
  }
  function reorderScene(id: string, target: number) {
    endHistoryGroup();
    const next = moveScene(document, id, target);
    commit(next);
    setSelectedSceneId(id);
    setSelectedLayerId(next.layers.find(item => item.sceneId === id)?.id ?? null);
    const entry = sceneTimeline(next).find(scene => scene.id === id);
    if (entry) seek(entry.from + Math.min(24, entry.durationInFrames - 1));
  }
  function resizeComposition(value: string) {
    const [width, height] = value.split("x").map(Number);
    if (!width || !height) return;
    const xRatio = width / document.composition.width, yRatio = height / document.composition.height;
    commit({ ...document, composition: { ...document.composition, width, height }, layers: document.layers.map(item => ({ ...item, x: item.x * xRatio, y: item.y * yRatio, width: Math.max(8, item.width * xRatio), height: Math.max(8, item.height * yRatio), keyframes: item.keyframes.map(keyframe => ({ ...keyframe, value: keyframe.property === "x" ? keyframe.value * xRatio : keyframe.property === "y" ? keyframe.value * yRatio : keyframe.value })) })) });
  }
  async function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true); setError(null);
    try {
      if (!/^(image\/png|image\/jpeg|image\/webp)$/.test(file.type) || file.size > 2 * 1024 * 1024) throw new Error("Choose a PNG, JPEG, or WebP image up to 2 MB.");
      const src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("The image could not be read.")); reader.readAsDataURL(file); });
      const asset = TimelineAssetSchema.parse({ id: crypto.randomUUID(), name: file.name.slice(0, 255), src });
      if (document.assets.reduce((sum, entry) => sum + entry.src.length, 0) + src.length > 2_800_000) throw new Error("This project has a 2.8 MB encoded image budget. Use a smaller image.");
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new window.Image(); image.onload = () => image.naturalWidth > 4096 || image.naturalHeight > 4096 ? reject(new Error("Use images no larger than 4096 × 4096.")) : resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("This file is not a readable raster image.")); image.src = src; });
      const width = Math.min(document.composition.width * .65, size.width);
      const height = Math.min(document.composition.height * .7, width * size.height / size.width);
      const actualWidth = height * size.width / size.height;
      if (!user) throw new Error("Sign in before uploading a private project image.");
      const uploaded = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assets`, {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": file.name },
        body: await file.arrayBuffer(),
        cache: "no-store",
      });
      if (!uploaded.ok) {
        const response = await uploaded.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(response?.error?.message ?? "The private asset could not be uploaded.");
      }
      const stored = await uploaded.json() as { asset: { id: string } };
      const linkedAsset = TimelineAssetSchema.parse({ ...asset, storageAssetId: stored.asset.id });
      const next: TimelineLayer = { id: crypto.randomUUID(), sceneId: active.id, name: file.name.slice(0, 100), type: "image", assetId: asset.id, fit: "contain", from: 0, durationInFrames: active.durationInFrames, x: (document.composition.width - actualWidth) / 2, y: (document.composition.height - height) / 2, width: Math.max(8, actualWidth), height: Math.max(8, height), scale: 1, rotation: 0, opacity: 1, animation: { preset: "none", durationInFrames: 0 }, keyframes: [] };
      endHistoryGroup(); commit({ ...document, assets: [...document.assets, linkedAsset], layers: [...document.layers, next] }); setSelectedLayerId(next.id); setLibrary("assets"); seek(activeEntry.from);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The image could not be imported."); } finally { setImporting(false); }
  }
  async function exportVideo() {
    try { await flushStorage(); }
    catch { setError("The project could not be saved before export. Check the save message, then retry."); return; }
    await render.submit({ document }, output, Boolean(job && !activeRender(job.status)));
  }
  const renderBusy = render.busy;
  const hasRoomForImage = document.layers.length < 100 && document.assets.length < 20;
  const saveLabel = storageError ? "Changes need attention" : saving ? "Saving…" : "Saved to your account";

  return <div className="editor-page timeline-editor">
    <div className="editor-page-heading"><div><p className="page-kicker">YOUR FRAME. YOUR STORY.</p><h1>Motion studio<span className="editor-beta">TIMELINE</span></h1></div><div className="editor-heading-actions"><span className={`editor-save-note ${storageError ? "editor-unsaved" : ""}`}>{storageError ? <CircleHelp size={14}/> : saving ? <LoaderCircle size={14} className="spinning"/> : <Check size={14}/>}<span role="status">{saveLabel}</span></span><Button variant="outline" size="sm" onClick={() => void flushStorage()} title="Save this project to your account"><Save size={14}/>Save now</Button><Button onClick={() => void exportVideo()} disabled={renderBusy}>{renderBusy ? <LoaderCircle size={15} className="spinning"/> : <Download size={15}/>}Export MP4</Button></div></div>
    <p className="editor-render-note">Arrange scenes, animate individual layers, and export the same frame-accurate composition you preview here.</p>
    {error && <div className="timeline-alert" role="alert">{error}<Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button></div>}
    <section className="timeline-workbench" aria-label="Motion editor" data-playing={playing}>
      <aside className="timeline-library" aria-label="Studio library">
        <div className="timeline-library-tabs" aria-label="Studio library view">{([{ id: "layers", icon: Layers3, label: "Layers" }, { id: "assets", icon: ImageIcon, label: "Assets" }, { id: "projects", icon: Folder, label: "Projects" }] as const).map(({ id, icon: Icon, label }) => <button type="button" key={id} aria-pressed={library === id} onClick={() => setLibrary(id)}><Icon size={15}/><span>{label}</span></button>)}</div>
        <div className="timeline-library-content">{library === "projects" ? <><p className="timeline-eyebrow">YOUR PROJECTS</p>{projects.map(draft => <Link href={`/studio?project=${draft.id}`} key={draft.id} className={`timeline-project-link ${draft.id === project.id ? "selected" : ""}`}><Film size={15}/><span>{draft.name}</span></Link>)}<Link href="/create" className="timeline-inline-link"><Plus size={13}/>New project</Link></> : library === "assets" ? <><p className="timeline-eyebrow">PROJECT IMAGES · {document.assets.length}/20</p>{document.assets.length ? document.assets.map(asset => <div key={asset.id} className="timeline-asset"><span role="img" aria-label={asset.name} style={{ backgroundImage: `url(${asset.src})` }}/><span>{asset.name}{asset.storageAssetId&&<small>Private copy saved</small>}</span></div>) : <p className="timeline-muted">Import an image to use it as a layer. Project images are saved to your private account.</p>}<Button variant="outline" size="sm" onClick={() => imageInput.current?.click()} disabled={!hasRoomForImage || importing}>{importing?<LoaderCircle size={13} className="spinning"/>:<Plus size={13}/>}Import private image</Button><p className="timeline-muted">PNG, JPEG, WebP · up to 2 MB in a composition; private copies count toward your account quota.</p></> : <><p className="timeline-eyebrow">{active.name} · {sceneLayers.length} LAYERS</p>{[...sceneLayers].reverse().map(item => <button type="button" key={item.id} aria-pressed={item.id === layer?.id} className="timeline-layer-select" onClick={() => chooseLayer(item)}>{item.type === "text" ? <Type size={14}/> : <ImageIcon size={14}/>}<span>{item.name}</span></button>)}{!sceneLayers.length && <p className="timeline-muted">This scene is empty. Add text or an image to start.</p>}<Button variant="outline" size="sm" onClick={addText} disabled={document.layers.length >= 100}><Plus size={13}/>Text layer</Button></>}
        </div><div className="timeline-library-footer"><Link href={`/analysis?project=${project.id}`}>Brand DNA<ArrowUpRight size={13}/></Link><Link href={`/generate?project=${project.id}`}>Generate DNA video<ArrowUpRight size={13}/></Link></div>
      </aside>
      <div className="timeline-main">
        <section className="timeline-preview" aria-label="Composition monitor">
          <div className="timeline-preview-toolbar"><span><Clapperboard size={15}/><strong>{project.name}</strong></span><div><label><span className="sr-only">Composition resolution</span><select aria-label="Composition resolution" value={`${document.composition.width}x${document.composition.height}`} onChange={event => resizeComposition(event.target.value)}>{RESOLUTIONS.map(value => <option key={value} value={value}>{value.replace("x", " × ")}</option>)}</select></label><label><span className="sr-only">Composition frame rate</span><select aria-label="Composition frame rate" title="Changing the frame rate retains frame counts" value={document.composition.fps} onChange={event => commit({ ...document, composition: { ...document.composition, fps: Number(event.target.value) as 24 | 30 | 60 } })}>{[24, 30, 60].map(fps => <option key={fps} value={fps}>{fps} FPS</option>)}</select></label><label><span className="sr-only">Preview zoom</span><select aria-label="Preview zoom" value={previewZoom} onChange={event => setPreviewZoom(Number(event.target.value))}>{[50, 75, 100, 125, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label></div></div>
          <div className={`timeline-preview-viewport ${metadata.height > metadata.width ? "portrait" : ""}`}><div className="timeline-preview-surface" role="img" aria-label="Composition preview" style={{ width: `${previewZoom}%`, aspectRatio: `${metadata.width}/${metadata.height}` }}><Player key={compositionKey} ref={player} initialFrame={Math.min(metadata.durationInFrames - 1, Math.round(currentFrame * output.fps / document.composition.fps))} component={ExportComposition} inputProps={inputProps} durationInFrames={metadata.durationInFrames} compositionWidth={metadata.width} compositionHeight={metadata.height} fps={output.fps} controls={false} clickToPlay={false} doubleClickToFullscreen={false} moveToBeginningWhenEnded={false} acknowledgeRemotionLicense style={{ width: "100%", aspectRatio: `${metadata.width}/${metadata.height}` }} errorFallback={() => <div className="timeline-preview-error"><p>Preview could not load.</p><Button variant="outline" size="sm" onClick={() => setPreviewRevision(value => value + 1)}>Reload preview</Button></div>}/></div></div>
          <div className="timeline-transport"><span className="timeline-timecode" data-testid="preview-time">{timecode(currentFrame, document.composition.fps)}<span> / {timecode(total, document.composition.fps)}</span></span><div><Button variant="ghost" size="icon" aria-label="Previous scene" disabled={sceneIndex <= 0} onClick={() => chooseScene(document.scenes[sceneIndex - 1]!.id)}><SkipBack size={15}/></Button><Button variant="ghost" size="icon" aria-label="Previous frame" disabled={currentFrame === 0} onClick={() => seek(currentFrame - 1)}><ChevronLeft size={17}/></Button><Button className="timeline-play" size="icon" aria-label={playing ? "Pause preview" : "Play preview"} onClick={togglePlayback}>{playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</Button><Button variant="ghost" size="icon" aria-label="Next frame" disabled={currentFrame >= total - 1} onClick={() => seek(currentFrame + 1)}><ChevronRight size={17}/></Button><Button variant="ghost" size="icon" aria-label="Next scene" disabled={sceneIndex >= document.scenes.length - 1} onClick={() => chooseScene(document.scenes[sceneIndex + 1]!.id)}><SkipForward size={15}/></Button></div><span className="timeline-transport-hint"><kbd>Space</kbd> play · <kbd>← →</kbd> frame</span></div>
        </section>
        <section className="timeline-tracks-panel" aria-label="Scene timeline">
          <div className="timeline-track-toolbar"><div><Layers3 size={16}/><h2>Timeline</h2><span>{document.scenes.length} scenes · {total} frames</span></div><div><Button size="icon" variant="ghost" aria-label="Undo" title="Undo (⌘Z / Ctrl+Z)" disabled={!canUndo} onClick={() => { endHistoryGroup(); player.current?.pause(); undo(); }}><Undo2 size={15}/></Button><Button size="icon" variant="ghost" aria-label="Redo" title="Redo (⌘⇧Z / Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => { endHistoryGroup(); player.current?.pause(); redo(); }}><Redo2 size={15}/></Button><span className="timeline-toolbar-divider"/><Button size="sm" variant="outline" aria-label="Add text layer" disabled={document.layers.length >= 100} onClick={addText}><Type size={14}/>Text</Button><Button size="sm" variant="outline" aria-label="Add image layer" disabled={!hasRoomForImage || importing} onClick={() => imageInput.current?.click()}>{importing ? <LoaderCircle size={14} className="spinning"/> : <ImageIcon size={14}/>}Image</Button></div></div>
          <TimelineTracks document={document} selectedSceneId={active.id} selectedLayerId={layer?.id} frame={currentFrame} zoom={timelineZoom} onScene={chooseScene} onLayer={chooseLayer} onSeek={seek} onReorder={reorderScene} onEditLayer={editLayer} onEndEdit={endHistoryGroup}/>
          <input type="range" aria-label="Seek preview" min={0} max={total - 1} step={1} value={currentFrame} onChange={event => seek(Number(event.target.value))} className="timeline-master-seek"/>
          <div className="timeline-track-footer"><div className="timeline-frame-field"><NumberField label="Timeline frame" value={currentFrame} min={0} max={total - 1} step={1} onChange={seek}/><span>/{total - 1}f</span></div><label className="timeline-zoom-label">Zoom<input aria-label="Timeline zoom" type="range" min={25} max={200} step={25} value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))}/><span>{timelineZoom}%</span></label></div>
          <div className="timeline-scene-actions"><span>{active.name}</span><div><Button size="icon" variant="ghost" aria-label="Move scene earlier" disabled={sceneIndex === 0} onClick={() => reorderScene(active.id, sceneIndex - 1)}><ChevronLeft size={15}/></Button><Button size="icon" variant="ghost" aria-label="Move scene later" disabled={sceneIndex === document.scenes.length - 1} onClick={() => reorderScene(active.id, sceneIndex + 1)}><ChevronRight size={15}/></Button><Button size="icon" variant="ghost" aria-label="Duplicate scene" disabled={document.scenes.length >= 12 || document.layers.length + sceneLayers.length > 100} onClick={() => addScene(true)}><Copy size={14}/></Button><Button size="icon" variant="ghost" aria-label="Delete scene" disabled={document.scenes.length <= 1} onClick={deleteScene}><Trash2 size={14}/></Button><Button size="sm" variant="outline" disabled={document.scenes.length >= 12} onClick={() => addScene()}><Plus size={14}/>Add scene</Button></div></div>
        </section>
      </div>
      <TimelineInspector key={active.id + (layer?.id ?? "empty")} document={document} scene={active} layer={layer} localFrame={currentFrame - activeEntry.from} onScene={editScene} onDuration={changeDuration} onLayer={editLayer} onDeleteLayer={() => { if (layer) { endHistoryGroup(); commit({ ...document, layers: document.layers.filter(item => item.id !== layer.id) }); setSelectedLayerId(null); } }} onEndEdit={endHistoryGroup}/>
    </section>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Import timeline image" className="sr-only" onChange={event => void importImage(event)}/>
    <section className="timeline-export-settings" aria-label="Timeline export settings"><RenderSettings value={output} onChange={next => { player.current?.pause(); setOutput(next); }} disabled={render.submitting}/><p>The monitor shows these output settings. Content fits inside the selected canvas when its aspect ratio differs from your composition.</p><RenderJobStatus job={job} error={render.error} action={render.action} onCancel={() => void render.cancel()} onRetry={() => void render.retry()} downloadLabel="Download timeline MP4"/></section>
  </div>;
}

