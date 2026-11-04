import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { buildTimeline, fmtTime, type Look, resolveLook, type Timeline } from "../film/resolve";
import type { Meta, Project } from "../types";
import { go } from "./App";
import { BrandPanel } from "./panels/Brand";
import { BriefPanel } from "./panels/Brief";
import { ExportPanel } from "./panels/Export";
import { MediaPanel } from "./panels/Media";
import { StoryPanel } from "./panels/Story";
import { StylePanel } from "./panels/Style";
import { Player } from "./Player";
import { Icon, Mark } from "./ui";

export interface StudioCtx {
  project: Project;
  meta: Meta;
  look: Look;
  timeline: Timeline;
  /** Change the project now; it saves itself shortly after. */
  update: (patch: Partial<Project>) => void;
  /** Take a project the server returned, keeping any edits not saved yet. */
  replace: (p: Project) => void;
  refresh: () => Promise<void>;
  selected: string | null;
  select: (sceneId: string | null, seek?: boolean) => void;
  time: number;
  seek: (t: number) => void;
  setTab: (t: Tab) => void;
}

const Ctx = createContext<StudioCtx>(null as unknown as StudioCtx);
export const useStudio = () => useContext(Ctx);

type Tab = "brief" | "style" | "story" | "media" | "brand" | "export";
const TABS: { id: Tab; label: string; done: (p: Project) => boolean }[] = [
  { id: "brief", label: "Brief", done: (p) => !!p.brief.product && p.messages.length > 0 },
  { id: "style", label: "Style", done: (p) => p.references.some((r) => r.status === "ready") },
  { id: "story", label: "Story", done: (p) => p.scenes.length > 0 },
  { id: "media", label: "Media", done: (p) => p.assets.some((a) => a.kind === "image" || a.kind === "video") },
  { id: "brand", label: "Brand", done: (p) => !!p.brand.logo || !!p.brand.watermark.text },
  { id: "export", label: "Render", done: (p) => p.renders.length > 0 },
];
const SAVED_KEYS = ["name", "brief", "messages", "mix", "settings", "brand", "scenes"] as const;

export function Studio({ id, meta }: { id: string; meta: Meta }) {
  const [project, setProject] = useState<Project | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [selected, setSelected] = useState<string | null>(null);
  // Paused a second in, so the preview shows a frame with the look on it rather than a blank first frame.
  const [time, setTime] = useState(1.2);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const pending = useRef<Partial<Project>>({});
  const timer = useRef<number>(0);

  const replace = useCallback((fresh: Project) => setProject(() => ({ ...fresh, ...pending.current })), []);
  const save = useCallback(async () => {
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    setSaving("saving");
    try {
      replace(await api.patch(id, body));
      setSaving("saved");
    } catch {
      pending.current = { ...body, ...pending.current };
      setSaving("idle");
    }
  }, [id, replace]);
  const update = useCallback(
    (patch: Partial<Project>) => {
      setProject((p) => (p ? { ...p, ...patch } : p));
      for (const k of SAVED_KEYS) if (k in patch) (pending.current as Record<string, unknown>)[k] = patch[k];
      clearTimeout(timer.current);
      timer.current = window.setTimeout(save, 450);
    },
    [save],
  );
  const refresh = useCallback(async () => replace(await api.project(id)), [id, replace]);

  useEffect(() => {
    api.project(id).then((p) => {
      setProject(p);
      if (p.scenes.length) setTab("story");
    }, () => go("/"));
    const flush = () => save();
    addEventListener("beforeunload", flush);
    return () => { removeEventListener("beforeunload", flush); save(); };
  }, [id, save]);

  // While references are being analysed, keep the cards fresh.
  const analysing = project?.references.some((r) => r.status === "queued" || r.status === "analysing");
  useEffect(() => {
    if (!analysing) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [analysing, refresh]);

  const look = useMemo(() => (project ? resolveLook(project) : null), [project]);
  const timeline = useMemo(() => (project && look ? buildTimeline(project, look) : null), [project, look]);

  const select = useCallback(
    (sceneId: string | null, seek = true) => {
      setSelected(sceneId);
      const s = timeline?.scenes.find((x) => x.id === sceneId);
      if (s && seek) setTime(Math.min(s.end - 0.05, s.start + Math.min(1.2, (s.end - s.start) * 0.5)));
    },
    [timeline],
  );

  if (!project || !look || !timeline) return null;
  const ctx: StudioCtx = { project, meta, look, timeline, update, replace, refresh, selected, select, time, seek: setTime, setTab };
  const Panel = { brief: BriefPanel, style: StylePanel, story: StoryPanel, media: MediaPanel, brand: BrandPanel, export: ExportPanel }[tab];

  return (
    <Ctx.Provider value={ctx}>
      <div className="studio">
        <header className="topbar">
          <button className="btn ghost icon" title="All reels" onClick={() => go("/")}><Icon name="back" size={18} /></button>
          <Mark size={24} />
          <input className="input bare name" value={project.name} onChange={(e) => update({ name: e.target.value })} aria-label="Reel name" />
          <span className="saved">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}</span>
          <span className="grow" />
          <span className={`director${meta.director === "scripted" ? " scripted" : ""}`} title={meta.director === "claude" ? "Claude writes and reads the style" : "Offline: set ANTHROPIC_API_KEY to direct with Claude"}>
            <i /> {meta.director === "claude" ? `Directed by ${meta.model}` : "Scripted director (offline)"}
          </span>
          <span className="muted small">{project.settings.aspect} · {fmtTime(timeline.duration)}</span>
          <button className="btn primary" onClick={() => setTab("export")}><Icon name="export" size={16} /> Render</button>
        </header>
        <div className="body">
          <nav className="nav">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                <Icon name={t.id} />
                {t.label}
                {t.done(project) && <span className="dot" />}
              </button>
            ))}
          </nav>
          <aside className="panel" key={tab}><Panel /></aside>
          <Player />
        </div>
      </div>
    </Ctx.Provider>
  );
}

export const PanelHead = ({ title, text }: { title: string; text: string }) => (
  <div className="panel-head"><h2>{title}</h2><p>{text}</p></div>
);
