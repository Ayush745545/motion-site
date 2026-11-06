"use client";

import { useRef, useState, type FormEvent } from "react";
import { Archive, Braces, FileCode2, FileJson2, GitBranch, LoaderCircle } from "lucide-react";
import { SourceDNASchema, type SourceDNA } from "@motion-dna/dna-schema";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useWorkspace, type Project } from "@/lib/workspace";
import "./source-dna.css";

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;

async function parseResponse(response: Response): Promise<SourceDNA> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { detail?: string; error?: { message?: string } }).detail
      ?? (body as { error?: { message?: string } }).error?.message;
    throw new Error(message || "Source analysis failed. Check the input and try again.");
  }
  return SourceDNASchema.parse(body);
}

export function SourceDNAAnalysis({ project }: { project: Project }) {
  const { updateProject } = useWorkspace();
  const [result, setResult] = useState<SourceDNA | null>(project.sourceDNA ?? null);
  const [githubUrl, setGithubUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLInputElement>(null);

  async function submit(request: () => Promise<Response>) {
    setPending(true);
    setError(null);
    try {
      const next = await parseResponse(await request());
      setResult(next);
      updateProject(project.id, { sourceDNA: next });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Source analysis failed. Retry the request.");
    } finally {
      setPending(false);
    }
  }

  function analyzeGitHub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(() => fetch("/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_url: githubUrl.trim() }),
      signal: AbortSignal.timeout(30000),
    }));
  }

  async function analyzeZip(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip source archive.");
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setError("This archive is larger than the 20 MB upload limit.");
      return;
    }
    await submit(() => fetch("/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/zip", "X-Source-Filename": file.name.slice(0, 255) },
      body: file,
      signal: AbortSignal.timeout(30000),
    }));
  }

  function analyzeSavedFile() {
    if (project.sourceType !== "code") return;
    void submit(() => fetch("/api/source/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_name: project.sourceName || "source.tsx", source: project.source }),
      signal: AbortSignal.timeout(15000),
    }));
  }

  async function importLocalResult(file?: File) {
    if (!file) return;
    setError(null);
    try {
      if (file.size > MAX_RESULT_BYTES) throw new Error("The analysis JSON is larger than the 1 MB import limit.");
      const parsed: unknown = JSON.parse(await file.text());
      const signature = SourceDNASchema.parse(parsed);
      if (signature.source_type !== "local_directory") throw new Error("Choose JSON created by the trusted local-directory analyzer.");
      setResult(signature);
      updateProject(project.id, { sourceDNA: signature });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This local analysis JSON is invalid.");
    } finally {
      if (resultRef.current) resultRef.current.value = "";
    }
  }

  return <section className="source-dna" aria-labelledby="source-dna-title">
    <div className="analysis-section-heading source-dna-heading">
      <div><h2 id="source-dna-title">Code-derived DNA</h2><p>Inspect manifests and source files as data. Repository commands and lifecycle scripts are never run.</p></div>
    </div>
    <div className="source-dna-inputs">
      {project.sourceType === "code" && <article className="panel source-dna-input-card">
        <FileCode2 size={18}/><h3>Saved source file</h3><p>Analyze the single code file saved in this project draft.</p>
        <Button variant="outline" onClick={analyzeSavedFile} disabled={pending}><Braces size={15}/>Analyze saved file</Button>
      </article>}
      <form className="panel source-dna-input-card" onSubmit={analyzeGitHub}>
        <GitBranch size={18}/><h3>Public GitHub repository</h3><p>Only public repository metadata and its ZIP snapshot are fetched over HTTPS.</p>
        <Label htmlFor="source-github-url">Repository URL</Label><Input id="source-github-url" type="url" inputMode="url" placeholder="https://github.com/owner/repository" value={githubUrl} onChange={event => setGithubUrl(event.target.value)} required maxLength={2048} />
        <Button type="submit" variant="outline" disabled={pending || !githubUrl.trim()}><GitBranch size={15}/>Analyze repository</Button>
      </form>
      <article className="panel source-dna-input-card">
        <Archive size={18}/><h3>ZIP project</h3><p>Upload a source archive. Maximum 20 MB compressed, 50 MB expanded.</p>
        <input ref={zipRef} className="sr-only" type="file" accept=".zip,application/zip" aria-label="Choose source ZIP archive" onChange={event => { void analyzeZip(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <Button variant="outline" onClick={() => zipRef.current?.click()} disabled={pending}><Archive size={15}/>Choose ZIP file</Button>
      </article>
      <article className="panel source-dna-input-card">
        <FileJson2 size={18}/><h3>Trusted local directory</h3><p>Run the documented local CLI, then import its schema-validated JSON. It is not uploaded.</p>
        <input ref={resultRef} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose local source DNA JSON" onChange={event => { void importLocalResult(event.target.files?.[0]); }} />
        <Button variant="outline" onClick={() => resultRef.current?.click()} disabled={pending}><FileJson2 size={15}/>Import local DNA JSON</Button>
        <small>Imported report provenance is not cryptographically verified.</small>
      </article>
    </div>
    {pending && <p role="status" className="panel source-dna-status"><LoaderCircle size={16} className="source-dna-spinner"/>Inspecting project files without executing them…</p>}
    {error && <div className="panel source-dna-error" role="alert"><p>{error}</p><p>Analysis runs entirely through bounded static inspection. You can retry with a smaller ZIP or a public repository URL.</p></div>}
    {result && <div className="source-dna-result">
      <div className="source-dna-result-meta"><span><strong>{result.source_name}</strong> · {result.source_type.replaceAll("_", " ")} · schema {result.schema_version}</span><span>Confidence {Math.round(result.confidence * 100)}%</span></div>
      <section className="source-dna-summary-grid">
        <article className="panel source-dna-card"><span className="analysis-kicker">VERIFIED SUMMARY</span><h3>{result.product_summary || "No product description found"}</h3><p>{result.readme_summary || "No README summary was found in this source."}</p><p className="source-dna-category">Heuristic category · {result.product_category} · {Math.round(result.category_confidence * 100)}% confidence</p></article>
        <article className="panel source-dna-card"><span className="analysis-kicker">TECHNOLOGY FINGERPRINT</span><ul className="source-dna-list">{result.technology_fingerprint.map((item, index) => <li key={`${item.name}-${index}`}><strong>{item.name}</strong><span>{item.version || "version not declared"}</span><small>{item.evidence} · {Math.round(item.confidence * 100)}%</small></li>)}</ul><p>{result.dependencies.length} declared dependencies. No package install was run.</p></article>
        <article className="panel source-dna-card"><span className="analysis-kicker">STYLING & THEME TOKENS</span><div className="source-dna-chip-list">{result.styling_systems.map(item => <span key={item.name}>{item.name}</span>)}{!result.styling_systems.length && <span>Styling system not identified</span>}</div><div className="source-dna-token-list">{result.theme_tokens.slice(0, 24).map((token, index) => <div key={`${token.name}-${index}`}><span>{token.kind === "color" && token.value.startsWith("#") ? <i style={{ backgroundColor: token.value }} /> : null}<strong>{token.name}</strong></span><code>{token.value}</code></div>)}</div></article>
        <article className="panel source-dna-card"><span className="analysis-kicker">UI STRUCTURE</span><div className="source-dna-chip-list">{result.ui_components.slice(0, 24).map(component => <span key={component.path}>{component.exports[0] || component.path}</span>)}{!result.ui_components.length && <span>No component directory detected</span>}</div><h4>Routes ({result.routes.length})</h4><div className="source-dna-route-list">{result.routes.slice(0, 32).map(route => <span key={`${route.kind}-${route.path}`}><code>{route.path}</code><small>{route.kind}</small></span>)}{!result.routes.length && <small>No static page routes detected.</small>}</div></article>
        <article className="panel source-dna-card"><span className="analysis-kicker">MOTION OPPORTUNITIES</span><div className="source-dna-chip-list">{result.animation_libraries.map(item => <span key={item.name}>{item.name}</span>)}{!result.animation_libraries.length && <span>No animation library declared</span>}</div>{result.motion_opportunities.map((item, index) => <p key={index}>{item.suggestion}<small>Evidence: {item.evidence.join(", ") || "static source inspection"}</small></p>)}</article>
        <article className="panel source-dna-card"><span className="analysis-kicker">SOURCE ASSETS</span>{result.assets.length ? <ul className="source-dna-assets">{result.assets.slice(0, 24).map(asset => <li key={asset.path}><code>{asset.path}</code><span>{asset.kind.replaceAll("_", " ")}</span><small>Unavailable to render until explicitly imported</small></li>)}</ul> : <p>No logo or image assets were found.</p>}<p>Assets are path references only. Their contents are not decoded, retained, or sent to the renderer.</p></article>
      </section>
      <section className="panel source-dna-story"><div><span className="analysis-kicker">STATICALLY GENERATED STORYBOARD</span><p>{result.storyboard.creative_concept}</p><small>{result.storyboard.model} · confidence {Math.round(result.storyboard.confidence * 100)}% · deterministic fallback</small></div><ol>{result.storyboard.scenes.map(scene => <li key={scene.id}><span>{scene.id}</span><strong>{scene.headline}</strong><p>{scene.description}</p><small>{scene.motion_preset} · evidence: {scene.evidence.join(", ") || "none found"}</small></li>)}</ol><p className="source-dna-caveat">{result.storyboard.cta}. This storyboard uses static evidence only; visual assets are unavailable for rendering.</p></section>
      <details className="panel source-dna-warnings"><summary>Analysis limits ({result.warnings.length})</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>
    </div>}
  </section>;
}
