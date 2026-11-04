// Pass 2 of Reel's own film: direct it in Reel. Uploads the recorded clips, learns the look from two films, sets the
// brief, mix, brand and a hand-edited script, then renders the final cut with its composed score.
//
//   node promo/film.mjs --app http://127.0.0.1:8070 --films http://127.0.0.1:8099
//
// Writes promo/out/reel-promo.mp4 (1080p), reel-promo-web.mp4 (for the README, under 10 MB) and reel-poster.jpg.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "../renderer/chrome.mjs";

const APP = arg("app", "http://127.0.0.1:8070");
const FILMS = arg("films", "http://127.0.0.1:8099");
const OUT = resolve(import.meta.dirname, "out");
const CLIPS = resolve(OUT, "clips");
const FIT = resolve(OUT, "fit");
mkdirSync(FIT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}, tries = 3) {
  let res;
  try {
    res = await fetch(`${APP}${path}`, { ...init, headers: init.json ? { "Content-Type": "application/json" } : undefined, body: init.json ? JSON.stringify(init.json) : init.body });
  } catch (e) {
    // A pooled connection the server already closed: try again on a fresh one.
    if (tries > 1) return api(path, init, tries - 1);
    throw e;
  }
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
const upload = (pid, file, name, type) => {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(file)], { type }), name);
  return api(`/api/projects/${pid}/assets`, { method: "POST", body: form });
};
const seconds = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// ---------------------------------------------------------------- the script
// [visual, seconds, title, sub, clip?, messages?]
const M = { hero: "msg_hero00001", look: "msg_look00001", shape: "msg_shape0001" };
const SCENES = [
  ["type", 3.6, "Your product deserves a *film*", "Not a screen recording with a backing track."],
  ["type", 3.6, "Films take *weeks*", "A director, an editor, a composer and a motion designer."],
  ["type", 3.2, "Meet *Reel*", "Product films, directed by AI."],
  ["asset", 7, "Start with the *brief*", "What it is, who it's for, the length, the shape, and the key messages it must land. The first is the hero.", "screen-brief"],
  ["type", 3.4, "Show it films you *love*", "Paste up to five links, each up to five minutes long."],
  ["asset", 7.5, "It learns the *look*", "Cuts, pace, colour, motion and tempo, measured frame by frame. Then the director reads the mood.", "screen-style", [M.look]],
  ["asset", 7, "Mix and *match*", "Pace from one film, palette from another, music from a blend of both. The preview follows every click.", "screen-mix", [M.look]],
  ["asset", 6, "Six themes to *build on*", "Keynote, Editorial, Neon, Swiss, Playful and Cinematic.", "screen-theme"],
  ["type", 3.6, "Then it writes the *story*", "Three-act, Save the Cat, problem-agitate-solve, the story spine and more."],
  ["asset", 7.5, "Every scene, *timed*", "The beats are split into scenes by your length and the style's pace. Every key message lands.", "screen-story", [M.shape]],
  ["asset", 6.5, "Direct the *director*", "Shorter, punchier, warmer, or your own note, one scene at a time. Or record each line yourself.", "screen-rewrite"],
  ["asset", 6.5, "Bring your *media*", "Screens, clips and music, or capture any web page at 2x.", "screen-media"],
  ["asset", 6.5, "Make it *yours*", "A logo, colours taken from it, type, and a watermark on every frame.", "screen-brand"],
  ["type", 4.2, "From brief to *finished film*", "In one place.", null, [M.hero]],
  ["asset", 6.5, "Scrub the *real* film", "The preview is the same engine the renderer uses, frame for frame.", "screen-preview"],
  ["asset", 6.5, "Rendered and *scored*", "An original track composed to the cut. It drops on your hero message.", "screen-render"],
  ["asset", 5, "Ready to *ship*", "16:9, 9:16, 1:1 or 4:5, in draft or full 1080p.", "screen-done"],
  ["type", 4, "This film was made in *Reel*", "Every cut, every frame, every note of the music."],
  ["end", 5, "Make your *reel*", "github.com/balajisriraj/reel", null, [M.hero]],
];

