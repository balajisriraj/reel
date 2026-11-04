import { useState } from "react";
import { api } from "../../api";
import { fmtTime } from "../../film/resolve";
import type { Aspect, Brief, KeyMessage } from "../../types";
import { PanelHead, useStudio } from "../Studio";
import { Field, Icon, Section, useToast } from "../ui";

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 300];
const ASPECTS: { value: Aspect; label: string; use: string; w: number; h: number }[] = [
  { value: "16:9", label: "16:9", use: "Site, YouTube", w: 40, h: 22.5 },
  { value: "9:16", label: "9:16", use: "Reels, Shorts", w: 18, h: 32 },
  { value: "1:1", label: "1:1", use: "Feed", w: 28, h: 28 },
  { value: "4:5", label: "4:5", use: "Portrait feed", w: 24, h: 30 },
];
const newId = () => `msg_${Math.random().toString(16).slice(2, 12)}`;

export function BriefPanel() {
  const { project, update, meta } = useStudio();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const b = project.brief;
  const setBrief = (patch: Partial<Brief>) => update({ brief: { ...b, ...patch } });
  const setMessages = (messages: KeyMessage[]) => update({ messages });
  const s = project.settings;

  const add = (text: string) => {
    const t = text.trim();
    if (!t || project.messages.length >= 5) return;
    setMessages([...project.messages, { id: newId(), text: t }]);
    setDraft("");
  };
  const move = (i: number, by: number) => {
    const m = [...project.messages];
    const [x] = m.splice(i, 1);
    m.splice(i + by, 0, x);
    setMessages(m);
  };
  const suggest = async () => {
    setThinking(true);
    try {
      const { messages } = await api.suggestMessages(project.id);
      const have = new Set(project.messages.map((m) => m.text.toLowerCase()));
      const fresh = messages.filter((m) => !have.has(m.toLowerCase())).slice(0, 5 - project.messages.length);
      setMessages([...project.messages, ...fresh.map((text) => ({ id: newId(), text }))]);
      if (!fresh.length) toast("No new ideas this time: try sharpening the pitch.");
    } catch (e) {
      toast(String((e as Error).message), true);
    } finally {
      setThinking(false);
    }
  };

  return (
    <>
      <PanelHead title="Brief" text="What the reel is for. Everything else follows from this." />
      <div className="panel-body">
        <Field label="Product">
          <input className="input" value={b.product} placeholder="e.g. Lumen" onChange={(e) => setBrief({ product: e.target.value })} />
        </Field>
        <Field label="The pitch" hint="One or two sentences: what it does and why it matters.">
          <textarea className="textarea" rows={3} value={b.pitch} placeholder="A calm inbox that sorts itself…" onChange={(e) => setBrief({ pitch: e.target.value })} />
        </Field>
        <div className="row">
          <Field label="Audience"><input className="input" value={b.audience} placeholder="Busy founders" onChange={(e) => setBrief({ audience: e.target.value })} /></Field>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow"><Field label="Call to action"><input className="input" value={b.cta} placeholder="Join the beta" onChange={(e) => setBrief({ cta: e.target.value })} /></Field></div>
          <div className="grow"><Field label="Link on the end card"><input className="input" value={b.url} placeholder="lumen.app" onChange={(e) => setBrief({ url: e.target.value })} /></Field></div>
        </div>

        <Section title="Key messages" action={<button className="btn sm" onClick={suggest} disabled={thinking || project.messages.length >= 5 || !(b.product || b.pitch)}>{thinking ? <span className="spin" /> : <Icon name="spark" size={14} />} Suggest</button>}>
          <p className="muted small" style={{ marginBottom: 10 }}>The points a viewer must remember, most important first. The first is the <b style={{ color: "#ffcf5a" }}>hero</b>: it gets the climax of the story, and the music drops on it.</p>
          {project.messages.map((m, i) => (
            <div key={m.id} className={`msg${i === 0 ? " hero" : ""}`}>
              <span className="rank">{i === 0 ? "★" : i + 1}</span>
              <input className="input bare grow" value={m.text} onChange={(e) => setMessages(project.messages.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))} />
              <button className="btn ghost icon sm" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><Icon name="up" size={15} /></button>
              <button className="btn ghost icon sm" disabled={i === project.messages.length - 1} onClick={() => move(i, 1)} title="Move down"><Icon name="down" size={15} /></button>
              <button className="btn ghost icon sm" onClick={() => setMessages(project.messages.filter((x) => x.id !== m.id))} title="Remove"><Icon name="x" size={15} /></button>
            </div>
          ))}
          {project.messages.length < 5 && (
            <div className="row">
              <input className="input" value={draft} placeholder={project.messages.length ? "Add another message" : "e.g. Inbox zero by lunch"} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(draft)} />
              <button className="btn" onClick={() => add(draft)} disabled={!draft.trim()}><Icon name="plus" size={16} /></button>
            </div>
          )}
        </Section>

        <Section title="Length">
          <div className="row" style={{ marginBottom: 10 }}>
            <input type="range" min={10} max={meta.limits.duration} step={5} value={s.duration} onChange={(e) => update({ settings: { ...s, duration: Number(e.target.value) } })} />
            <b style={{ width: 52, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtTime(s.duration)}</b>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            {LENGTHS.filter((l) => l <= meta.limits.duration).map((l) => (
              <button key={l} className={`chip${s.duration === l ? " on" : ""}`} onClick={() => update({ settings: { ...s, duration: l } })}>{l < 60 ? `${l} s` : `${l / 60} min`}</button>
            ))}
          </div>
          <p className="hint">The director writes to this length. Recorded voice can stretch a scene; the music fits the final cut.</p>
        </Section>

        <Section title="Shape">
          <div className="tiles c4">
            {ASPECTS.map((a) => (
              <button key={a.value} className={`tile aspect${s.aspect === a.value ? " on" : ""}`} onClick={() => update({ settings: { ...s, aspect: a.value } })}>
                <span className="shape" style={{ width: a.w, height: a.h }} />
                <b>{a.label}</b>
                <small>{a.use}</small>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
