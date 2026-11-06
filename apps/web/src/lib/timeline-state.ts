"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectDocumentSchema, type ProjectDocument } from "@motion-dna/motion-engine/project";
import type { Project } from "./project-schema";
import { useWorkspace } from "./workspace";
import { projectPatchFromTimeline, timelineFromProject } from "./timeline-document";

export { projectPatchFromTimeline, timelineFromProject } from "./timeline-document";
export const TIMELINE_HISTORY_LIMIT = 50;

export type TimelineHistory = {
  projectId: string;
  past: ProjectDocument[];
  present: ProjectDocument;
  future: ProjectDocument[];
  group: string | null;
};

const equalDocuments = (a: ProjectDocument, b: ProjectDocument) => JSON.stringify(a) === JSON.stringify(b);

export function createTimelineHistory(projectId: string, document: ProjectDocument): TimelineHistory {
  return { projectId, past: [], present: ProjectDocumentSchema.parse(document), future: [], group: null };
}

export function commitTimelineHistory(history: TimelineHistory, document: ProjectDocument, group?: string): TimelineHistory {
  const next = ProjectDocumentSchema.parse(document);
  if (equalDocuments(history.present, next)) return history;
  const coalesce = Boolean(group) && history.group === group;
  return {
    ...history,
    past: coalesce ? history.past : [...history.past, history.present].slice(-TIMELINE_HISTORY_LIMIT),
    present: next,
    future: [],
    group: group ?? null,
  };
}

export function undoTimelineHistory(history: TimelineHistory): TimelineHistory {
  const previous = history.past.at(-1);
  if (!previous) return { ...history, group: null };
  return { ...history, past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], group: null };
}

export function redoTimelineHistory(history: TimelineHistory): TimelineHistory {
  const next = history.future[0];
  if (!next) return { ...history, group: null };
  return { ...history, past: [...history.past, history.present].slice(-TIMELINE_HISTORY_LIMIT), present: next, future: history.future.slice(1), group: null };
}

/** The workspace document drives both Player and export; history stores snapshots only. */
export function useTimelineProject(project: Project) {
  const { updateProject } = useWorkspace();
  const document = useMemo(() => timelineFromProject(project), [project]);
  const projectRef = useRef(project);
  const [history, setHistory] = useState(() => createTimelineHistory(project.id, document));
  const historyRef = useRef(history);

  useEffect(() => {
    projectRef.current = project;
    if (historyRef.current.projectId !== project.id || !equalDocuments(historyRef.current.present, document)) {
      const next = createTimelineHistory(project.id, document);
      historyRef.current = next;
    }
    if (!project.timeline) updateProject(project.id, projectPatchFromTimeline(project, document));
  }, [document, project, updateProject]);

  const applyHistory = useCallback((next: TimelineHistory) => {
    historyRef.current = next;
    setHistory(next);
    updateProject(next.projectId, projectPatchFromTimeline(projectRef.current, next.present));
  }, [updateProject]);

  const commitDocument = useCallback((next: ProjectDocument, historyGroup?: string) => {
    const current = historyRef.current.projectId === projectRef.current.id
      ? historyRef.current
      : createTimelineHistory(projectRef.current.id, timelineFromProject(projectRef.current));
    const updated = commitTimelineHistory(current, next, historyGroup);
    if (updated !== current) applyHistory(updated);
  }, [applyHistory]);

  const endHistoryGroup = useCallback(() => {
    if (!historyRef.current.group) return;
    const next = { ...historyRef.current, group: null };
    historyRef.current = next;
    setHistory(next);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.projectId !== projectRef.current.id || !historyRef.current.past.length) return;
    applyHistory(undoTimelineHistory(historyRef.current));
  }, [applyHistory]);

  const redo = useCallback(() => {
    if (historyRef.current.projectId !== projectRef.current.id || !historyRef.current.future.length) return;
    applyHistory(redoTimelineHistory(historyRef.current));
  }, [applyHistory]);

  const matchesProject = history.projectId === project.id && equalDocuments(history.present, document);
  return {
    document,
    commitDocument,
    endHistoryGroup,
    undo,
    redo,
    canUndo: matchesProject && history.past.length > 0,
    canRedo: matchesProject && history.future.length > 0,
  };
}
