"use client";
import { useRef, type PointerEvent } from "react";
import { GripVertical, ImageIcon, Type } from "lucide-react";
import { sceneTimeline, totalFrames, type ProjectDocument, type TimelineLayer } from "@motion-dna/motion-engine/project";

type Props = {
  document: ProjectDocument; selectedSceneId: string; selectedLayerId?: string; frame: number; zoom: number;
  onScene: (id: string) => void; onLayer: (layer: TimelineLayer) => void; onSeek: (frame: number) => void;
  onReorder: (id: string, index: number) => void; onEditLayer: (layer: TimelineLayer, group?: string) => void; onEndEdit: () => void;
};
export function TimelineTracks({ document, selectedSceneId, selectedLayerId, frame, zoom, onScene, onLayer, onSeek, onReorder, onEditLayer, onEndEdit }: Props) {
  const scenes = sceneTimeline(document), total = totalFrames(document), fps = document.composition.fps;
  const draggedScene = useRef<string | null>(null);
  const gesture = useRef<{ layer: TimelineLayer; x: number; width: number; resize: boolean } | null>(null);
  const interval = Math.max(fps, Math.ceil(total / 16 / fps) * fps);
  const ticks = Array.from({ length: Math.ceil(total / interval) }, (_, index) => index * interval);
  function scrub(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.round((event.clientX - box.left) / box.width * (total - 1)));
  }
  function begin(event: PointerEvent<HTMLButtonElement>, layer: TimelineLayer, resize = false) {
    event.stopPropagation(); onEndEdit(); onLayer(layer);
    const width = event.currentTarget.closest(".timeline-track-lane")!.getBoundingClientRect().width;
    gesture.current = { layer, x: event.clientX, width, resize };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current; if (!drag) return;
    const delta = Math.round((event.clientX - drag.x) / drag.width * total);
    if (!delta) return;
    const parent = scenes.find(scene => scene.id === drag.layer.sceneId)!;
    const next = drag.resize
      ? { ...drag.layer, durationInFrames: Math.max(1, Math.min(parent.durationInFrames - drag.layer.from, drag.layer.durationInFrames + delta)) }
      : { ...drag.layer, from: Math.max(0, Math.min(parent.durationInFrames - drag.layer.durationInFrames, drag.layer.from + delta)) };
    onEditLayer(next, `drag-${drag.layer.id}`);
  }
  function end() { gesture.current = null; onEndEdit(); }
  return <div className="timeline-track-scroll"><div className="timeline-track-canvas" style={{ minWidth: `${Math.max(640, 900 * zoom / 100)}px` }}>
    <div className="timeline-track-row"><span className="timeline-track-label">Time · {fps} FPS</span><div className="timeline-ruler" role="slider" tabIndex={0} aria-label="Timeline ruler" aria-valuemin={0} aria-valuemax={total - 1} aria-valuenow={frame} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); onSeek(frame + (event.key === "ArrowRight" ? 1 : -1)); } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); scrub(event); }} onPointerMove={event => { if (event.buttons === 1) scrub(event); }}>{ticks.map(tick => <span key={tick} style={{ left: `${tick / total * 100}%` }}>{(tick / fps).toFixed(tick % fps ? 1 : 0)}s</span>)}</div></div>
    <div className="timeline-track-row"><span className="timeline-track-label">Scenes</span><div className="timeline-scenes-lane">{scenes.map((scene, index) => <button type="button" key={scene.id} draggable onDragStart={event => { draggedScene.current = scene.id; event.dataTransfer.setData("text/plain", scene.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = draggedScene.current; if (id) onReorder(id, index); draggedScene.current = null; }} onDragEnd={() => { draggedScene.current = null; }} aria-label={`Select scene ${index + 1}: ${scene.name}`} aria-pressed={scene.id === selectedSceneId} onClick={() => onScene(scene.id)} style={{ width: `${scene.durationInFrames / total * 100}%` }}><GripVertical size={12}/><span>{String(index + 1).padStart(2, "0")} {scene.name}<small>{scene.durationInFrames}f · {(scene.durationInFrames / fps).toFixed(2)}s</small></span></button>)}</div></div>
    {document.layers.map(layer => {
      const scene = scenes.find(item => item.id === layer.sceneId)!;
      const left = (scene.from + layer.from) / total * 100, width = layer.durationInFrames / total * 100;
      return <div className="timeline-track-row" key={layer.id}><button type="button" className="timeline-track-label" onClick={() => onLayer(layer)} aria-label={`Select layer ${layer.name}`} aria-pressed={layer.id === selectedLayerId}>{layer.type === "text" ? <Type size={12}/> : <ImageIcon size={12}/>}<span>{layer.name}</span></button><div className="timeline-track-lane"><div className={`timeline-layer-clip ${layer.type} ${layer.id === selectedLayerId ? "selected" : ""}`} style={{ left: `${left}%`, width: `${width}%` }}><button type="button" className="timeline-clip-body" aria-label={`Move ${layer.name} layer`} onPointerDown={event => begin(event, layer)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onClick={() => onLayer(layer)}><span>{layer.type === "text" ? layer.text || "Empty text" : layer.name}</span></button><button type="button" className="timeline-clip-handle" aria-label={`Resize ${layer.name} layer`} onPointerDown={event => begin(event, layer, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>{layer.keyframes.map(keyframe => <i key={keyframe.id} title={`${keyframe.property}: ${keyframe.value} at ${keyframe.frame}f`} style={{ left: `${keyframe.frame / layer.durationInFrames * 100}%` }}/>)}</div><span className="timeline-playhead" style={{ left: `${frame / total * 100}%` }}/></div></div>;
    })}
  </div></div>;
}
