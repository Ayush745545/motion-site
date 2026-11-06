import { DNAResultSchema, SourceDNASchema, StoryboardSchema } from "@motion-dna/dna-schema";
import { z } from "zod";
import { VideoDraftSchema } from "@motion-dna/motion-engine/schema";
import { ProjectDocumentSchema } from "@motion-dna/motion-engine/project";
import { timelineFromProject } from "./timeline-document";

export const MAX_PROJECTS = 100;
export const MAX_SOURCE_BYTES = 256 * 1024;
export const RESOLUTIONS = ["1920x1080", "1080x1920", "1080x1080"] as const;
export const FRAME_RATES = [24, 30, 60] as const;

export const ResolutionSchema = z.enum(RESOLUTIONS);
export const FrameRateSchema = z.union([z.literal(24), z.literal(30), z.literal(60)]);
const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "Choose a six-digit hex color.");

export function isWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export const SceneSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  headline: z.string().max(180),
  subline: z.string().max(360),
  duration: z.number().min(1 / 60).max(300),
  background: ColorSchema,
  foreground: ColorSchema,
  accent: ColorSchema,
  fontFamily: z.enum(["sans", "serif", "mono"]),
  fontSize: z.number().min(24).max(120),
  animation: z.enum(["fade", "slide", "scale"]),
  align: z.enum(["left", "center"]),
});

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, "Give your project a name.").max(80, "Use 80 characters or fewer."),
  sourceType: z.enum(["url", "code"]),
  source: z.string().min(1, "Add a website URL or source code.").max(MAX_SOURCE_BYTES, "Source files must be 256 KB or smaller."),
  sourceName: z.string().max(255).optional(),
}).superRefine((value, context) => {
  if (value.sourceType === "url" && !isWebsiteUrl(value.source.trim())) {
    context.addIssue({ code: "custom", path: ["source"], message: "Enter a complete HTTP or HTTPS URL without a username or password." });
  }
  if (value.sourceType === "code" && (!value.source.trim() || new TextEncoder().encode(value.source).length > MAX_SOURCE_BYTES)) {
    context.addIssue({ code: "custom", path: ["source"], message: "Add source code up to 256 KB." });
  }
});

export const ProjectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  sourceType: z.enum(["url", "code"]),
  source: z.string().min(1).max(MAX_SOURCE_BYTES),
  sourceName: z.string().max(255).optional(),
  dnaJobId: z.uuid().optional(),
  videoDraft: VideoDraftSchema.optional(),
  storyboard: StoryboardSchema.optional(),
  websiteDNA: DNAResultSchema.optional(),
  sourceDNA: SourceDNASchema.optional(),
  timeline: ProjectDocumentSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolution: ResolutionSchema,
  fps: FrameRateSchema,
  scenes: z.array(SceneSchema).min(1).max(12),
  activeSceneId: z.string().min(1),
}).superRefine((project, context) => {
  if (!project.scenes.some((scene) => scene.id === project.activeSceneId)) {
    context.addIssue({ code: "custom", path: ["activeSceneId"], message: "Choose an existing scene." });
  }
  if (new Set(project.scenes.map((scene) => scene.id)).size !== project.scenes.length) {
    context.addIssue({ code: "custom", path: ["scenes"], message: "Scene IDs must be unique." });
  }
  if (project.sourceType === "url" && !isWebsiteUrl(project.source)) {
    context.addIssue({ code: "custom", path: ["source"], message: "The saved website URL is invalid." });
  }
  if (new TextEncoder().encode(project.source).length > MAX_SOURCE_BYTES) {
    context.addIssue({ code: "custom", path: ["source"], message: "The saved source exceeds 256 KB." });
  }
});

export const WorkspaceSettingsSchema = z.object({
  defaultResolution: ResolutionSchema,
  defaultFps: FrameRateSchema,
  reducedMotion: z.boolean(),
});

export const WorkspaceSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema).max(MAX_PROJECTS),
  activeProjectId: z.string().nullable(),
  settings: WorkspaceSettingsSchema,
}).superRefine((workspace, context) => {
  if (new Set(workspace.projects.map((project) => project.id)).size !== workspace.projects.length) {
    context.addIssue({ code: "custom", path: ["projects"], message: "Project IDs must be unique." });
  }
  if (workspace.activeProjectId && !workspace.projects.some((project) => project.id === workspace.activeProjectId)) {
    context.addIssue({ code: "custom", path: ["activeProjectId"], message: "The active project was not found." });
  }
});

export type Scene = z.infer<typeof SceneSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
export type WorkspaceState = z.infer<typeof WorkspaceSchema>;

export const DEFAULT_SETTINGS: WorkspaceSettings = { defaultResolution: "1920x1080", defaultFps: 30, reducedMotion: false };
export const EMPTY_WORKSPACE: WorkspaceState = { version: 1, projects: [], activeProjectId: null, settings: DEFAULT_SETTINGS };

export function makeProject(input: CreateProjectInput, settings: WorkspaceSettings = DEFAULT_SETTINGS): Project {
  const parsed = CreateProjectSchema.parse(input);
  const now = new Date().toISOString();
  const base: Omit<Scene, "id" | "name" | "headline" | "subline"> = { duration: 4, background: "#101216", foreground: "#F5F5F5", accent: "#2563EB", fontFamily: "sans", fontSize: 68, animation: "fade", align: "center" };
  const scenes: Scene[] = [
    { ...base, id: crypto.randomUUID(), name: "Opening", headline: parsed.name, subline: "Your story starts here." },
    { ...base, id: crypto.randomUUID(), name: "The story", headline: "Designed to move.", subline: "Add the message that makes your project yours.", animation: "slide" },
    { ...base, id: crypto.randomUUID(), name: "Call to action", headline: "Make your next move.", subline: "Edit this scene to add your call to action.", animation: "scale" },
  ];
  const project = ProjectSchema.parse({ ...parsed, source: parsed.sourceType === "url" ? parsed.source.trim() : parsed.source, id: crypto.randomUUID(), createdAt: now, updatedAt: now, resolution: settings.defaultResolution, fps: settings.defaultFps, scenes, activeSceneId: scenes[0]?.id });
  return ProjectSchema.parse({ ...project, timeline: timelineFromProject(project) });
}
