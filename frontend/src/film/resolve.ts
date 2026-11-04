// Resolves a project into what the engine draws: the look (theme + mixed references + brand) and the timeline.
// The preview and the renderer both call this, so what you scrub is what you get.
import type { Aspect, Camera, Project, Reference, Scene, StyleDNA, Trait, Transition } from "../types";
import { FONTS, type FontKey, type Theme, TYPE_FONT, theme as themeById } from "./themes";

// ---------------------------------------------------------------- colour

export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const saturation = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx ? (mx - mn) / mx : 0;
};
export const mixHex = (a: string, b: string, t: number) => {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
};
export const alpha = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Pick a stage, ink and two accents from a measured palette, keeping text readable. */
export function paletteLook(palette: string[], dark: boolean) {
  const byLum = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const bg = dark ? mixHex(byLum[0], "#000000", 0.55) : mixHex(byLum[byLum.length - 1], "#ffffff", 0.6);
  const fg = dark ? "#f7f5f2" : "#15131a";
  const vivid = [...palette].sort((a, b) => saturation(b) - saturation(a));
  const readable = (c: string) => (contrast(c, bg) >= 2.6 ? c : mixHex(c, dark ? "#ffffff" : "#000000", 0.35));
  return { bg, fg, accent: readable(vivid[0] ?? "#ff6a3d"), accent2: readable(vivid[1] ?? vivid[0] ?? "#ffb03d") };
}

// ---------------------------------------------------------------- the look

export interface Look {
  theme: Theme;
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
  palette: string[];
  font: string;
  fontKey: FontKey;
  weight: number;
  tracking: number;
  upper: boolean;
  energy: number;
  avgShot: number;
  bpm: number;
  mood: string[];
  transition: Transition;
  camera: Camera;
  captions: "subtitles" | "kinetic" | "titles" | "none";
  sources: Record<Trait, string>;
}

