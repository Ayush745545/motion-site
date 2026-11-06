"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMPTY_WORKSPACE, ProjectSchema, WorkspaceSchema, makeProject, type CreateProjectInput, type Project, type WorkspaceSettings, type WorkspaceState } from "./project-schema";
import { projectPatchFromTimeline, timelineFromLegacyPatch } from "./timeline-document";

export const WORKSPACE_STORAGE_KEY = "motion-dna.workspace.v1";
export const WORKSPACE_RECOVERY_KEY = "motion-dna.workspace.recovery";
export const WORKSPACE_SAVE_DELAY = 300;
const SETTINGS_KEY = "motion-dna.settings.v1";
const MIGRATED_IDS_KEY = "motion-dna.migrated-local-projects.v1";

export type LocalUser = { id: string; email: string };
type ProjectResponse = { id: string; revision: number; document: Project };
type WorkspaceContextValue = WorkspaceState & {
  user: LocalUser | null;
  authReady: boolean;
  hydrated: boolean;
  storageError: string | null;
  saving: boolean;
  selectProject: (id: string) => void;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryStorage: () => Promise<void>;
  flushStorage: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function messageFrom(response: Response, fallback: string) {
  return response.json().then((body: unknown) => {
    if (body && typeof body === "object") {
      const value = body as { error?: { message?: string }; detail?: string };
      return value.error?.message || value.detail || fallback;
    }
    return fallback;
  }).catch(() => fallback);
}

function readLocalSettings(): WorkspaceSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return WorkspaceSchema.parse({ ...EMPTY_WORKSPACE, settings: JSON.parse(stored) }).settings;
    const legacy = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (legacy) return WorkspaceSchema.parse(JSON.parse(legacy)).settings;
  } catch { /* Keep validated defaults when browser data is unreadable. */ }
  return EMPTY_WORKSPACE.settings;
}

