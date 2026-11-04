import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Scene } from "../types";
import { useStudio } from "./Studio";
import { Icon, useToast } from "./ui";

/** A teleprompter for one line: count in, read along at the scene's pace, review, keep. */
export function Recorder({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const { project, replace } = useStudio();
  const toast = useToast();
  const [stage, setStage] = useState<"ready" | "count" | "rec" | "review" | "saving">("ready");
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Blob | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const words = scene.narration.split(/\s+/).filter(Boolean);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  const begin = async () => {
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast("Reel needs your microphone to record. Allow it in the browser and try again.", true);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream.current).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const meter = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel(peak);
      if (recorder.current?.state === "recording" || stage === "count") requestAnimationFrame(meter);
    };
    setStage("count");
    for (let n = 3; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 700));
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current);
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      setTake(new Blob(chunks, { type: rec.mimeType }));
      setStage("review");
      ctx.close();
    };
    recorder.current = rec;
    rec.start();
    started.current = performance.now();
    setStage("rec");
    requestAnimationFrame(meter);
    const tick = () => {
      if (rec.state !== "recording") return;
      setElapsed((performance.now() - started.current) / 1000);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  const keep = async () => {
    if (!take) return;
    setStage("saving");
    try {
      replace(await api.recordVoice(project.id, scene.id, take));
      toast("Take saved. The scene fits itself to it.");
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
      setStage("review");
    }
  };

  // Highlight the words at the pace the scene allows, as a guide.
  const pace = Math.max(1, scene.duration - 0.4);
  const lit = stage === "rec" ? Math.floor((elapsed / pace) * words.length) : stage === "review" ? words.length : -1;

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div className="grow"><b style={{ fontSize: 17 }}>Record: {scene.title.replace(/\*/g, "") || scene.beat}</b><div className="small muted">Aim for about {pace.toFixed(1)} s. The scene stretches to fit a longer take.</div></div>
          <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        {stage === "count" ? (
          <div className="prompter count">{count}</div>
        ) : (
          <div className="prompter">{words.map((w, i) => <span key={i} style={{ color: i < lit ? "#fff" : i === lit ? "#ff8a3d" : "#5d5a66" }}>{w} </span>)}</div>
        )}
        <div className="level" style={{ marginBottom: 16 }}><i style={{ width: `${Math.min(100, level * 160)}%` }} /></div>
        <div className="row">
          {stage === "ready" && <button className="btn primary lg" onClick={begin}><Icon name="mic" size={18} /> Start recording</button>}
          {stage === "rec" && <><button className="btn lg" onClick={stop}><span className="rec-dot" /> Stop</button><span className="mono muted">{elapsed.toFixed(1)} s</span></>}
          {stage === "review" && take && (
            <>
              <audio controls src={URL.createObjectURL(take)} style={{ height: 36 }} />
              <span className="grow" />
              <button className="btn" onClick={() => { setTake(null); setElapsed(0); setStage("ready"); }}>Retake</button>
              <button className="btn primary" onClick={keep}>Use this take</button>
            </>
          )}
          {stage === "saving" && <><span className="spin" /> Saving and trimming the silence…</>}
        </div>
      </div>
    </div>
  );
}
