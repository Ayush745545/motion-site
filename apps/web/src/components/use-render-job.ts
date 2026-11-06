"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RenderJobSchema, type LocalRenderJob } from "@motion-dna/motion-engine/jobs";
import { RenderRequestSchema, type OutputSettings } from "@motion-dna/motion-engine/render-request";
import type { RenderInput } from "@motion-dna/motion-engine/render-input";

export const SAMPLE_RENDER_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
export const activeRender = (status: string) => ["queued", "running", "retrying", "cancelling"].includes(status);

async function json(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? "The render service is unavailable.");
  return data;
}

export async function requestFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A failed transport retry reuses its request key, rather than creating a second job. */
export function useRenderJob(projectId: string, projectName: string) {
  const [job, setJob] = useState<LocalRenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [action, setAction] = useState<"cancel" | "retry" | null>(null);
  const sending = useRef(false);
  const identity = useRef<{ fingerprint: string; key: string } | null>(null);
  const storageKey = `motion-dna.render.${projectId}`;

  const accept = useCallback((value: unknown) => {
    const next = RenderJobSchema.parse(value);
    if (next.project_id && next.project_id !== projectId) throw new Error("This export belongs to another project.");
    setJob(next); setError(null);
    try { sessionStorage.setItem(`${storageKey}.job`, next.id); } catch { /* Job remains available in the render queue. */ }
    return next;
  }, [projectId, storageKey]);

  useEffect(() => {
    const controller = new AbortController();
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(`${storageKey}.job`);
      const saved = sessionStorage.getItem(`${storageKey}.request`);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (typeof parsed === "object" && parsed !== null && "fingerprint" in parsed && "key" in parsed && typeof parsed.fingerprint === "string" && typeof parsed.key === "string") identity.current = { fingerprint: parsed.fingerprint, key: parsed.key };
      }
    } catch { /* Session storage is optional; no source data is stored here. */ }
    if (id && /^[0-9a-f-]{36}$/.test(id)) {
      void fetch(`/api/motion/render/${id}?project_id=${projectId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(json).then(value => { if (!controller.signal.aborted) accept(value); }).catch(() => { if (!controller.signal.aborted) setError("The previous export could not be refreshed. Open the render queue to check it."); });
    }
    return () => controller.abort();
  }, [accept, projectId, storageKey]);

  useEffect(() => {
    if (!job || !activeRender(job.status)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void fetch(`/api/motion/render/${job.id}?project_id=${projectId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }).then(json).then(value => { if (!controller.signal.aborted) accept(value); }).catch(() => { if (!controller.signal.aborted) setError("Connection interrupted. Progress below is the last report from the worker; checking will continue."); });
    }, 1200);
    return () => { controller.abort(); clearInterval(timer); };
  }, [accept, job, projectId]);

  const submit = useCallback(async (input: RenderInput, output: OutputSettings, newExport = false) => {
    if (sending.current) return;
    sending.current = true; setSubmitting(true); setError(null);
    try {
      const content = { project_id: projectId, project_name: projectName, input, output };
      const fingerprint = await requestFingerprint(content);
      if (newExport || identity.current?.fingerprint !== fingerprint) identity.current = { fingerprint, key: crypto.randomUUID() };
      const request = RenderRequestSchema.parse({ ...content, idempotency_key: identity.current.key });
      try { sessionStorage.setItem(`${storageKey}.request`, JSON.stringify(identity.current)); } catch { /* In-memory identity still makes transport retries idempotent. */ }
      accept(await json(await fetch("/api/motion/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The export could not be submitted. Retry to safely check the same request."); }
    finally { sending.current = false; setSubmitting(false); }
  }, [accept, projectId, projectName, storageKey]);

  const change = useCallback(async (kind: "cancel" | "retry") => {
    if (!job || action) return;
    setAction(kind); setError(null);
    try {
      accept(await json(await fetch(`/api/motion/render/${job.id}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }), signal: AbortSignal.timeout(15000) })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The render action could not be completed."); }
    finally { setAction(null); }
  }, [accept, action, job, projectId]);

  return { job, error, submitting, action, submit, cancel: () => change("cancel"), retry: () => change("retry"), busy: submitting || Boolean(job && activeRender(job.status)) };
}
