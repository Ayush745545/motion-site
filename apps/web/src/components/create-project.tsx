"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Code2, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateProjectSchema, MAX_PROJECTS, MAX_SOURCE_BYTES } from "@/lib/project-schema";
import { useWorkspace } from "@/lib/workspace";

const ACCEPTED_EXTENSIONS = new Set(["txt", "js", "jsx", "ts", "tsx", "html", "css", "json", "md"]);

export function CreateProject() {
  const router = useRouter();
  const { createProject, hydrated, projects, settings, user } = useWorkspace();
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"url" | "code">("url");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [code, setCode] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [readingFile, setReadingFile] = useState(false);
  const [creating, setCreating] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLTextAreaElement>(null);
  const fileReadVersion = useRef(0);
  const atCapacity = projects.length >= MAX_PROJECTS;

  async function readSourceFile(file: File | undefined) {
    if (!file) return;
    const readVersion = ++fileReadVersion.current;
    setReadingFile(false);
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (!extension || !ACCEPTED_EXTENSIONS.has(extension)) {
      setErrors({ source: "Choose a text, JavaScript, TypeScript, HTML, CSS, JSON, or Markdown file." });
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setErrors({ source: "Choose a source file no larger than 256 KB." });
      return;
    }
    setReadingFile(true);
    setErrors({});
    try {
      const content = await file.text();
      if (readVersion !== fileReadVersion.current) return;
      if (!content.trim()) {
        setErrors({ source: "The selected file is empty. Choose a file with source code." });
        return;
      }
      setCode(content);
      setFileName(file.name);
    } catch {
      if (readVersion === fileReadVersion.current)
        setErrors({ source: "This file couldn't be read. Try choosing it again or paste its contents below." });
    } finally {
      if (readVersion === fileReadVersion.current) setReadingFile(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hydrated || readingFile || creating || atCapacity) return;
    const parsed = CreateProjectSchema.safeParse({
      name,
      sourceType,
      source: sourceType === "url" ? websiteUrl : code,
      ...(sourceType === "code" && fileName ? { sourceName: fileName } : {}),
    });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      if (nextErrors.name) nameInput.current?.focus();
      else if (sourceType === "url") urlInput.current?.focus();
      else codeInput.current?.focus();
      return;
    }
    setErrors({});
    setCreating(true);
    try {
      const project = await createProject(parsed.data);
      router.push(`/studio?project=${encodeURIComponent(project.id)}`);
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "The draft couldn't be created. Try again." });
      setCreating(false);
    }
  }

  return <div className="create-page page-content"><div className="page-heading"><div><p className="page-kicker">A NEW STORY STARTS HERE</p><h1>Create a project</h1><p className="muted">A name, a source, and room to make it your own.</p></div></div>
    <div className="create-layout"><form className="panel form-panel" onSubmit={submit} noValidate>
      <div className="form-section-heading"><span className="form-section-number"><Sparkles size={18}/></span><div><h2>The essentials</h2><p className="muted">You can fine-tune the details as you go.</p></div></div>
      <div className="field"><Label htmlFor="project-name">Project name</Label><Input ref={nameInput} id="project-name" name="name" value={name} onChange={e=>setName(e.target.value)} maxLength={80} placeholder="e.g. Studio launch film" autoComplete="off" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name?"project-name-error":undefined}/>{errors.name&&<p id="project-name-error" className="form-error">{errors.name}</p>}</div>
      <div className="field"><Label>Choose your source</Label><div className="source-choice-grid" role="group" aria-label="Source type">{([{value:"url",title:"Website URL",detail:"Start with your website",icon:Globe},{value:"code",title:"Source code",detail:"Bring your own source",icon:Code2}] as const).map(({value,title,detail,icon:Icon})=><button key={value} type="button" className={`source-choice ${sourceType===value?"is-selected":""}`} aria-pressed={sourceType===value} onClick={()=>{setSourceType(value);setErrors({});}}><span className="source-choice-icon"><Icon size={17}/></span><span><strong>{title}</strong><small>{detail}</small></span><span className="source-choice-radio"/></button>)}</div></div>
      {sourceType==="url"?<div className="field"><Label htmlFor="website-url">Website URL</Label><div className="url-input-wrap"><span><Globe size={15}/></span><Input ref={urlInput} id="website-url" type="url" name="url" value={websiteUrl} onChange={e=>setWebsiteUrl(e.target.value)} placeholder="https://your-website.com" autoComplete="url" spellCheck={false} aria-invalid={Boolean(errors.source)} aria-describedby={errors.source?"source-error":"source-help"}/></div><p id="source-help" className="field-help">Create your project first. Capture your website when you’re ready in DNA analysis.</p></div>:<div className="field"><Label htmlFor="source-file">Choose a source file</Label><div className="source-upload"><Code2 size={24}/><strong>{fileName??"Give your code a creative home"}</strong><p className="muted">Text, JS, TS, HTML, CSS, JSON or Markdown · up to 256 KB</p><input id="source-file" type="file" accept=".txt,.js,.jsx,.ts,.tsx,.html,.css,.json,.md" onChange={e=>void readSourceFile(e.target.files?.[0])}/><small className="field-help">Source text is saved with your project and analyzed as data. Repository code is never run.</small></div><Label htmlFor="source-code">Source code</Label><textarea ref={codeInput} id="source-code" className="code-input" value={code} onChange={e=>setCode(e.target.value)} placeholder="Or paste your source code here…" rows={7} spellCheck={false} aria-invalid={Boolean(errors.source)} aria-describedby={errors.source?"source-error":undefined}/>{readingFile&&<p role="status" className="field-help">Reading your file…</p>}</div>}
      {errors.source&&<p id="source-error" className="form-error" role="alert">{errors.source}</p>}
      {!user&&<div className="form-notice"><ShieldCheck size={18}/><div><strong>Sign in to save your project.</strong><p>Your project and exports are stored in your private local account. Sign in to continue.</p><Button asChild size="sm"><Link href="/login">Create a local account or sign in<ArrowRight size={14}/></Link></Button></div></div>}
      <div className="form-notice"><Sparkles size={18}/><div><strong>Start simple. Make it your own.</strong><p>Your draft begins with three editable scenes. Capture your website’s DNA, or shape the scenes by hand in the studio.</p></div></div>
      <div aria-live="polite">{errors.form&&<p className="form-error" role="alert">{errors.form}</p>}{atCapacity&&<p className="form-error">This account has 100 projects. Delete an unused project before creating another.</p>}</div>
      <div className="form-actions"><Button asChild variant="ghost"><Link href="/">Cancel</Link></Button><Button type="submit" disabled={!hydrated||!user||readingFile||creating||atCapacity}>{!hydrated?"Loading workspace…":!user?"Sign in to create":creating?"Saving project…":"Create project"}<ArrowRight size={15}/></Button></div>
    </form><aside className="create-aside"><div className="panel project-preview-card"><p className="page-kicker">A LITTLE SPACE TO CREATE</p><div className="create-preview-art" aria-hidden="true"><div/><span>Your idea.<br/><i>Your next move.</i></span><i>✦</i></div><h3>From source to story.</h3><p className="muted">A flexible starting point for the video you want to make.</p><ul className="project-benefits"><li><span>✓</span> Three editable starter scenes</li><li><span>✓</span> Drafts saved as you work</li><li><span>✓</span> Your colors, your typography</li></ul><div className="project-defaults"><span>Starting format</span><strong>{settings.defaultResolution.replace("x"," × ")} · {settings.defaultFps} fps</strong><Link href="/settings">Change defaults ↗</Link></div></div><p className="create-local-note"><ShieldCheck size={16}/>Website capture runs only when you choose to analyze. Source code stays static and is never executed.</p></aside></div>
  </div>;
}