// ---------------------------------------------------------------- clips, fitted to their scenes
// Each clip is sped up (never more than 2.6x) to its scene's length, with its last frame held a little longer, so a
// cut that lands late on the beat never loops the clip.
function fit(name, target) {
  const src = resolve(CLIPS, `${name}.webm`);
  const mid = resolve(FIT, `${name}-cfr.mp4`);
  const out = resolve(FIT, `${name}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", "fps=30", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", mid]);
  const len = seconds(mid);
  const speed = Math.min(2.6, Math.max(0.85, (len - 0.3) / target));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mid, "-vf", `setpts=PTS/${speed.toFixed(4)},fps=30,tpad=stop_mode=clone:stop_duration=2`, "-an", "-c:v", "libx264", "-crf", "15", "-preset", "slow", "-pix_fmt", "yuv420p", out]);
  console.log(`  ${name}: ${len.toFixed(1)} s at ${speed.toFixed(2)}x`);
  return out;
}

const fitted = {};
for (const [, len, , , clip] of SCENES) if (clip && !fitted[clip]) fitted[clip] = fit(clip, len);

const project = await api("/api/projects", { method: "POST", json: { name: "Reel: the film" } });
const pid = project.id;
console.log(`project ${pid}`);
const logo = await upload(pid, resolve(OUT, "reel-logo.png"), "reel-logo.png", "image/png");
const clipIds = {};
for (const [clip, file] of Object.entries(fitted)) clipIds[clip] = (await upload(pid, file, `${clip}.mp4`, "video/mp4")).id;

// The look: learnt from the DebateDojo and Ashariri films.
const refs = [];
for (const f of ["debate-dojo", "ashariri"]) refs.push((await api(`/api/projects/${pid}/references`, { method: "POST", json: { url: `${FILMS}/${f}.mp4` } })).reference.id);
for (;;) {
  const p = await api(`/api/projects/${pid}`);
  if (p.references.every((r) => r.status === "ready" || r.status === "failed")) break;
  await sleep(800);
}
const [fight, night] = refs;

const p = await api(`/api/projects/${pid}`);
await api(`/api/projects/${pid}`, {
  method: "PATCH",
  json: {
    brief: { product: "Reel", pitch: "Product films, directed by AI. Reel learns the look of films you love, writes the story to a proven shape, and renders the film with music cut to the beat.", audience: "Product teams", cta: "Make your reel", url: "github.com/balajisriraj/reel" },
    messages: [{ id: M.hero, text: "From brief to finished film, in one place" }, { id: M.look, text: "It learns the look of films you love" }, { id: M.shape, text: "Every scene written to a proven shape" }],
    mix: { pace: fight, palette: fight, energy: fight, music: fight, type: "theme", motion: night },
    settings: { ...p.settings, duration: SCENES.reduce((a, s) => a + s[1], 0), aspect: "16:9", theme: "keynote", framework: "save-the-cat", tone: "confident", narration: "titles", music: { source: "score", asset: "", beat_sync: true, volume: 0.85 } },
    brand: { ...p.brand, logo: logo.id, colours: ["#ff8a3d", "#ff3d6e"], use_colours: true, intro: true, outro: true, corner: false, watermark: { text: "", position: "bottom-right", opacity: 0.5 } },
    scenes: SCENES.map(([visual, duration, title, sub, clip, messages = []], i) => ({
      id: `scn_film${String(i).padStart(2, "0")}`, beat: "", narration: "", title, sub, visual, asset: clip ? clipIds[clip] : "", duration, motion: "auto", transition: "auto", messages, voice: "",
    })),
  },
});

const { job } = await api(`/api/projects/${pid}/render`, { method: "POST", json: { quality: "final" } });
let last = "";
for (;;) {
  const j = await api(`/api/jobs/${job}`);
  const line = `${j.message} ${Math.round(j.progress * 100)}%`;
  if (line !== last) process.stdout.write(`\r  ${line}      `);
  last = line;
  if (j.status === "failed") throw new Error(j.message);
  if (j.status === "done") break;
  await sleep(2000);
}
const done = await api(`/api/projects/${pid}`);
const render = done.renders.at(-1);
const dataDir = arg("data");
const src = resolve(dataDir, "projects", pid, "renders", render.file);
if (!existsSync(src)) throw new Error(`render not found at ${src} (pass --data <REEL_DATA_DIR>)`);
copyFileSync(src, resolve(OUT, "reel-promo.mp4"));
copyFileSync(resolve(dataDir, "projects", pid, "renders", render.poster), resolve(OUT, "reel-poster.jpg"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", resolve(OUT, "reel-promo.mp4"), "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", resolve(OUT, "reel-promo-web.mp4")]);
console.log(`\n  ${render.duration} s -> promo/out/reel-promo.mp4, reel-promo-web.mp4, reel-poster.jpg`);
