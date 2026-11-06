"use client";

import { useState } from "react";
import { Diamond, Layers3, Palette, Plus, Settings2, Sparkles, Trash2, Type } from "lucide-react";
import { PROPERTY_BOUNDS, type ProjectDocument, type TimelineKeyframe, type TimelineLayer, type TimelineScene } from "@motion-dna/motion-engine/project";
import { Button } from "./ui/button";
import { withKeyframe } from "./timeline-editor-model";

type InspectorProps = {
  document: ProjectDocument;
  scene: TimelineScene;
  layer?: TimelineLayer;
  localFrame: number;
  onScene: (scene: TimelineScene, group?: string) => void;
  onDuration: (frames: number) => void;
  onLayer: (layer: TimelineLayer, group?: string) => void;
  onDeleteLayer: () => void;
  onEndEdit: () => void;
};

export function TimelineInspector({ document, scene, layer, localFrame, onScene, onDuration, onLayer, onDeleteLayer, onEndEdit }: InspectorProps) {
  const [property, setProperty] = useState<TimelineKeyframe["property"]>("x");
  const [keyframeValue, setKeyframeValue] = useState<number | null>(null);
  const fps = document.composition.fps;
  const [minimum, maximum] = PROPERTY_BOUNDS[property];
  const keyframeFrame = layer ? Math.max(0, Math.min(layer.durationInFrames - 1, localFrame - layer.from)) : 0;
  function editKeyframe(id: string, patch: Partial<TimelineKeyframe>) {
    if (layer) onLayer({ ...layer, keyframes: layer.keyframes.map(keyframe => keyframe.id === id ? { ...keyframe, ...patch } : keyframe) }, `keyframe-${id}`);
  }
  return <aside className="timeline-inspector" aria-label="Scene properties">
    <div className="timeline-pane-heading"><span><Settings2 size={15}/>Inspector</span><span>{layer?.type ?? "scene"}</span></div>
    <section className="timeline-inspector-section">
      <h2><Layers3 size={14}/>Scene</h2>
      <TextField label="Scene name" value={scene.name} maxLength={100} onChange={name => onScene({ ...scene, name }, `scene-name-${scene.id}`)} onBlur={onEndEdit}/>
      <NumberField label="Scene duration (seconds)" value={scene.durationInFrames / fps} min={1 / fps} max={1800 / fps} step={1 / fps} onChange={seconds => onDuration(Math.round(seconds * fps))} onBlur={onEndEdit}/>
      <ColorField label="Background" value={scene.background} onChange={background => onScene({ ...scene, background }, `scene-color-${scene.id}`)} onBlur={onEndEdit}/>
      <div className="timeline-field-pair"><label className="timeline-field">Transition<select aria-label="Scene transition" value={scene.transition.preset} onChange={event => onScene({ ...scene, transition: { preset: event.target.value as TimelineScene["transition"]["preset"], durationInFrames: event.target.value === "cut" ? 0 : Math.min(12, Math.floor(scene.durationInFrames / 2)) } })}><option value="cut">Cut</option><option value="fade">Fade through</option><option value="slide">Slide</option></select></label><NumberField label="Transition frames" value={scene.transition.durationInFrames} min={0} max={Math.min(120, Math.floor(scene.durationInFrames / 2))} step={1} onChange={durationInFrames => onScene({ ...scene, transition: { ...scene.transition, durationInFrames } }, `transition-${scene.id}`)} onBlur={onEndEdit}/></div>
    </section>
    {layer ? <>
      <section className="timeline-inspector-section">
        <h2>{layer.type === "text" ? <Type size={14}/> : <Palette size={14}/>} {layer.type === "text" ? "Text layer" : "Image layer"}<Button size="icon" variant="ghost" aria-label="Delete layer" onClick={onDeleteLayer}><Trash2 size={14}/></Button></h2>
        <TextField label="Layer name" value={layer.name} maxLength={100} onChange={name => onLayer({ ...layer, name }, `layer-name-${layer.id}`)} onBlur={onEndEdit}/>
        {layer.type === "text" ? <>
          <label className="timeline-field">Headline<textarea aria-label="Headline" rows={3} value={layer.text} maxLength={2000} onChange={event => onLayer({ ...layer, text: event.target.value }, `text-${layer.id}`)} onBlur={onEndEdit}/></label>
          <div className="timeline-field-pair"><label className="timeline-field">Typeface<select aria-label="Typeface" value={layer.fontFamily} onChange={event => onLayer({ ...layer, fontFamily: event.target.value as typeof layer.fontFamily })}><option value="sans">Sans serif</option><option value="serif">Editorial serif</option><option value="mono">Monospace</option></select></label><NumberField label="Font size" value={layer.fontSize} min={8} max={300} step={1} onChange={fontSize => onLayer({ ...layer, fontSize }, `font-size-${layer.id}`)} onBlur={onEndEdit}/></div>
          <div className="timeline-field-pair"><label className="timeline-field">Weight<select aria-label="Font weight" value={layer.fontWeight} onChange={event => onLayer({ ...layer, fontWeight: Number(event.target.value) as 400 | 700 })}><option value={400}>Regular</option><option value={700}>Bold</option></select></label><label className="timeline-field">Text alignment<select aria-label="Text alignment" value={layer.align} onChange={event => onLayer({ ...layer, align: event.target.value as typeof layer.align })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label></div>
          <ColorField label="Text" value={layer.color} onChange={color => onLayer({ ...layer, color }, `text-color-${layer.id}`)} onBlur={onEndEdit}/>
        </> : <label className="timeline-field">Image fit<select aria-label="Image fit" value={layer.fit} onChange={event => onLayer({ ...layer, fit: event.target.value as "contain" | "cover" })}><option value="contain">Contain</option><option value="cover">Cover</option></select></label>}
      </section>
      <section className="timeline-inspector-section">
        <h2><Settings2 size={14}/>Transform & timing</h2>
        <div className="timeline-field-pair">{([['x', 'Position X', -7680, 7680, 1], ['y', 'Position Y', -7680, 7680, 1], ['width', 'Width', 8, 3840, 1], ['height', 'Height', 8, 3840, 1], ['scale', 'Scale', .05, 8, .05], ['rotation', 'Rotation', -3600, 3600, 1], ['opacity', 'Opacity', 0, 1, .05]] as const).map(([key, label, min, max, step]) => <NumberField key={key} label={label} value={layer[key]} min={min} max={max} step={step} onChange={value => onLayer({ ...layer, [key]: value }, `${key}-${layer.id}`)} onBlur={onEndEdit}/>)}</div>
        <div className="timeline-field-pair"><NumberField label="Layer start frame" value={layer.from} min={0} max={scene.durationInFrames - layer.durationInFrames} step={1} onChange={from => onLayer({ ...layer, from }, `from-${layer.id}`)} onBlur={onEndEdit}/><NumberField label="Layer duration frames" value={layer.durationInFrames} min={1} max={scene.durationInFrames - layer.from} step={1} onChange={durationInFrames => onLayer({ ...layer, durationInFrames }, `duration-${layer.id}`)} onBlur={onEndEdit}/></div>
        <p>Position is measured from the composition’s top-left corner. Timing is local to this scene.</p>
      </section>
      <section className="timeline-inspector-section">
        <h2><Sparkles size={14}/>Animation</h2>
        <label className="timeline-field">Entrance animation<select aria-label="Entrance animation" value={layer.animation.preset} onChange={event => onLayer({ ...layer, animation: { preset: event.target.value as typeof layer.animation.preset, durationInFrames: event.target.value === "none" ? 0 : Math.min(18, layer.durationInFrames) } })}><option value="none">None</option><option value="fade">Soft fade</option><option value="slide">Slide up</option><option value="scale">Gentle scale</option></select></label>
        <NumberField label="Animation frames" value={layer.animation.durationInFrames} min={0} max={Math.min(120, layer.durationInFrames)} step={1} onChange={durationInFrames => onLayer({ ...layer, animation: { ...layer.animation, durationInFrames } }, `animation-${layer.id}`)} onBlur={onEndEdit}/>
      </section>
      <section className="timeline-inspector-section timeline-keyframes">
        <h2><Diamond size={14}/>Keyframes <span>{layer.keyframes.length}</span></h2>
        <label className="timeline-field">Property<select aria-label="Keyframe property" value={property} onChange={event => { setProperty(event.target.value as typeof property); setKeyframeValue(null); }}>{(["x", "y", "scale", "rotation", "opacity"] as const).map(name => <option key={name} value={name}>{name === "x" ? "Position X" : name === "y" ? "Position Y" : name}</option>)}</select></label>
        <NumberField label="New keyframe value" value={keyframeValue ?? layer[property]} min={minimum} max={maximum} step={property === "opacity" || property === "scale" ? .05 : 1} onChange={setKeyframeValue}/>
        <Button size="sm" variant="outline" disabled={layer.keyframes.length >= 200} title={layer.keyframes.length >= 200 ? "A layer can contain up to 200 keyframes" : `Add or update ${property} at local frame ${keyframeFrame}`} onClick={() => { onEndEdit(); onLayer(withKeyframe(layer, property, keyframeFrame, keyframeValue ?? layer[property])); }}><Plus size={13}/>Add keyframe</Button>
        <p>Current layer frame: {keyframeFrame}. Move the playhead, then add another value to animate between them.</p>
        {layer.keyframes.length > 0 && <div className="timeline-keyframe-list">{layer.keyframes.map(keyframe => <fieldset key={keyframe.id}><legend>{keyframe.property} · {keyframe.frame}f</legend><div className="timeline-field-pair"><NumberField label={`Keyframe ${keyframe.id} frame`} visualLabel="Frame" value={keyframe.frame} min={0} max={layer.durationInFrames - 1} step={1} onChange={frame => editKeyframe(keyframe.id, { frame })} onBlur={onEndEdit}/><NumberField label={`Keyframe ${keyframe.id} value`} visualLabel="Value" value={keyframe.value} min={PROPERTY_BOUNDS[keyframe.property][0]} max={PROPERTY_BOUNDS[keyframe.property][1]} step={keyframe.property === "scale" || keyframe.property === "opacity" ? .05 : 1} onChange={value => editKeyframe(keyframe.id, { value })} onBlur={onEndEdit}/></div><div className="timeline-keyframe-footer"><select aria-label={`Keyframe ${keyframe.id} easing`} value={keyframe.easing} onChange={event => editKeyframe(keyframe.id, { easing: event.target.value as typeof keyframe.easing })} onBlur={onEndEdit}><option value="linear">Linear</option><option value="ease-in-out">Ease in / out</option></select><Button size="icon" variant="ghost" aria-label={`Delete ${keyframe.property} keyframe at ${keyframe.frame}`} onClick={() => onLayer({ ...layer, keyframes: layer.keyframes.filter(entry => entry.id !== keyframe.id) })}><Trash2 size={13}/></Button></div></fieldset>)}</div>}
      </section>
    </> : <div className="timeline-inspector-section"><p>Select a text or image layer in the timeline to edit its appearance, timing, and keyframes.</p></div>}
  </aside>;
}

export function NumberField({ label, visualLabel, value, min, max, step = 1, onChange, onBlur }: { label: string; visualLabel?: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; onBlur?: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && (!draft.trim() || !Number.isFinite(Number(draft)) || Number(draft) < min || Number(draft) > max);
  const display = Number.isInteger(value) ? value : Number(value.toFixed(4));
  return <label className="timeline-field"><span>{visualLabel ?? label}</span><input type="number" aria-label={label} aria-invalid={invalid} min={min} max={max} step={step} value={draft ?? display} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") setDraft(null); }} onChange={event => { const next = event.target.value; setDraft(next); const number = Number(next); if (next.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(number); }} onBlur={() => { setDraft(null); onBlur?.(); }}/>{invalid && <small className="timeline-field-error">Use {Number(min.toFixed(3))}–{Number(max.toFixed(3))}. The last valid value is kept.</small>}</label>;
}

function TextField({ label, value, maxLength, onChange, onBlur }: { label: string; value: string; maxLength: number; onChange: (value: string) => void; onBlur?: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label className="timeline-field"><span>{label}</span><input aria-label={label} value={draft ?? value} maxLength={maxLength} onChange={event => { setDraft(event.target.value); if (event.target.value.trim()) onChange(event.target.value); }} onBlur={() => { setDraft(null); onBlur?.(); }}/></label>;
}

function ColorField({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (value: string) => void; onBlur: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && !/^#[0-9a-f]{6}$/i.test(draft);
  return <div className="timeline-color-field"><label>{label}<input type="color" aria-label={`${label} color`} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur}/></label><input aria-label={`${label} hex`} value={draft ?? value.toUpperCase()} maxLength={7} aria-invalid={invalid} onChange={event => { setDraft(event.target.value); if (/^#[0-9a-f]{6}$/i.test(event.target.value)) onChange(event.target.value); }} onBlur={() => { setDraft(null); onBlur(); }}/>{invalid && <small className="timeline-field-error">Use a six-digit hex color.</small>}</div>;
}
