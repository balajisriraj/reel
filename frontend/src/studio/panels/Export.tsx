import { useEffect, useState } from "react";
import { api, fileUrl, follow } from "../../api";
import { coverage, fmtTime } from "../../film/resolve";
import type { Job } from "../../types";
import { PanelHead, useStudio } from "../Studio";
import { Icon, Section, Seg, useToast } from "../ui";

export function ExportPanel() {
  const { project, timeline, replace, refresh, setTab } = useStudio();
  const toast = useToast();
  const [quality, setQuality] = useState<"draft" | "final">("draft");
  const [job, setJob] = useState<Job | null>(null);

  // Pick up a render that was already running (say, after a reload).
  useEffect(() => {
    api.jobs(project.id).then((jobs) => {
      const running = jobs.find((j) => j.kind === "render");
      if (running) watch(running.id);
    });
  }, [project.id]);

  const watch = async (id: string) => {
    const done = await follow(id, setJob, 900);
    if (done.status === "failed") toast(done.message, true);
    else toast("Your reel is ready");
    await refresh();
    setJob(null);
  };
  const start = async () => {
    try {
      const { job: id } = await api.render(project.id, quality);
      watch(id);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const gaps = coverage(project).filter((c) => !c.scenes);
  const checks = [
    { ok: project.scenes.length > 0, text: "Script written", tab: "story" as const },
    { ok: gaps.length === 0, text: gaps.length ? `${gaps.length} key message${gaps.length > 1 ? "s" : ""} not landed` : "Every key message lands", tab: "story" as const },
    { ok: project.references.some((r) => r.status === "ready") || project.settings.theme !== "keynote", text: "Look chosen", tab: "style" as const },
    { ok: !(project.settings.narration === "voice" || project.settings.narration === "both") || project.scenes.every((s) => !s.narration || s.voice), text: "Every line recorded", tab: "story" as const },
  ];
  const frames = Math.ceil(timeline.duration * (quality === "final" ? 30 : 24));

  return (
    <>
      <PanelHead title="Render" text="The same film as the preview, frame by frame, with the music and the voice mixed in." />
      <div className="panel-body">
        <div className="card" style={{ padding: "4px 14px" }}>
          {checks.map((c) => (
            <div key={c.text} className="switchrow">
              <span className="row" style={{ gap: 8 }}><span style={{ color: c.ok ? "var(--ok)" : "var(--warn)", fontWeight: 800 }}>{c.ok ? "✓" : "!"}</span>{c.text}</span>
              {!c.ok && <button className="btn sm ghost" onClick={() => setTab(c.tab)}>Fix</button>}
            </div>
          ))}
        </div>

        <Section title="Output">
          <Seg full value={quality} options={[{ value: "draft", label: "Draft · 720p" }, { value: "final", label: "Final · 1080p" }]} onChange={setQuality} />
          <p className="hint">{project.settings.aspect} · {fmtTime(timeline.duration)} · {timeline.scenes.length} scenes · {frames.toLocaleString("en-GB")} frames. {quality === "draft" ? "Quick, for checking the cut." : "Full quality, for publishing."}</p>
          <button className="btn primary lg block" style={{ marginTop: 12 }} onClick={start} disabled={!!job || !project.scenes.length}>
            {job ? <><span className="spin" /> {job.message || "Starting"}…</> : <><Icon name="export" size={18} /> Render the reel</>}
          </button>
          {job && <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>}
        </Section>

        <Section title={`Renders · ${project.renders.length}`}>
          {!project.renders.length && <p className="muted small">Nothing rendered yet.</p>}
          {[...project.renders].reverse().map((r) => (
            <div key={r.id} className="card render">
              <video src={fileUrl(project.id, `renders/${r.file}`)} poster={fileUrl(project.id, `renders/${r.poster}`)} controls preload="none" />
              <div className="info">
                <div className="grow small"><b>{r.quality === "final" ? "Final" : "Draft"}</b> · {r.aspect} · {fmtTime(r.duration)}<div className="faint">{new Date(r.created * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div></div>
                <a className="btn sm" href={fileUrl(project.id, `renders/${r.file}`)} download={r.file}><Icon name="export" size={14} /> MP4</a>
                <button className="btn ghost icon sm" title="Delete" onClick={async () => replace(await api.removeRender(project.id, r.id))}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}
