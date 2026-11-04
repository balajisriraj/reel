import { useRef, useState } from "react";
import { api, assetUrl, follow } from "../../api";
import { musicBpm } from "../../film/resolve";
import type { Asset } from "../../types";
import { PanelHead, useStudio } from "../Studio";
import { Icon, Section, Seg, Toggle, useToast } from "../ui";

const SCORE_NAMES: Record<string, string> = { midnight: "Midnight", study: "Study", punch: "Punch", forge: "Forge", air: "Air", arena: "Arena" };
const MOODS: Record<string, string[]> = {
  midnight: ["cinematic", "moody", "dark", "mysterious", "dramatic", "night", "sleek"],
  study: ["warm", "cosy", "calm", "considered", "nostalgic", "gentle", "human", "intimate"],
  punch: ["bold", "loud", "energetic", "punchy", "confident", "urgent", "edgy", "gritty"],
  forge: ["earthy", "crafted", "handmade", "rugged", "organic", "raw"],
  air: ["bright", "optimistic", "airy", "playful", "fresh", "clean", "light", "minimal", "friendly"],
  arena: ["epic", "triumphant", "competitive", "intense", "powerful", "sporty"],
};
/** Mirrors backend/reel/render.py: the mix's mood picks the score's style. */
export function scoreStyle(mood: string[], energy: number) {
  const words = new Set(mood.map((m) => m.toLowerCase()));
  let best = "", hits = 0;
  for (const [k, v] of Object.entries(MOODS)) {
    const n = v.filter((w) => words.has(w)).length;
    if (n > hits) [best, hits] = [k, n];
  }
  return best || (energy >= 0.6 ? "punch" : energy >= 0.3 ? "air" : "study");
}

