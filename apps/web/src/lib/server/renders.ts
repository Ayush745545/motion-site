import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getServerEnv } from "@motion-dna/config";
import { RenderRequestSchema } from "@motion-dna/motion-engine/render-request";
import { LocalRenderQueueSchema, RenderJobSchema, type LocalRenderJob } from "@motion-dna/motion-engine/jobs";
import { validateRasterDataURL } from "./image-data";

export class RenderServiceError extends Error { constructor(message: string, public status = 503) { super(message); } }
export function workspaceRoot() { let current = process.cwd(); while (!existsSync(path.join(current, "pnpm-workspace.yaml"))) { const parent = path.dirname(current); if (parent === current) throw new Error("Workspace not found"); current = parent; } return current; }
export function renderDirectory() { const directory = path.join(workspaceRoot(), "storage/renders"); mkdirSync(directory, { recursive: true }); return directory; }
export function jobDirectory(id: string) { z.uuid().parse(id); return path.join(renderDirectory(), id); }
export function legacyJob(id: string, projectId?: string): LocalRenderJob | null {
  const file = path.join(jobDirectory(id), "job.json"); if (!existsSync(file)) return null;
  const result = RenderJobSchema.safeParse(JSON.parse(readFileSync(file, "utf8"))); if (!result.success) return null;
  if (projectId && result.data.project_id !== projectId) return null;
  return result.data;
}
export async function renderAPI(endpoint: string, init?: RequestInit, cookie?: string | null, origin?: string | null) {
  try {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set("cookie", cookie);
    if (origin) headers.set("origin", origin);
    return await fetch(`${getServerEnv().API_BASE_URL}/api/render/jobs${endpoint}`, { ...init, headers, redirect: "error", cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(15000) });
  }
  catch { throw new RenderServiceError("The render API is unavailable. Start PostgreSQL, the API, and the render worker."); }
}
async function responseJob(response: Response) {
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { message?: string } };
    throw new RenderServiceError(error.error?.message?.slice(0, 300) ?? "The render request could not be completed.", response.status);
  }
  return RenderJobSchema.parse(data);
}
export async function startRender(input: unknown, cookie?: string | null, origin?: string | null) {
  const request = RenderRequestSchema.parse(input);
  if ("document" in request.input) { for (const asset of request.input.document.assets) validateRasterDataURL(asset.src); }
  else if (request.input.screenshot !== "sample") validateRasterDataURL(request.input.screenshot);
  return responseJob(await renderAPI("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }, cookie, origin));
}
export async function readJob(id: string, projectId?: string, cookie?: string | null, origin?: string | null) {
  z.uuid().parse(id); if (projectId) z.uuid().parse(projectId);
  const response = await renderAPI(`/${id}${projectId ? `?project_id=${projectId}` : ""}`, undefined, cookie, origin);
  if (response.status === 404) return null;
  return responseJob(response);
}
export async function listJobs(cookie?: string | null, origin?: string | null) {
  const response = await renderAPI("", undefined, cookie, origin); if (!response.ok) throw new RenderServiceError("The durable render queue is unavailable.", response.status);
  return LocalRenderQueueSchema.parse(await response.json()).jobs;
}
export async function controlRender(id: string, action: "cancel" | "retry", projectId: string, cookie?: string | null, origin?: string | null) {
  z.uuid().parse(id); z.uuid().parse(projectId);
  return responseJob(await renderAPI(`/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId }) }, cookie, origin));
}

export async function deleteRenderExport(id: string, projectId: string, cookie?: string | null, origin?: string | null) {
  z.uuid().parse(id); z.uuid().parse(projectId);
  const response = await renderAPI(`/${id}/export?project_id=${projectId}`, { method: "DELETE" }, cookie, origin);
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = data as { error?: { message?: string } };
    throw new RenderServiceError(error.error?.message?.slice(0, 300) ?? "The export could not be removed.", response.status);
  }
  return data;
}
