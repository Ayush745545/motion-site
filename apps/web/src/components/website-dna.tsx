"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { DNAJobSchema, DNAResultSchema, type DNAJob, type DNAResult } from "@motion-dna/dna-schema";
import { ScanLine, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { useWorkspace, type Project } from "@/lib/workspace";

async function read(response: Response) {
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { message?: string } };
    throw new Error(error.error?.message || "Analysis could not be loaded.");
  }
  return data;
}
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function WebsiteDNA({ project }: { project: Project }) {
  const { updateProject } = useWorkspace();
  const [job, setJob] = useState<DNAJob | null>(null);
  const [result, setResult] = useState<DNAResult | null>(project.websiteDNA ?? null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(Boolean(project.dnaJobId));
  useEffect(() => {
      if (!project.dnaJobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = DNAJobSchema.parse(await read(await fetch(`/api/dna/jobs/${project.dnaJobId}`, { signal: controller.signal, cache: "no-store" })));
        if (controller.signal.aborted) return;
        setJob(current); setError(null); setLoading(false);
        if (current.status === "completed" && current.analysis_id) {
          const data = DNAResultSchema.parse(await read(await fetch(`/api/dna/results/${current.analysis_id}`, { signal: controller.signal, cache: "no-store" })));
          if (!controller.signal.aborted) { setResult(data); updateProject(project.id, { websiteDNA: data }); }
        } else if (current.status === "queued" || current.status === "running") timer = setTimeout(() => void poll(), 1200);
      } catch (failure) { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : "Analysis is unavailable."); setLoading(false); } }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [project.dnaJobId, project.id, retry, updateProject]);

  async function analyze() {
    setStarting(true); setError(null);
    try {
      const created = DNAJobSchema.parse(await read(await fetch("/api/dna/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: project.source, project_id: project.id }), signal: AbortSignal.timeout(15000) })));
      setJob(created); setResult(null); updateProject(project.id, { dnaJobId: created.job_id });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Analysis could not start."); }
    finally { setStarting(false); }
  }
  const busy = starting || job?.status === "queued" || job?.status === "running";
  return <section className="website-dna" aria-label="Website DNA extraction">
    <div className="analysis-section-heading"><div><h2>Extracted signatures</h2><p>A public-page capture with measured styles and heuristic brand signals.</p></div><Button disabled={busy || loading || project.sourceType !== "url"} onClick={() => void analyze()} aria-describedby="dna-scope"><ScanLine size={16}/>{busy ? "Analyzing website…" : result ? "Analyze again" : "Analyze website"}</Button></div>
    <p id="dna-scope" className="muted">{project.sourceType === "url" ? "Runs in an isolated local browser. No login session is used. CSS motion only; JavaScript animation behavior is not measured." : "Website analysis requires a URL project. Uploaded source code is never executed."}</p>
    {(loading || busy) && <p role="status" className="panel dna-notice">{loading ? "Loading saved analysis…" : "Capturing the public page and measuring its visual styles. This can take up to a minute."}</p>}
    {error && <div role="alert" className="panel dna-notice"><p>{error}</p>{project.dnaJobId && <Button variant="outline" onClick={() => { setLoading(true); setRetry(value => value + 1); }}><RefreshCw size={14}/>Retry loading</Button>}</div>}
    {job?.status === "failed" && <p role="alert" className="panel dna-notice">{job.error || "Analysis failed. Try again."}</p>}
    {!result && !busy && !loading && !error && <div className="panel dna-notice"><h3>No extracted DNA yet</h3><p>Analyze a public website to capture colors, typography, layout, CSS motion and a screenshot. Your manual draft settings stay editable below.</p></div>}
    {result && <>
      <div className="dna-result-meta"><span>Schema {result.schema_version} · Confidence {percent(result.confidence)}</span><span>Captured {new Date(result.captured_at).toLocaleString()}</span><a href={`/api/dna/results/${result.analysis_id}`} target="_blank" rel="noreferrer">Open JSON result ↗</a></div>
      <div className="dna-results-grid">
        <article className="panel dna-result-card"><h3>Brand palette</h3><p>Frequency counts sampled elements per color role.</p><div className="dna-swatches">{result.palette.map(color => <div key={`${color.role}-${color.value}`}><span style={{background:color.value}}/><code>{color.value}</code><small>{color.role} · {percent(color.frequency)} · {color.count} uses</small><small>Confidence {percent(color.confidence)}</small></div>)}</div>{!result.palette.length && <p>No supported opaque RGB colors found.</p>}</article>
        <article className="panel dna-result-card"><h3>Typography</h3><div className="dna-scroll"><table><caption className="sr-only">Observed font declarations</caption><thead><tr><th>Family</th><th>Size / weight</th><th>Uses</th></tr></thead><tbody>{result.typography.fonts.map((font,index)=><tr key={index}><td>{font.family}<small>{font.available ? "Font check passed" : "Unavailable or not loaded"}</small></td><td>{font.size} / {font.weight}</td><td>{font.count}</td></tr>)}</tbody></table></div><p>{result.typography.headings.map(h=>`H${h.level}: ${h.count} (${h.sizes.join(", ")})`).join(" · ") || "No visible headings found."}</p></article>
        <article className="panel dna-result-card"><h3>Layout features</h3><div className="dna-feature-grid">{result.layout.features.map(feature=><div key={feature.kind}><strong>{feature.count}</strong><span>{feature.kind}</span><small>{percent(feature.confidence)} confidence</small></div>)}</div><p>Viewport text density: {percent(result.layout.visual_density)} · {result.layout.sampled_elements} visible elements sampled.</p></article>
        <article className="panel dna-result-card"><h3>CSS motion patterns</h3><p>Computed CSS only. This is not a full analysis of JavaScript-driven motion.</p><div className="dna-scroll">{result.motion.map((motion,index)=><div key={index} className="dna-motion"><strong>{motion.animation === "none" ? "Transition / transform" : motion.animation}</strong><p>Transition: {motion.transition} · {motion.transition_duration}</p><p>Animation: {motion.animation_duration} · {motion.count} elements</p><code>{motion.timing}</code><code>{motion.transform}</code></div>)}</div>{!result.motion.length && <p>No CSS motion observed at capture time.</p>}</article>
      </div>
      <article className="panel dna-result-card"><h3>Media references</h3><p>Public image URLs are listed without loading third-party media in your studio. Logo and hero classifications are candidates.</p><div className="dna-scroll">{result.assets.map((asset,index)=><div className="dna-asset" key={index}><strong>{asset.kind.replaceAll("_"," ")}</strong><code>{asset.url}</code><small>{asset.width} × {asset.height} · confidence {percent(asset.confidence)}</small></div>)}{!result.assets.length && <p>No visible image elements found.</p>}</div></article>
      <article className="panel dna-result-card"><h3>Website capture</h3><p>1440 × 900 viewport. Inputs and editable fields are masked.</p>{result.screenshots.map(screenshot=><a key={screenshot.path} href={screenshot.path} target="_blank" rel="noreferrer"><Image unoptimized className="dna-screenshot" src={screenshot.path} alt="Captured public website viewport with form controls masked" width={screenshot.width} height={screenshot.height}/></a>)}</article>
      <details className="panel dna-result-card"><summary>Capture limitations and warnings ({result.warnings.length})</summary><ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>
    </>}
  </section>;
}
