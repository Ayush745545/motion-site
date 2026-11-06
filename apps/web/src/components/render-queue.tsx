"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, LoaderCircle, RefreshCw, RotateCcw, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RenderQueueSchema, type RenderJob } from "@/lib/render-schema";

type QueueState = { loading: boolean; jobs: RenderJob[]; error: "unconfigured" | "unavailable" | null };

export function RenderQueue() {
  const [state, setState] = useState<QueueState>({ loading: true, jobs: [], error: null });
  const [actionIds, setActionIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const check = useCallback(async (signal?: AbortSignal): Promise<QueueState | undefined> => {
    try {
      const response = await fetch("/api/render-jobs", {
        cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6500)]) : AbortSignal.timeout(6500),
      });
      if (response.status === 501) return { loading: false, jobs: [], error: "unconfigured" };
      if (!response.ok) throw new Error("unavailable");
      return { loading: false, jobs: RenderQueueSchema.parse(await response.json()).jobs, error: null };
    } catch {
      if (!signal?.aborted) return { loading: false, jobs: [], error: "unavailable" };
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void check(controller.signal).then((result) => {
        if (result) setState(result);
      });
    };
    refresh();
    const interval = setInterval(refresh, state.jobs.some(job => ["queued", "running", "retrying", "cancelling"].includes(job.status)) ? 2_000 : 15_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [check, state.jobs]);

  const control = useCallback(async (jobId: string, projectId: string, kind: "cancel" | "retry" | "delete-export") => {
    if (actionIds.includes(jobId)) return;
    setActionIds(ids => [...ids, jobId]);
    setActionError(null);
    try {
      const deletingExport = kind === "delete-export";
      const endpoint = deletingExport
        ? `/api/motion/render/${jobId}/export?project_id=${encodeURIComponent(projectId)}`
        : `/api/motion/render/${jobId}/${kind}`;
      const response = await fetch(endpoint, {
        method: deletingExport ? "DELETE" : "POST",
        ...(deletingExport ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }) }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "The render action failed.");
      const next = await check();
      if (next) setState(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The render action failed.");
    } finally {
      setActionIds(ids => ids.filter(id => id !== jobId));
    }
  }, [actionIds, check]);

  return <div className="queue-page"><div className="page-heading" data-enter><div><p className="page-kicker">THE FINAL FRAME</p><h1>Render queue</h1><p className="muted">Your exports, from the first frame to the finished file.</p></div><Button variant="outline" disabled={state.loading} onClick={()=>{setState(value=>({...value,loading:true}));void check().then(result=>{if(result)setState(result);});}}><RefreshCw size={14} className={state.loading?"spinning":""}/>{state.loading?"Checking…":"Refresh queue"}</Button></div>
    <section className="queue-counts" aria-label="Render job statistics">{["queued","running","completed","failed","cancelled"].map(status=><span key={status}>{status.charAt(0).toUpperCase()+status.slice(1)}<strong>{state.error||state.loading?"—":state.jobs.filter(job=>job.status===status).length}</strong></span>)}</section>
    {actionError&&<p role="alert" className="render-job-error">{actionError}</p>}
    {state.loading?<div className="route-loading" role="status" aria-label="Checking render service"><div className="skeleton"/><div className="skeleton"/></div>:state.jobs.length&&!state.error?<div className="queue-list">{state.jobs.map(job=><article className="panel queue-job" key={job.id}><div><h2>{job.project_name}</h2><p>{job.stage||`Job ${job.id}`}</p>{job.output&&<p>{job.output.width} × {job.output.height} · {job.output.fps} FPS · {job.output.duration}s · H.264</p>}{job.error&&<p role="alert">{job.error}</p>}{job.status==="completed"&&job.download_url&&job.export_available!==false&&<Button asChild variant="outline" size="sm"><a href={job.download_url}>Download MP4<ArrowUpRight size={14}/></a></Button>}{job.status==="completed"&&job.export_available&&job.project_id&&<Button variant="ghost" size="sm" disabled={actionIds.includes(job.id)} onClick={()=>void control(job.id,job.project_id!,"delete-export")}>{actionIds.includes(job.id)?<LoaderCircle size={14} className="spinning"/>:<X size={14}/>}Remove saved MP4</Button>}{job.project_id&&["queued","running","retrying"].includes(job.status)&&<Button variant="outline" size="sm" disabled={actionIds.includes(job.id)} onClick={()=>void control(job.id,job.project_id!,"cancel")}><X size={14}/>{actionIds.includes(job.id)?"Stopping…":"Cancel render"}</Button>}{job.project_id&&["failed","cancelled"].includes(job.status)&&(job.attempt??0)<(job.max_attempts??2)&&<Button variant="outline" size="sm" disabled={actionIds.includes(job.id)} onClick={()=>void control(job.id,job.project_id!,"retry")}><RotateCcw size={14}/>{actionIds.includes(job.id)?"Queuing…":"Retry render"}</Button>}</div><div className="queue-job-status"><span className={`status-label status-${job.status}`}>{job.status}</span>{actionIds.includes(job.id)&&<LoaderCircle size={14} className="spinning" aria-label="Updating render"/>}</div><progress aria-label={`${job.project_name} render progress`} value={job.progress} max={100}/></article>)}</div>:<section className="queue-empty" role="status"><span className="queue-empty-icon"><Video size={28}/></span><h2>{state.error?"Let’s reconnect your renderer.":"A clear queue. A new possibility."}</h2><p>{state.error?"The local render service couldn’t be reached. Check your workspace settings, then refresh the queue.":"Your exports will appear here. Open the video studio when you’re ready to bring your project to life."}</p><div><Button asChild><Link href="/generate">Open video studio<ArrowUpRight size={14}/></Link></Button><Button asChild variant="outline"><Link href="/settings">Local settings</Link></Button></div></section>}
    <div className="queue-help"><Info size={18}/><div><h3>A little patience. A finished picture.</h3><p>Progress comes from the local Remotion renderer and MP4 encoder. Your finished video is ready to download when the job completes.</p></div></div>
  </div>;
}
