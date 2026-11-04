import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../api";
import { Film } from "../film/engine";
import { fmtTime } from "../film/resolve";
import { theme as themeById } from "../film/themes";
import { useStudio } from "./Studio";
import { beatColour, Icon, Toggle } from "./ui";

/** The live preview: the same engine the renderer uses, scaled to fit, with music, voice and a scrubbable timeline. */
export function Player() {
  const { project, look, timeline, time, seek, selected, select } = useStudio();
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const film = useRef<Film | null>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(time);
  const [draftVoice, setDraftVoice] = useState(false);
  const music = useRef<HTMLAudioElement | null>(null);
  const voices = useRef(new Map<string, HTMLAudioElement>());
  const tRef = useRef(t);
  tRef.current = t;

  // Fit the canvas to the viewport.
  useEffect(() => {
    const el = viewport.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 52, h: el.clientHeight - 52 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(box.w / timeline.width, box.h / timeline.height);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Rebuild the film when the project changes (debounced, so typing stays smooth).
  useEffect(() => {
    const id = setTimeout(() => {
      film.current?.destroy();
      const f = new Film(host.current!, project, look, timeline, { mode: "preview", assetUrl: (a) => assetUrl(project.id, a) });
      f.root.style.transform = `scale(${scaleRef.current})`;
      film.current = f;
      f.setPlaying(playing);
      f.renderAt(tRef.current);
    }, 140);
    return () => clearTimeout(id);
  }, [project, look, timeline]);
  useEffect(() => {
    if (film.current) film.current.root.style.transform = `scale(${scale})`;
  }, [scale]);
  useEffect(() => () => film.current?.destroy(), []);

  // External seeks (a scene selected in the story) move the playhead.
  useEffect(() => {
    if (!playing) setT(time);
  }, [time]);
  useEffect(() => {
    if (!playing) film.current?.renderAt(t);
  }, [t, playing]);

  // Audio: the uploaded track, and recorded lines.
  const track = project.settings.music.source === "upload" ? project.assets.find((a) => a.id === project.settings.music.asset) : undefined;
  useEffect(() => {
    music.current?.pause();
    music.current = track ? new Audio(assetUrl(project.id, track)) : null;
    if (music.current) music.current.volume = project.settings.music.volume;
  }, [track?.id, project.id]);
  useEffect(() => {
    const map = new Map<string, HTMLAudioElement>();
    for (const v of timeline.voices) {
      const a = project.assets.find((x) => x.id === v.asset);
      if (a) map.set(v.asset, voices.current.get(v.asset) ?? new Audio(assetUrl(project.id, a)));
    }
    voices.current = map;
  }, [timeline, project.assets, project.id]);

  // Playback.
  useEffect(() => {
    film.current?.setPlaying(playing);
    if (!playing) {
      music.current?.pause();
      voices.current.forEach((a) => a.pause());
      speechSynthesis.cancel();
      seek(tRef.current);
      return;
    }
    const startT = tRef.current >= timeline.duration - 0.05 ? 0 : tRef.current;
    const t0 = performance.now();
    if (music.current) {
      music.current.currentTime = startT % (music.current.duration || Infinity);
      music.current.play().catch(() => undefined);
    }
    const started = new Set<string>();
    let lastScene = -1;
    let raf = 0;
    const tick = () => {
      const now = startT + (performance.now() - t0) / 1000;
      if (now >= timeline.duration) {
        setT(timeline.duration - 0.01);
        setPlaying(false);
        return;
      }
      film.current?.renderAt(now);
      setT(now);
      for (const v of timeline.voices) {
        const a = voices.current.get(v.asset);
        const at = v.start + 0.15;
        if (a && !started.has(v.asset) && now >= at && now < at + (a.duration || 30)) {
          started.add(v.asset);
          a.currentTime = now - at;
          a.play().catch(() => undefined);
        }
      }
      const i = timeline.scenes.findIndex((s) => now >= s.start && now < s.end);
      if (draftVoice && i !== lastScene && i >= 0) {
        const s = timeline.scenes[i];
        if (s.narration && !(s.voice && timeline.voices.length)) {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(s.narration);
          const wps = s.narration.split(/\s+/).length / Math.max(1, s.end - s.start - 0.3);
          u.rate = Math.min(1.6, Math.max(0.85, wps / 2.6));
          speechSynthesis.speak(u);
        }
      }
      lastScene = i;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  // Scrubbing.
  const scrub = useRef<HTMLDivElement>(null);
  const fromX = (x: number) => {
    const r = scrub.current!.getBoundingClientRect();
    return Math.min(timeline.duration - 0.01, Math.max(0, ((x - r.left) / r.width) * timeline.duration));
  };
  const down = (e: React.PointerEvent) => {
    setPlaying(false);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const go = (x: number) => {
      const nt = fromX(x);
      setT(nt);
      const s = timeline.scenes.find((sc) => nt >= sc.start && nt < sc.end);
      if (s && s.id !== selected) select(s.id, false);
    };
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const beats = [...new Set(timeline.scenes.map((s) => s.beat))];
  const cur = timeline.scenes.find((s) => t >= s.start && t < s.end);
  const th = themeById(project.settings.theme);
  return (
    <section className="stage">
      <div className="viewport" ref={viewport}>
        <div className="screen" style={{ width: timeline.width * scale, height: timeline.height * scale }} onClick={() => setPlaying((p) => !p)}>
          <div ref={host} />
        </div>
      </div>
      <div className="deck">
        <div className="controls">
          <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}><Icon name={playing ? "pause" : "play"} size={18} /></button>
          <span className="timecode"><b>{fmtTime(t)}</b> / {fmtTime(timeline.duration)}</span>
          {cur && <span className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.beat || "Scene"} · {cur.title.replace(/\*/g, "") || cur.visual}</span>}
          <span className="grow" />
          <span className="row small muted" title="Reads each line aloud with your browser's voice while you preview">
            Draft voice <Toggle on={draftVoice} onChange={setDraftVoice} label="Draft voice" />
          </span>
        </div>
        <div className="scrub" ref={scrub} onPointerDown={down}>
          {timeline.scenes.map((s) => (
            <div key={s.id} className={`seg2${s.id === selected ? " sel" : ""}`} style={{ flex: `${s.end - s.start} 1 0` }} title={`${s.beat}: ${s.title.replace(/\*/g, "")}`}>
              <span className="lbl">{s.title.replace(/\*/g, "") || s.visual}</span>
              <span className="bt">{s.beat}</span>
              {s.hero && <span className="star">★</span>}
              <span className="stripe" style={{ background: beatColour(beats, s.beat) }} />
            </div>
          ))}
          <span className="head" style={{ left: `${(t / timeline.duration) * 100}%` }} />
        </div>
        <div className="lookbar">
          <span className="swatches">{[look.bg, look.accent, look.accent2, look.fg].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
          <span><b>{th.name}</b> base</span>
          <span>type <b style={{ fontFamily: look.font, fontWeight: look.weight }}>Aa</b> {look.fontKey}</span>
          <span>shots <b>~{look.avgShot.toFixed(1)} s</b></span>
          <span>energy <b>{Math.round(look.energy * 100)}%</b></span>
          <span><b>{timeline.bpm} bpm</b>{project.settings.music.beat_sync && project.settings.music.source !== "none" ? " · cut to the beat" : ""}</span>
          <span><b>{look.transition}</b> · {look.camera}</span>
        </div>
      </div>
    </section>
  );
}
