"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Braces, Check, ExternalLink, LayoutDashboard, ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { FONT_FAMILIES, CompositionPreview } from "./composition-preview";
import { WebsiteDNA } from "./website-dna";
import { SourceDNAAnalysis } from "./source-dna";
import { EditorEmpty } from "./motion-editor";
import "./editor.css";

export function DNAAnalysis() {
  const { projects, activeProjectId, hydrated, selectProject, storageError } = useWorkspace();
  const params = useSearchParams();
  const requested = params.get("project");
  const project = requested ? projects.find((entry) => entry.id === requested) : projects.find((entry) => entry.id === activeProjectId) ?? projects[0];
  useEffect(() => { if (project && project.id !== activeProjectId) selectProject(project.id); }, [project, activeProjectId, selectProject]);
  if (!hydrated) return <div className="editor-loading" role="status">Opening project DNA…</div>;
  if (!project) return <EditorEmpty missing={Boolean(requested)}/>;
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0];
  if (!scene) return <EditorEmpty/>;
  const colors = [{ label: "Background", value: scene.background }, { label: "Text", value: scene.foreground }, { label: "Accent", value: scene.accent }];
  return <div className="analysis-page">
    <div className="page-heading"><div><p className="page-kicker">THE DETAILS THAT MAKE IT YOURS</p><h1>DNA analysis</h1><p className="muted">A visual identity, ready to become a story.</p></div><Button asChild variant="outline"><Link href={`/generate?project=${project.id}`}>Generate video<ArrowRight size={15}/></Link></Button></div>
    <section className="analysis-source panel"><span className="analysis-source-icon">{project.sourceType === "url" ? <ScanLine size={23}/> : <Braces size={23}/>}</span><div><span className="analysis-kicker">PROJECT SOURCE</span><h2>{project.name}</h2><p>{project.sourceType === "url" ? project.source : project.sourceName || "Pasted source code"}</p></div><span className="analysis-status"><Check size={13}/>{storageError ? "Changes in memory" : "Saved locally"}</span></section>
    <WebsiteDNA key={project.id} project={project}/>
    <SourceDNAAnalysis key={`source-${project.id}`} project={project}/>
    <div className="analysis-section-heading"><div><h2>Draft brand settings</h2><p>Editable defaults from your composition. These have not been extracted from your source.</p></div><Button asChild variant="ghost" size="sm"><Link href={`/studio?project=${project.id}`}>Edit in studio<ArrowRight size={14}/></Link></Button></div>
    <section className="analysis-brand-grid">
      <div className="analysis-brand-details panel"><span className="analysis-kicker">COLOR SYSTEM</span><div className="analysis-color-grid">{colors.map((color) => <div key={color.label}><span className="analysis-color-swatch" style={{ background: color.value }}/><strong>{color.label}</strong><code>{color.value.toUpperCase()}</code></div>)}</div><div className="analysis-type-sample"><span className="analysis-kicker">TYPOGRAPHY</span><strong style={{ fontFamily: FONT_FAMILIES[scene.fontFamily] }}>Aa Bb Cc</strong><div><span>{scene.fontFamily === "sans" ? "Sans serif" : scene.fontFamily === "serif" ? "Editorial serif" : "Monospace"}</span><span>{scene.fontSize} · {scene.align} aligned</span></div></div><div className="analysis-layout-details"><span><LayoutDashboard size={14}/>{project.resolution.replace("x", " × ")}</span><span><Sparkles size={14}/>{scene.animation} entrance</span></div></div>
      <div className="analysis-preview-panel panel"><div><span className="analysis-kicker">COMPOSITION PREVIEW</span><span>Manual draft</span></div><CompositionPreview scene={scene} resolution={project.resolution} reducedMotion compact/><Link href={`/studio?project=${project.id}`}>Make it your own<ExternalLink size={13}/></Link></div>
    </section>
  </div>;
}
