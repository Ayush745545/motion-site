"use client";

import Link from "next/link";
import { Download, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { OutputSettings } from "@motion-dna/motion-engine/render-request";
import type { LocalRenderJob } from "@motion-dna/motion-engine/jobs";
import { Button } from "./ui/button";
import { activeRender } from "./use-render-job";
import "./render-settings.css";

export function RenderSettings({ value, onChange, disabled = false }: { value: OutputSettings; onChange: (settings: OutputSettings) => void; disabled?: boolean }) {
  return <fieldset className="render-output-settings" disabled={disabled}><legend>Export settings</legend>
    <label>Quality<select aria-label="Export quality" value={value.quality} onChange={event => onChange({ ...value, quality: event.target.value as OutputSettings["quality"] })}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
    <label>Aspect ratio<select aria-label="Export aspect ratio" value={value.aspect_ratio} onChange={event => onChange({ ...value, aspect_ratio: event.target.value as OutputSettings["aspect_ratio"] })}><option value="16:9">16:9 · Landscape</option><option value="9:16">9:16 · Portrait</option></select></label>
    <label>Frame rate<select aria-label="Export frame rate" value={value.fps} onChange={event => onChange({ ...value, fps: Number(event.target.value) as OutputSettings["fps"] })}>{[24, 30, 60].map(fps => <option key={fps} value={fps}>{fps} FPS</option>)}</select></label>
  </fieldset>;
}

export function RenderJobStatus({ job, error, action, onCancel, onRetry, downloadLabel = "Download MP4" }: { job: LocalRenderJob | null; error: string | null; action: "cancel" | "retry" | null; onCancel: () => void; onRetry: () => void; downloadLabel?: string }) {
  if (!job && !error) return null;
  const maxAttempts = job?.max_attempts ?? 2, attempt = job?.attempt ?? 0;
  return <section className="render-job-status" aria-label="Export job status">
    {job && <><div className="render-job-heading"><strong>{job.status === "completed" ? "Your MP4 is ready" : job.status === "cancelled" ? "Render cancelled" : job.status === "failed" ? "Render failed" : job.status === "cancelling" ? "Stopping the renderer…" : job.status === "retrying" ? "Waiting for the next attempt" : job.status === "queued" ? "Queued for the local worker" : "Rendering locally"}</strong><span className={`status-label status-${job.status}`}>{job.status}</span></div>
      <p>{job.stage} {job.attempt !== undefined && <>· Attempt {attempt} of {maxAttempts}</>}</p>
      <div className="render-job-progress"><progress aria-label="Export progress" max={100} value={job.progress}/><span>{job.progress}%</span></div>
      {job.output && <p className="render-output-meta">{job.output.width} × {job.output.height} · {job.output.fps} FPS · {job.output.duration}s · H.264</p>}
      {job.error && <p className="render-job-error" role="alert">{job.error}</p>}
      <div className="render-job-actions">
        {activeRender(job.status) && <Button variant="outline" size="sm" onClick={onCancel} disabled={Boolean(action) || job.status === "cancelling"}>{action === "cancel" || job.status === "cancelling" ? <LoaderCircle size={14} className="spinning"/> : <X size={14}/>}Cancel render</Button>}
        {["failed", "cancelled"].includes(job.status) && <Button variant="outline" size="sm" disabled={Boolean(action) || attempt >= maxAttempts} onClick={onRetry} title={attempt >= maxAttempts ? "The two-attempt limit has been reached. Adjust the project before starting a new export." : "Retry this export using the same snapshot"}><RotateCcw size={14}/>Retry render</Button>}
        {job.status === "completed" && job.download_url && <Button asChild size="sm"><a href={job.download_url}><Download size={14}/>{downloadLabel}</a></Button>}
        <Link href="/queue">Open render queue</Link>
      </div>
      {job.status === "failed" && attempt >= maxAttempts && <small>The retry limit is reached. Review the failure, adjust your project, then start a new export.</small>}
    </>}
    {error && <p role="alert" className="render-job-error">{error}</p>}
  </section>;
}