function AssetCard({ a }: { a: Asset }) {
  const { project, replace, refresh } = useStudio();
  const [note, setNote] = useState(a.note);
  const used = project.scenes.filter((s) => s.asset === a.id).length;
  const url = assetUrl(project.id, a);
  return (
    <div className="card">
      <div className="thumb" style={a.kind === "image" ? { backgroundImage: `url(${url})` } : undefined}>
        {a.kind === "video" && <video src={`${url}#t=0.5`} muted preload="metadata" />}
        <span className="tag kind">{a.kind === "video" ? `clip ${a.duration?.toFixed(0)} s` : project.brand.logo === a.id ? "logo" : "image"}</span>
        <button className="btn icon sm x" title="Remove" onClick={async () => replace(await api.removeAsset(project.id, a.id))}><Icon name="x" size={14} /></button>
      </div>
      <div className="cap">
        <input className="input" value={note} placeholder="What is this? (helps the director)" onChange={(e) => setNote(e.target.value)} onBlur={async () => { if (note !== a.note) { await api.patchAsset(project.id, a.id, { note }); refresh(); } }} />
        <div className="faint small" style={{ marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{used ? `in ${used} scene${used > 1 ? "s" : ""}` : a.name}</div>
      </div>
    </div>
  );
}

export function MediaPanel() {
  const { project, update, refresh, look, meta } = useStudio();
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [capture, setCapture] = useState({ url: "", mobile: false, busy: false, msg: "" });
  const file = useRef<HTMLInputElement>(null);
  const visuals = project.assets.filter((a) => a.kind === "image" || a.kind === "video");
  const tracks = project.assets.filter((a) => a.kind === "audio");
  const m = project.settings.music;
  const setMusic = (patch: Partial<typeof m>) => update({ settings: { ...project.settings, music: { ...m, ...patch } } });

  const send = async (files: FileList | File[]) => {
    const list = [...files];
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        if (f.size > meta.limits.upload_mb * 1024 * 1024) throw new Error(`${f.name} is over ${meta.limits.upload_mb} MB`);
        const a = await api.uploadAsset(project.id, f);
        if (a.kind === "audio" && m.source !== "upload") setMusic({ source: "upload", asset: a.id });
      } catch (e) {
        toast((e as Error).message, true);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await refresh();
  };
  const grab = async () => {
    setCapture((c) => ({ ...c, busy: true, msg: "Opening the page" }));
    try {
      const { job } = await api.capture(project.id, capture.url, capture.mobile);
      const done = await follow(job, (j) => setCapture((c) => ({ ...c, msg: j.message })));
      if (done.status === "failed") throw new Error(done.message);
      await refresh();
      toast(`Captured ${(done.result.assets as string[]).length} screens`);
      setCapture((c) => ({ ...c, url: "" }));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setCapture((c) => ({ ...c, busy: false, msg: "" }));
    }
  };
  const style = scoreStyle(look.mood, look.energy);
  const bpm = musicBpm(project, look);

  return (
    <>
      <PanelHead title="Media" text="Screens, photos and clips to show; a track to cut to." />
      <div className="panel-body">
        <div
          className={`drop${over ? " over" : ""}`}
          onClick={() => file.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        >
          <Icon name="upload" size={22} />
          <div style={{ fontWeight: 600, marginTop: 6 }}>{uploading ? `Uploading ${uploading}…` : "Drop images, clips or music"}</div>
          <div className="small faint">PNG, JPG, MP4, MOV, MP3, WAV · up to {meta.limits.upload_mb} MB each</div>
          <input ref={file} type="file" multiple hidden accept="image/*,video/*,audio/*" onChange={(e) => e.target.files && send(e.target.files)} />
        </div>

        <Section title="Capture a web page">
          <div className="row">
            <input className="input" value={capture.url} placeholder="https://your-product.com" onChange={(e) => setCapture((c) => ({ ...c, url: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && capture.url && grab()} />
            <button className="btn" onClick={grab} disabled={!capture.url || capture.busy}>{capture.busy ? <span className="spin" /> : <Icon name="camera" size={16} />} Capture</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Seg value={capture.mobile ? "m" : "d"} options={[{ value: "d", label: "Desktop" }, { value: "m", label: "Phone" }]} onChange={(v) => setCapture((c) => ({ ...c, mobile: v === "m" }))} />
            <span className="small faint">{capture.msg || "Screens at 2x, framed as a browser or phone in the reel."}</span>
          </div>
        </Section>

        <Section title={`On screen · ${visuals.length}`}>
          {visuals.length ? <div className="media">{visuals.map((a) => <AssetCard key={a.id} a={a} />)}</div> : <p className="muted small">Nothing yet. Without media the reel runs on kinetic type alone, which can look great too.</p>}
        </Section>

        <Section title="Music">
          <div className={`track${m.source === "score" ? " on" : ""}`} role="button" onClick={() => setMusic({ source: "score" })} style={{ cursor: "pointer" }}>
            <Icon name="spark" size={18} />
            <div className="grow"><b>Composed for this reel</b><div className="small muted">An original “{SCORE_NAMES[style]}” score at {look.bpm} bpm, written to your cut: it builds to the hero message and drops on it.</div></div>
          </div>
          {tracks.map((a) => (
            <div key={a.id} className={`track${m.source === "upload" && m.asset === a.id ? " on" : ""}`} role="button" onClick={() => setMusic({ source: "upload", asset: a.id })} style={{ cursor: "pointer" }}>
              <Icon name="music" size={18} />
              <div className="grow"><b>{a.name}</b><div className="small muted">{a.duration ? `${Math.round(a.duration)} s` : ""}{a.bpm ? ` · ${Math.round(a.bpm)} bpm` : " · no clear beat"}</div></div>
              <button className="btn ghost icon sm" onClick={(e) => { e.stopPropagation(); new Audio(assetUrl(project.id, a)).play(); }}><Icon name="play" size={12} /></button>
            </div>
          ))}
          <div className={`track${m.source === "none" ? " on" : ""}`} role="button" onClick={() => setMusic({ source: "none" })} style={{ cursor: "pointer" }}>
            <Icon name="x" size={18} /><div className="grow"><b>No music</b></div>
          </div>
          {m.source !== "none" && (
            <div className="card" style={{ padding: "4px 14px", marginTop: 10 }}>
              <div className="switchrow">
                <div><b>Cut to the beat</b><div className="small muted">{bpm ? `Every cut lands on a beat of the ${Math.round(bpm)} bpm track.` : "This track has no clear beat to cut to."}</div></div>
                <Toggle on={m.beat_sync} onChange={(v) => setMusic({ beat_sync: v })} label="Cut to the beat" />
              </div>
              <div className="switchrow">
                <b>Volume</b>
                <input type="range" min={0.2} max={1} step={0.05} value={m.volume} style={{ maxWidth: 180 }} onChange={(e) => setMusic({ volume: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <p className="hint">The music ducks under recorded voice, and the mix is normalised to streaming loudness.</p>
        </Section>
      </div>
    </>
  );
}