function readLegacyProjects(): Project[] {
  try {
    const backup = localStorage.getItem(WORKSPACE_RECOVERY_KEY) ?? localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!backup) return [];
    return WorkspaceSchema.parse(JSON.parse(backup)).projects;
  } catch { return []; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const stateRef = useRef<WorkspaceState>(EMPTY_WORKSPACE);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const revisions = useRef(new Map<string, number>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingDocuments = useRef(new Map<string, Project>());
  const saveQueues = useRef(new Map<string, Promise<void>>());

  const commit = useCallback((next: WorkspaceState) => {
    const parsed = WorkspaceSchema.parse(next);
    stateRef.current = parsed;
    setState(parsed);
  }, []);

  const saveProject = useCallback(async (id: string): Promise<void> => {
    const document = pendingDocuments.current.get(id);
    const revision = revisions.current.get(id);
    if (!document || !revision) return;
    setSaving(true);
    const previous = saveQueues.current.get(id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const latest = pendingDocuments.current.get(id);
      const expected = revisions.current.get(id);
      if (!latest || !expected) return;
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: expected, document: latest }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await messageFrom(response, "The latest project changes could not be saved."));
      const result = await response.json() as { project: ProjectResponse };
      revisions.current.set(id, result.project.revision);
      if (pendingDocuments.current.get(id) === latest) pendingDocuments.current.delete(id);
      setStorageError(null);
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Project changes could not be saved.";
      setStorageError(message);
      throw error;
    }).finally(() => {
      if (saveQueues.current.get(id) === queued) saveQueues.current.delete(id);
      setSaving(saveQueues.current.size > 0 || saveTimers.current.size > 0);
    });
    saveQueues.current.set(id, queued);
    await queued;
  }, []);

  const installProjects = useCallback((records: ProjectResponse[], settings = stateRef.current.settings) => {
    const projects = records.map((record) => {
      const project = ProjectSchema.parse(record.document);
      revisions.current.set(project.id, record.revision);
      return project;
    });
    const active = stateRef.current.activeProjectId && projects.some((project) => project.id === stateRef.current.activeProjectId)
      ? stateRef.current.activeProjectId
      : projects[0]?.id ?? null;
    commit({ ...stateRef.current, version: 1, projects, activeProjectId: active, settings });
  }, [commit]);

  const loadAccountProjects = useCallback(async (account: LocalUser, allowMigration: boolean) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) throw new Error(await messageFrom(response, "Could not load your projects."));
    const body = await response.json() as { projects: ProjectResponse[] };
    let records = body.projects;
    if (allowMigration) {
      const drafts = readLegacyProjects();
      let migrated = new Set<string>();
      try { migrated = new Set(JSON.parse(localStorage.getItem(MIGRATED_IDS_KEY) || "[]") as string[]); } catch { /* Ignore a damaged migration marker. */ }
      for (const draft of drafts) {
        if (migrated.has(draft.id)) continue;
        try {
          const imported = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: draft }), cache: "no-store" });
          if (!imported.ok) throw new Error(await messageFrom(imported, "Local draft import failed."));
          const created = await imported.json() as { project: ProjectResponse };
          records = [...records, created.project];
          migrated.add(draft.id);
          localStorage.setItem(MIGRATED_IDS_KEY, JSON.stringify([...migrated]));
        } catch (error) {
          setStorageError(error instanceof Error ? `Signed in, but a saved local draft could not be imported: ${error.message}` : "A local draft could not be imported.");
          break;
        }
      }
      if (drafts.length && drafts.every((draft) => migrated.has(draft.id))) {
        localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        localStorage.removeItem(WORKSPACE_RECOVERY_KEY);
        localStorage.removeItem(MIGRATED_IDS_KEY);
      }
    }
    setUser(account);
    installProjects(records, readLocalSettings());
  }, [installProjects]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = readLocalSettings();
      const session = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (!session?.ok) {
        const legacy = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        if (legacy && !localStorage.getItem(WORKSPACE_RECOVERY_KEY)) localStorage.setItem(WORKSPACE_RECOVERY_KEY, legacy);
        commit({ ...EMPTY_WORKSPACE, settings });
        setAuthReady(true);
        setHydrated(true);
        return;
      }
      try {
        const data = await session.json() as { user: LocalUser };
        await loadAccountProjects(data.user, true);
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : "Your account workspace could not be loaded.");
        setUser(null);
        commit({ ...EMPTY_WORKSPACE, settings });
      } finally {
        if (!cancelled) { setAuthReady(true); setHydrated(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [commit, loadAccountProjects]);

  const selectProject = useCallback((id: string) => {
    const current = stateRef.current;
    if (current.projects.some((project) => project.id === id)) commit({ ...current, activeProjectId: id });
  }, [commit]);

  const createProject = useCallback(async (input: CreateProjectInput) => {
    if (!user) throw new Error("Sign in to create and save a project.");
    const draft = makeProject(input, stateRef.current.settings);
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: draft }), cache: "no-store" });
    if (!response.ok) throw new Error(await messageFrom(response, "The project could not be created."));
    const result = await response.json() as { project: ProjectResponse };
    const project = ProjectSchema.parse(result.project.document);
    revisions.current.set(project.id, result.project.revision);
    const current = stateRef.current;
    commit({ ...current, projects: [project, ...current.projects], activeProjectId: project.id });
    return project;
  }, [commit, user]);

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    const current = stateRef.current;
    const project = current.projects.find((entry) => entry.id === id);
    if (!project) return;
    const bridgedTimeline = timelineFromLegacyPatch(project, patch);
    const merged = { ...project, ...patch };
    const timelinePatch = bridgedTimeline ? projectPatchFromTimeline(merged, bridgedTimeline) : {};
    const updated = ProjectSchema.parse({ ...merged, ...timelinePatch, id: project.id, createdAt: project.createdAt, updatedAt: new Date().toISOString() });
    pendingDocuments.current.set(id, updated);
    commit({ ...current, projects: current.projects.map((entry) => entry.id === id ? updated : entry) });
    if (!user) { setStorageError("Sign in to save project edits. Your current changes remain in this tab."); return; }
    const timer = saveTimers.current.get(id);
    if (timer) clearTimeout(timer);
    saveTimers.current.set(id, setTimeout(() => {
      saveTimers.current.delete(id);
      void saveProject(id).catch(() => undefined);
    }, WORKSPACE_SAVE_DELAY));
    setSaving(true);
  }, [commit, saveProject, user]);

  const deleteProject = useCallback(async (id: string) => {
    if (!user) throw new Error("Sign in to delete a saved project.");
    const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store" });
    if (!response.ok) throw new Error(await messageFrom(response, "The project could not be deleted."));
    const current = stateRef.current;
    const projects = current.projects.filter((project) => project.id !== id);
    revisions.current.delete(id);
    pendingDocuments.current.delete(id);
    commit({ ...current, projects, activeProjectId: current.activeProjectId === id ? projects[0]?.id ?? null : current.activeProjectId });
  }, [commit, user]);

  const updateSettings = useCallback((patch: Partial<WorkspaceSettings>) => {
    const settings = { ...stateRef.current.settings, ...patch };
    commit({ ...stateRef.current, settings });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); setStorageError(null); }
    catch { setStorageError("Workspace preferences could not be saved in this browser."); }
  }, [commit]);

  const authenticate = useCallback(async (endpoint: "login" | "register", email: string, password: string) => {
    const response = await fetch(`/api/auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), cache: "no-store" });
    if (!response.ok) throw new Error(await messageFrom(response, "Account authentication failed."));
    const data = await response.json() as { user: LocalUser };
    await loadAccountProjects(data.user, true);
  }, [loadAccountProjects]);

  const signOut = useCallback(async () => {
    const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    if (!response.ok) throw new Error(await messageFrom(response, "Sign out could not be completed."));
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
    revisions.current.clear();
    pendingDocuments.current.clear();
    setUser(null);
    commit({ ...EMPTY_WORKSPACE, settings: stateRef.current.settings });
  }, [commit]);

  const retryStorage = useCallback(async () => {
    const pending = [...pendingDocuments.current.keys()];
    for (const id of pending) {
      const timer = saveTimers.current.get(id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(id);
    }
    await Promise.all(pending.map((id) => saveProject(id)));
  }, [saveProject]);
  const flushStorage = retryStorage;

  const value = useMemo<WorkspaceContextValue>(() => ({
    ...state, user, authReady, hydrated, storageError, saving,
    selectProject, createProject, updateProject, deleteProject, updateSettings,
    signIn: (email, password) => authenticate("login", email, password),
    register: (email, password) => authenticate("register", email, password),
    signOut, retryStorage, flushStorage,
  }), [state, user, authReady, hydrated, storageError, saving, selectProject, createProject, updateProject, deleteProject, updateSettings, authenticate, signOut, retryStorage, flushStorage]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return context;
}

export type { Project, Scene, WorkspaceSettings, CreateProjectInput } from "./project-schema";
