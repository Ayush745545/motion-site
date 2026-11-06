"use client";

import { useEffect, useState } from "react";
import { Check, HardDrive, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ServiceStatus } from "@/components/service-status";
import { DEFAULT_SETTINGS, FRAME_RATES, RESOLUTIONS, type WorkspaceSettings } from "@/lib/project-schema";
import { useWorkspace } from "@/lib/workspace";

type AccountUsage = { projects: number; used_bytes: number; quota_bytes: number };
type AccountUsageState = { userId: string; attempt: number; value?: AccountUsage; error?: string };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

export function SettingsPage() {
  const { settings, updateSettings, hydrated, storageError, retryStorage, projects, user } = useWorkspace();
  const userId = user?.id;
  const [confirmation, setConfirmation] = useState("");
  const [usageState, setUsageState] = useState<AccountUsageState | null>(null);
  const [usageAttempt, setUsageAttempt] = useState(0);
  const usageResult = usageState && usageState.userId === userId && usageState.attempt === usageAttempt ? usageState : null;
  const usage = usageResult?.value ?? null;
  const usageError = usageResult?.error ?? "";

  useEffect(() => {
    if (!userId) return;
    const requestUserId = userId;
    const controller = new AbortController();
    void fetch("/api/account/usage", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Account storage usage is unavailable.");
        return await response.json() as AccountUsage;
      })
      .then(value => { setUsageState({ userId: requestUserId, attempt: usageAttempt, value }); })
      .catch(error => {
        if (!controller.signal.aborted) setUsageState({
          userId: requestUserId,
          attempt: usageAttempt,
          error: error instanceof Error ? error.message : "Account storage usage is unavailable.",
        });
      });
    return () => controller.abort();
  }, [userId, projects.length, usageAttempt]);

  function update(patch: Partial<WorkspaceSettings>) {
    updateSettings(patch);
    setConfirmation("Preferences updated.");
    setTimeout(() => setConfirmation(""), 3000);
  }

  return <div className="settings-page page-content">
    <div className="page-heading"><div><p className="page-kicker">SETTLE INTO YOUR WORKSPACE</p><h1>Settings</h1><p className="muted">Thoughtful defaults. A workspace that feels like yours.</p></div><span className="local-label">PRIVATE LOCAL ACCOUNT</span></div>
    {!hydrated ? <div className="panel settings-card" role="status">Loading your preferences…</div> : <div className="settings-grid">
      <section className="panel settings-card">
        <div className="settings-section-heading"><span className="settings-section-icon"><Sliders size={18}/></span><div><h2>Project preferences</h2><p className="muted">New projects start here. Existing projects keep their settings.</p></div></div>
        <div className="field-grid">
          <div className="field"><Label htmlFor="default-resolution">Default resolution</Label><select id="default-resolution" value={settings.defaultResolution} onChange={e => update({ defaultResolution: e.target.value as WorkspaceSettings["defaultResolution"] })}>{RESOLUTIONS.map(value => <option key={value} value={value}>{value === "1920x1080" ? "Landscape" : value === "1080x1920" ? "Portrait" : "Square"} · {value.replace("x", " × ")}</option>)}</select><p className="field-help">Choose a starting shape for your canvas.</p></div>
          <div className="field"><Label htmlFor="default-frame-rate">Default frame rate</Label><select id="default-frame-rate" value={settings.defaultFps} onChange={e => update({ defaultFps: Number(e.target.value) as WorkspaceSettings["defaultFps"] })}>{FRAME_RATES.map(value => <option key={value} value={value}>{value} frames per second</option>)}</select><p className="field-help">Saved with each new manual composition.</p></div>
        </div>
        <div className="preference-row"><div><Label htmlFor="reduced-motion">Reduce interface motion</Label><p className="muted">Keep transitions gentle and previews still until played.</p></div><input id="reduced-motion" className="switch-control" type="checkbox" role="switch" checked={settings.reducedMotion} onChange={e => update({ reducedMotion: e.target.checked })}/></div>
        <div className="settings-card-footer"><span className="settings-success" role="status">{confirmation || "Device preferences save in this browser."}</span><Button variant="outline" size="sm" onClick={() => { updateSettings(DEFAULT_SETTINGS); setConfirmation("Default preferences restored."); }}>Reset preferences</Button></div>
      </section>
      <section className="panel settings-card storage-card">
        <div className="settings-section-heading"><span className="settings-section-icon"><HardDrive size={18}/></span><div><h2>Your local account</h2><p className="muted">Projects and exports saved on this machine.</p></div></div>
        <div className="storage-stat"><strong>{String(usage?.projects ?? projects.length).padStart(2, "0")}</strong><span>saved projects<small>of 100 available in this account</small></span></div>
        <p className="muted storage-description">{usage ? `${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)} storage used by private images and completed exports.` : usageError || "Checking private image and export storage…"}</p>
        <div className={`storage-state ${storageError || usageError ? "has-error" : ""}`}><Check size={14}/><strong>{storageError || (usageError ? "Storage usage could not be loaded" : "Project changes save automatically")}</strong></div>
        {storageError && <><p className="form-error" role="alert">{storageError}</p><Button variant="outline" size="sm" onClick={() => void retryStorage()}>Retry saving</Button></>}
        {usageError && <Button variant="outline" size="sm" onClick={() => setUsageAttempt(value => value + 1)}>Retry usage check</Button>}
      </section>
    </div>}
    <ServiceStatus/>
  </div>;
}
