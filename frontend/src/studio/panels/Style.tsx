import { useRef, useState } from "react";
import { api, fileUrl } from "../../api";
import { FONTS, THEMES } from "../../film/themes";
import type { Reference, Trait } from "../../types";
import { TRAITS } from "../../types";
import { PanelHead, useStudio } from "../Studio";
import { Icon, Section, useToast } from "../ui";

const TRAIT_INFO: Record<Trait, { name: string; what: string }> = {
  pace: { name: "Pace", what: "shot length" },
  palette: { name: "Palette", what: "colour" },
  energy: { name: "Energy", what: "motion" },
  music: { name: "Music", what: "tempo, mood" },
  type: { name: "Type", what: "lettering" },
  motion: { name: "Motion", what: "cuts, camera" },
};

const host = (url: string) => {
  if (url.startsWith("file:")) return "uploaded file";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function RefCard({ r }: { r: Reference }) {
  const { project, replace } = useStudio();
  const d = r.dna;
  const remove = async () => replace(await api.removeReference(project.id, r.id));
  return (
    <div className="card ref">
      <div className="sheet" style={r.sheet ? { backgroundImage: `url(${fileUrl(project.id, r.sheet)})` } : undefined}>
        {r.status !== "ready" && (
          <div className="state">
            {r.status === "failed" ? (
              <div><b style={{ color: "var(--bad)" }}>Couldn't learn from this one</b><div className="small muted" style={{ marginTop: 4 }}>{r.error}</div></div>
            ) : (
              <div className="row" style={{ justifyContent: "center" }}><span className="spin" /> <span className="small">{r.status === "queued" ? "Queued" : "Watching it: cuts, colour, motion, tempo…"}</span></div>
            )}
          </div>
        )}
      </div>
      <div className="info">
        <div className="row">
          <div className="grow">
            <div className="title" title={r.title || r.url}>{r.title || host(r.url)}</div>
            <div className="faint small">{host(r.url)}{d ? ` · ${Math.round(d.duration)} s` : ""}</div>
          </div>
          <button className="btn ghost icon sm" onClick={remove} title="Remove reference"><Icon name="trash" size={15} /></button>
        </div>
        {d && (
          <>
            <div className="dna">
              <div><small>Pace</small><b>{d.avg_shot.toFixed(1)} s shots</b></div>
              <div><small>Rhythm</small><b>{d.rhythm}</b></div>
              <div><small>Tempo</small><b>{d.bpm ? `${Math.round(d.bpm)} bpm` : "no beat"}</b></div>
              <div><small>Energy</small><b>{Math.round(d.energy * 100)}%</b></div>
              <div><small>Type</small><b>{d.typography}</b></div>
              <div><small>Motion</small><b>{d.transitions} · {d.camera}</b></div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="swatches">{d.palette.map((c) => <i key={c} style={{ background: c }} />)}</span>
              <span className="small muted">{d.mood.join(", ")}</span>
            </div>
            {d.summary && <p className="small muted" style={{ marginTop: 8 }}>{d.summary}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export function StylePanel() {
  const { project, update, refresh, meta, look } = useStudio();
  const toast = useToast();
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const ready = project.references.filter((r) => r.status === "ready");
  const room = meta.limits.references - project.references.length;

  const addLinks = async () => {
    const urls = links.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean).slice(0, room);
    if (!urls.length) return;
    setBusy(true);
    for (const url of urls) {
      try {
        await api.addReference(project.id, url);
      } catch (e) {
        toast(`${host(url)}: ${(e as Error).message}`, true);
      }
    }
    setLinks("");
    setBusy(false);
    await refresh();
  };
  const addFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      await api.uploadReference(project.id, f);
      await refresh();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const setMix = (trait: Trait, value: string) => update({ mix: { ...project.mix, [trait]: value } });
  const allFrom = (value: string) => update({ mix: Object.fromEntries(TRAITS.map((t) => [t, value])) as typeof project.mix });

  return (
    <>
      <PanelHead title="Style" text="Show Reel films you love. It learns the look; you choose what to borrow." />
      <div className="panel-body">
        <Section title="Learn from videos">
          <textarea className="textarea" rows={3} value={links} disabled={room <= 0} placeholder={room > 0 ? "Paste links to videos, one per line" : "Five references is the most a reel can mix"} onChange={(e) => setLinks(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={addLinks} disabled={busy || !links.trim() || room <= 0}>{busy ? <span className="spin" /> : <Icon name="link" size={16} />} Learn the style</button>
            <button className="btn" onClick={() => file.current?.click()} disabled={busy || room <= 0}><Icon name="upload" size={16} /> Or a video file</button>
            <input ref={file} type="file" accept="video/*" hidden onChange={(e) => addFile(e.target.files?.[0])} />
          </div>
          <p className="hint">Up to {meta.limits.references} videos, each up to {Math.round(meta.limits.reference_seconds / 60)} minutes. Reel downloads a small copy, measures it and deletes it: it keeps the numbers and a contact sheet, never the footage.</p>
          <div style={{ marginTop: 12 }}>{project.references.map((r) => <RefCard key={r.id} r={r} />)}</div>
        </Section>

        <Section title="Mix and match" action={ready.length > 1 ? <button className="btn sm" onClick={() => allFrom("blend")}>Blend all</button> : null}>
          {!ready.length && <p className="muted small">Once a reference is learnt, take each trait from the theme, from one film, or from a blend of them all.</p>}
          {TRAITS.map((trait) => (
            <div className="mixrow" key={trait}>
              <div className="k">{TRAIT_INFO[trait].name}<small>{TRAIT_INFO[trait].what}</small></div>
              <div className="chips">
                <button className={`chip${project.mix[trait] === "theme" ? " on" : ""}`} onClick={() => setMix(trait, "theme")}>Theme</button>
                {ready.length > 1 && <button className={`chip${project.mix[trait] === "blend" ? " on" : ""}`} onClick={() => setMix(trait, "blend")}>Blend</button>}
                {ready.map((r, i) => (
                  <button key={r.id} className={`chip${project.mix[trait] === r.id ? " on" : ""}`} onClick={() => setMix(trait, r.id)} title={r.title}>
                    {trait === "palette" && r.dna ? <span className="swatches">{r.dna.palette.slice(0, 3).map((c) => <i key={c} style={{ background: c, width: 9, height: 12 }} />)}</span> : <b>{i + 1}</b>}
                    <span>{(r.title || host(r.url)).slice(0, 18)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="small faint" style={{ marginBottom: 6 }}>YOUR LOOK</div>
            <div className="row" style={{ gap: 14 }}>
              <div style={{ width: 92, height: 56, borderRadius: 8, background: look.bg, display: "grid", placeItems: "center", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}>
                <span style={{ fontFamily: look.font, fontWeight: look.weight, color: look.fg, fontSize: 22, letterSpacing: `${look.tracking}em` }}>A<span style={{ color: look.accent }}>a</span></span>
              </div>
              <div className="small muted grow">
                {TRAITS.map((t) => <div key={t}>{TRAIT_INFO[t].name}: <b style={{ color: "var(--ink)" }}>{look.sources[t]}</b></div>)}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Theme">
          <p className="muted small" style={{ marginBottom: 10 }}>The base everything sits on: stage, type, motion and backdrop. Anything you take from a reference overrides it.</p>
          <div className="tiles c2">
            {THEMES.map((t) => (
              <button key={t.id} className={`tile theme-tile${project.settings.theme === t.id ? " on" : ""}`} onClick={() => update({ settings: { ...project.settings, theme: t.id } })}>
                <div className="sample" style={{ background: t.bg, color: t.fg, fontFamily: FONTS[t.font] }}>
                  <span style={{ fontWeight: t.weight, letterSpacing: `${t.tracking}em`, textTransform: t.upper ? "uppercase" : "none" }}>Make it <em style={{ color: t.accent }}>sing</em></span>
                  <small style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--font)" }}>{t.transition} · {t.camera} · {t.bpm} bpm</small>
                </div>
                <div className="cap"><b>{t.name}</b><small>{t.blurb}</small></div>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
