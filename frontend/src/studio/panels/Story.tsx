import { useState } from "react";
import { api, assetUrl } from "../../api";
import { coverage, fmtTime } from "../../film/resolve";
import type { Narration, Scene, Visual } from "../../types";
import { Recorder } from "../Recorder";
import { PanelHead, useStudio } from "../Studio";
import { beatColour, Icon, Section, Seg, useToast } from "../ui";

const NARRATION: { value: Narration; label: string }[] = [
  { value: "captions", label: "Subtitles" },
  { value: "voice", label: "Voiceover" },
  { value: "both", label: "Both" },
  { value: "titles", label: "Titles only" },
];
const VISUALS: { value: Visual; label: string }[] = [
  { value: "type", label: "Type" },
  { value: "asset", label: "Media" },
  { value: "stat", label: "Stat" },
  { value: "quote", label: "Quote" },
  { value: "logo", label: "Logo" },
  { value: "end", label: "End card" },
];
const REWRITES = ["Shorter", "Punchier", "Warmer", "As a question", "More concrete"];
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const newScene = (beat: string): Scene => ({ id: `scn_${Math.random().toString(16).slice(2, 12)}`, beat, narration: "", title: "New scene", sub: "", visual: "type", asset: "", duration: 3.5, motion: "auto", transition: "auto", messages: [], voice: "" });