const ready = (p: Project) => p.references.filter((r): r is Reference & { dna: StyleDNA } => r.status === "ready" && !!r.dna);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const mode = <T,>(xs: T[]): T | undefined => {
  const n = new Map<T, number>();
  xs.forEach((x) => n.set(x, (n.get(x) ?? 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** The references a trait draws from: none (theme), all (blend), or one. */
export function sourcesFor(p: Project, trait: Trait): StyleDNA[] {
  const refs = ready(p);
  const pick = p.mix[trait];
  if (pick === "theme") return [];
  if (pick === "blend") return refs.map((r) => r.dna);
  const one = refs.find((r) => r.id === pick);
  return one ? [one.dna] : [];
}

export function resolveLook(p: Project): Look {
  const t = themeById(p.settings.theme);
  const label = (trait: Trait) => {
    const pick = p.mix[trait];
    if (pick === "theme" || !sourcesFor(p, trait).length) return t.name;
    if (pick === "blend") return "Blend";
    return ready(p).find((r) => r.id === pick)?.title || "Reference";
  };

  const pace = sourcesFor(p, "pace");
  const pal = sourcesFor(p, "palette");
  const en = sourcesFor(p, "energy");
  const mus = sourcesFor(p, "music");
  const typ = sourcesFor(p, "type");
  const mot = sourcesFor(p, "motion");

  let { bg, fg, accent, accent2 } = t;
  let palette = [t.bg, t.accent, t.accent2, t.fg];
  if (pal.length) {
    palette = pal.flatMap((d) => d.palette.slice(0, pal.length > 1 ? 3 : 5));
    const dark = mean(pal.map((d) => d.brightness)) < 0.55;
    ({ bg, fg, accent, accent2 } = paletteLook(palette, dark));
  }
  if (p.brand.use_colours && p.brand.colours.length) {
    accent = p.brand.colours[0];
    accent2 = p.brand.colours[1] ?? p.brand.colours[0];
  }

  let fontKey: FontKey = t.font;
  let { weight, tracking, upper } = t;
  const typography = mode(typ.map((d) => d.typography).filter((x): x is Exclude<typeof x, "none"> => x !== "none"));
  if (typography) ({ font: fontKey, weight, tracking, upper } = { ...TYPE_FONT[typography], upper: t.upper && TYPE_FONT[typography].font === t.font });
  if (p.brand.font !== "theme") fontKey = p.brand.font;

  const bpms = mus.map((d) => d.bpm).filter((b): b is number => !!b);
  return {
    theme: t,
    bg, fg, accent, accent2, palette,
    font: FONTS[fontKey],
    fontKey, weight, tracking, upper,
    energy: en.length ? mean(en.map((d) => d.energy)) : t.energy,
    avgShot: pace.length ? mean(pace.map((d) => d.avg_shot)) : t.avgShot,
    bpm: bpms.length ? Math.round(mean(bpms)) : t.bpm,
    mood: mus.length ? [...new Set(mus.flatMap((d) => d.mood))].slice(0, 5) : t.mood,
    transition: mode(mot.map((d) => d.transitions)) ?? t.transition,
    camera: mode(mot.map((d) => d.camera)) ?? t.camera,
    captions: mode(mot.map((d) => d.captions)) ?? "titles",
    sources: { pace: label("pace"), palette: label("palette"), energy: label("energy"), music: label("music"), type: label("type"), motion: label("motion") },
  };
}

// ---------------------------------------------------------------- the timeline

export const SIZES: Record<Aspect, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

export interface TimedScene extends Scene {
  index: number;
  start: number;
  end: number;
  transitionIn: Transition;
  transitionTime: number;
  camera: Camera;
  hero: boolean;
  emphasis: boolean;
  intro?: boolean;
}

export interface Timeline {
  width: number;
  height: number;
  duration: number;
  scenes: TimedScene[];
  marks: { reveal: number; heroIn: number; hero: number; heroEnd: number; outro: number; hits: number[]; bpm: number };
  voices: { start: number; asset: string }[];
  mood: string[];
  energy: number;
  bpm: number;
}

const TRANSITION_TIME: Record<Transition, number> = { cut: 0, fade: 0.6, slide: 0.5, zoom: 0.55, whip: 0.34 };

export function musicBpm(p: Project, look: Look): number | null {
  const m = p.settings.music;
  if (m.source === "score") return look.bpm;
  if (m.source === "upload") return p.assets.find((a) => a.id === m.asset)?.bpm ?? null;
  return null;
}

export function buildTimeline(p: Project, look: Look): Timeline {
  const [width, height] = SIZES[p.settings.aspect];
  const hero = p.messages[0]?.id;
  const voiced = p.settings.narration === "voice" || p.settings.narration === "both";
  const voiceLen = (s: Scene) => (voiced && s.voice ? (p.assets.find((a) => a.id === s.voice)?.duration ?? 0) : 0);

  let base: Scene[] = p.scenes.length
    ? p.scenes
    : [{ id: "placeholder", beat: "", narration: "", title: p.brief.product ? `*${p.brief.product}*` : "Your *reel* starts here", sub: p.brief.pitch || "Write the script in Story", visual: "type", asset: "", duration: 5, motion: "auto", transition: "auto", messages: [], voice: "" }];
  if (p.brand.intro && p.brand.logo && p.scenes.length) {
    base = [{ id: "intro", beat: "Intro", narration: "", title: p.brief.product, sub: "", visual: "logo", asset: p.brand.logo, duration: 2.2, motion: "auto", transition: "cut", messages: [], voice: "" }, ...base];
  }

  // Scene lengths: as written, stretched to fit a recorded line, then snapped to the beat.
  let lengths = base.map((s) => Math.max(1.2, s.duration, voiceLen(s) + 0.5));
  const bpm = musicBpm(p, look);
  if (p.settings.music.beat_sync && bpm) {
    const beat = 60 / bpm;
    let t = 0, snapped = 0;
    lengths = lengths.map((len) => {
      t += len;
      const edge = Math.max(snapped + beat, Math.round(t / beat) * beat);
      const out = edge - snapped;
      snapped = edge;
      return out;
    });
  }

  let start = 0;
  let heroSeen = false;
  const scenes: TimedScene[] = base.map((s, index) => {
    const tr: Transition = index === 0 ? "cut" : s.transition === "auto" ? look.transition : s.transition;
    const isHero = !heroSeen && !!hero && s.messages.includes(hero) && index > 0 && index < base.length - 1;
    heroSeen ||= isHero;
    const camera: Camera = s.motion === "auto" ? look.camera : s.motion;
    const out: TimedScene = {
      ...s, index, start, end: start + lengths[index], transitionIn: tr, transitionTime: Math.min(TRANSITION_TIME[tr] * (1.15 - look.energy * 0.4), lengths[index] / 3),
      camera, hero: isHero, emphasis: s.messages.length > 0, intro: s.id === "intro",
    };
    start += lengths[index];
    return out;
  });
  if (!heroSeen && scenes.length > 2) scenes[Math.floor(scenes.length * 0.6)].hero = true;

  const duration = start;
  const heroScene = scenes.find((s) => s.hero) ?? scenes[0];
  const reveal = Math.min(scenes[0].end, duration * 0.3);
  const barLen = (4 * 60) / (bpm ?? look.bpm);
  const hits = scenes.filter((s) => s.emphasis && !s.hero && s.index > 0).map((s) => s.start).slice(0, 5);
  return {
    width, height, duration,
    scenes,
    marks: {
      reveal,
      heroIn: Math.max(reveal + 0.5, heroScene.start - 2 * barLen),
      hero: heroScene.start,
      heroEnd: Math.min(duration - 1, Math.max(heroScene.end, heroScene.start + 2 * barLen)),
      outro: scenes[scenes.length - 1].start,
      hits: [heroScene.start, ...hits].sort((a, b) => a - b),
      bpm: bpm ?? look.bpm,
    },
    voices: voiced ? scenes.filter((s) => s.voice).map((s) => ({ start: s.start, asset: s.voice })) : [],
    mood: look.mood,
    energy: look.energy,
    bpm: bpm ?? look.bpm,
  };
}

/** Seconds of screen time per key message, and how many scenes carry it. */
export function coverage(p: Project) {
  return p.messages.map((m, i) => {
    const scenes = p.scenes.filter((s) => s.messages.includes(m.id));
    return { message: m, hero: i === 0, scenes: scenes.length, seconds: scenes.reduce((a, s) => a + s.duration, 0) };
  });
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