function SceneCard({ scene, index, onRecord }: { scene: Scene; index: number; onRecord: (s: Scene) => void }) {
  const { project, update, selected, select, timeline } = useStudio();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState("");
  const timed = timeline.scenes.find((s) => s.id === scene.id);
  const budget = Math.max(3, Math.floor(scene.duration * 2.5 * 0.85));
  const media = project.assets.filter((a) => a.kind === "image" || a.kind === "video");
  const voice = scene.voice ? project.assets.find((a) => a.id === scene.voice) : undefined;
  const voiced = project.settings.narration === "voice" || project.settings.narration === "both";

  const set = (patch: Partial<Scene>) => update({ scenes: project.scenes.map((s) => (s.id === scene.id ? { ...s, ...patch } : s)) });
  const move = (by: number) => {
    const list = [...project.scenes];
    const i = list.findIndex((s) => s.id === scene.id);
    const [x] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, i + by)), 0, x);
    update({ scenes: list });
  };
  const rewrite = async (instruction: string) => {
    setBusy(instruction);
    try {
      const text = await api.rewrite(project.id, scene.id, instruction);
      set(text);
      setAsk("");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy("");
    }
  };
  const toggleMessage = (id: string) => set({ messages: scene.messages.includes(id) ? scene.messages.filter((m) => m !== id) : [...scene.messages, id] });

  return (
    <div className={`scene${selected === scene.id ? " sel" : ""}`} onClick={() => selected !== scene.id && select(scene.id)}>
      <div className="top">
        <span className="num">{index + 1}</span>
        <input className="input bare grow title-in" value={scene.title} onChange={(e) => set({ title: e.target.value })} placeholder="On-screen title" title="Wrap words in *asterisks* for the accent colour" />
        {timed?.hero && <span className="tag hot" title="The hero message lands here; the music drops">★ Hero</span>}
        <span className="faint small mono">{timed ? fmtTime(timed.start) : ""}</span>
      </div>
      <input className="input bare small" style={{ width: "100%", color: "var(--muted)" }} value={scene.sub} placeholder="Sub line (optional)" onChange={(e) => set({ sub: e.target.value })} />
      {project.settings.narration !== "titles" && (
        <>
          <textarea className="textarea" rows={2} style={{ marginTop: 6, fontSize: 13 }} value={scene.narration} placeholder="Narration" onChange={(e) => set({ narration: e.target.value })} />
          <div className="row" style={{ marginTop: 4 }}>
            <span className={`words${words(scene.narration) > budget ? " over" : ""}`}>{words(scene.narration)} / {budget} words</span>
            <span className="grow" />
            {voiced && (
              <button className="btn sm" onClick={(e) => { e.stopPropagation(); onRecord(scene); }} disabled={!scene.narration.trim()}>
                <Icon name="mic" size={14} /> {voice ? `Retake (${voice.duration?.toFixed(1)} s)` : "Record"}
              </button>
            )}
            {voice && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); new Audio(assetUrl(project.id, voice)).play(); }}><Icon name="play" size={12} /></button>}
          </div>
        </>
      )}
      <div className="ai-row">
        {REWRITES.map((r) => (
          <button key={r} className="chip" disabled={!!busy} onClick={(e) => { e.stopPropagation(); rewrite(r); }}>{busy === r ? <span className="spin" /> : <Icon name="spark" size={12} />}{r}</button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input className="input small" style={{ padding: "5px 9px" }} value={ask} placeholder="Or tell the director what to change…" onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask.trim() && rewrite(ask.trim())} />
      </div>

      {selected === scene.id && (
        <>
          <div className="more">
            <select className="select" value={scene.visual} onChange={(e) => set({ visual: e.target.value as Visual })} aria-label="Visual">{VISUALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>
            <select className="select" value={scene.transition} onChange={(e) => set({ transition: e.target.value as Scene["transition"] })} aria-label="Transition in">
              {["auto", "cut", "fade", "slide", "zoom", "whip"].map((t) => <option key={t} value={t}>{t === "auto" ? "Transition: style" : t}</option>)}
            </select>
            <select className="select" value={scene.motion} onChange={(e) => set({ motion: e.target.value as Scene["motion"] })} aria-label="Camera">
              {["auto", "push", "pan", "still", "float"].map((t) => <option key={t} value={t}>{t === "auto" ? "Camera: style" : t}</option>)}
            </select>
          </div>
          {scene.visual === "asset" && (
            <div className="assetpick" style={{ marginTop: 8 }}>
              {media.length ? media.map((a) => (
                <button key={a.id} className={scene.asset === a.id ? "on" : ""} style={a.kind === "image" ? { backgroundImage: `url(${assetUrl(project.id, a)})` } : undefined} title={a.note || a.name} onClick={() => set({ asset: a.id })}>{a.kind === "video" ? "▶ clip" : ""}</button>
              )) : <span className="small faint">Add images or clips in Media first.</span>}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small muted">Length</span>
            <input type="range" min={1.5} max={15} step={0.25} value={scene.duration} onChange={(e) => set({ duration: Number(e.target.value) })} />
            <b className="small mono" style={{ width: 56, flexShrink: 0, textAlign: "right" }}>{scene.duration.toFixed(1)} s</b>
          </div>
          {project.messages.length > 0 && (
            <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
              <span className="small muted">Lands</span>
              {project.messages.map((m, i) => (
                <button key={m.id} className={`chip${scene.messages.includes(m.id) ? " on" : ""}`} style={{ height: 24, fontSize: 11.5 }} onClick={() => toggleMessage(m.id)}>{i === 0 ? "★ " : ""}{m.text.slice(0, 28)}</button>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
            <button className="btn ghost sm" onClick={() => move(-1)} disabled={index === 0}><Icon name="up" size={14} /></button>
            <button className="btn ghost sm" onClick={() => move(1)} disabled={index === project.scenes.length - 1}><Icon name="down" size={14} /></button>
            <button className="btn ghost sm" onClick={() => { const i = project.scenes.findIndex((s) => s.id === scene.id); const list = [...project.scenes]; list.splice(i + 1, 0, { ...scene, id: newScene("").id, voice: "" }); update({ scenes: list }); }}><Icon name="copy" size={14} /> Duplicate</button>
            <button className="btn ghost sm" onClick={() => update({ scenes: project.scenes.filter((s) => s.id !== scene.id) })}><Icon name="trash" size={14} /> Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

export function StoryPanel() {
  const { project, update, replace, meta, look, select } = useStudio();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [recording, setRecording] = useState<Scene | null>(null);
  const s = project.settings;
  const fw = meta.frameworks.find((f) => f.id === s.framework) ?? meta.frameworks[0];
  const cov = coverage(project);
  const beats = [...new Set(project.scenes.map((x) => x.beat))];
  const total = project.scenes.reduce((a, x) => a + x.duration, 0);

  const write = async () => {
    if (project.scenes.length && !confirm("Write a fresh script? This replaces the scenes you have.")) return;
    setWriting(true);
    try {
      const out = await api.write(project.id, { avg_shot: look.avgShot, energy: look.energy, mood: look.mood });
      replace(out.project);
      select(out.project.scenes[0]?.id ?? null);
      toast(`${out.project.scenes.length} scenes, written to ${fw.name}`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setWriting(false);
    }
  };

  let lastBeat = "";
  return (
    <>
      <PanelHead title="Story" text="Choose how the story moves. The director writes every scene to your length and pace." />
      <div className="panel-body">
        <Section title="Framework">
          <div className="tiles">
            {meta.frameworks.map((f) => (
              <button key={f.id} className={`tile${s.framework === f.id ? " on" : ""}`} onClick={() => update({ settings: { ...s, framework: f.id } })}>
                <b>{f.name}</b>
                <small>{f.blurb}</small>
                {s.framework === f.id && (
                  <>
                    <div className="beatbar">{f.beats.map((b) => <i key={b.name} title={b.name} style={{ flex: b.share }} />)}</div>
                    <small style={{ marginTop: 6 }}>{f.beats.map((b) => b.name).join(" · ")}</small>
                  </>
                )}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Voice">
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            {meta.tones.map((t) => (
              <button key={t.id} className={`chip${s.tone === t.id ? " on" : ""}`} title={t.description} onClick={() => update({ settings: { ...s, tone: t.id } })}>{t.id[0].toUpperCase() + t.id.slice(1)}</button>
            ))}
          </div>
          <span className="label">Narration</span>
          <Seg full value={s.narration} options={NARRATION} onChange={(v) => update({ settings: { ...s, narration: v } })} />
          <p className="hint">{{ captions: "The narration runs as timed subtitles. No voice needed.", voice: "Record each line with the teleprompter; the music ducks under you.", both: "Your recorded voice, with subtitles timed to it.", titles: "No narration: the on-screen titles carry the story." }[s.narration]}</p>
        </Section>

        <div style={{ marginTop: 18 }}>
          <button className="btn primary lg block" onClick={write} disabled={writing || !(project.brief.product || project.brief.pitch)}>
            {writing ? <><span className="spin" /> Directing…</> : <><Icon name="spark" size={18} /> {project.scenes.length ? "Rewrite the whole script" : "Write the script"}</>}
          </button>
          {!(project.brief.product || project.brief.pitch) && <p className="hint">Fill in the brief first.</p>}
        </div>

        {project.messages.length > 0 && project.scenes.length > 0 && (
          <Section title="Key message coverage">
            <div className="cov">
              {cov.map((c) => (
                <div key={c.message.id} style={{ display: "contents" }}>
                  <div>
                    <div className={c.scenes ? "" : "zero"} style={{ marginBottom: 4 }}>{c.hero ? "★ " : ""}{c.message.text}</div>
                    <div className="bar"><i style={{ width: `${Math.min(100, (c.seconds / Math.max(1, total)) * 300)}%` }} /></div>
                  </div>
                  <span className={`small ${c.scenes ? "muted" : "zero"}`} style={{ textAlign: "right" }}>{c.scenes ? `${c.scenes} · ${c.seconds.toFixed(0)} s` : "not landed"}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {writing && !project.scenes.length && [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 120, marginTop: 10 }} />)}
        {project.scenes.length > 0 && (
          <Section title={`Scenes · ${project.scenes.length} · ${fmtTime(total)}`} action={<button className="btn sm" onClick={() => update({ scenes: [...project.scenes, newScene(beats[beats.length - 1] ?? "")] })}><Icon name="plus" size={14} /> Scene</button>}>
            {project.scenes.map((scene, i) => {
              const head = scene.beat !== lastBeat;
              lastBeat = scene.beat;
              const beat = fw.beats.find((b) => b.name === scene.beat);
              return (
                <div key={scene.id}>
                  {head && scene.beat && (
                    <div className="beathead"><i style={{ background: beatColour(beats, scene.beat) }} />{scene.beat}{beat && <span className="faint">· {beat.purpose}</span>}</div>
                  )}
                  <SceneCard scene={scene} index={i} onRecord={setRecording} />
                </div>
              );
            })}
          </Section>
        )}
      </div>
      {recording && <Recorder scene={recording} onClose={() => setRecording(null)} />}
    </>
  );
}
