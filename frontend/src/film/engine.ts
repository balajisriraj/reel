// The film engine: draws a reel as DOM, and renderAt(t) poses every element for time t.
//
// Every frame is a pure function of time: kinetic type, camera moves, transitions, captions and the counting stats are
// computed from t alone. That's what lets the studio scrub the exact film the renderer screenshots frame by frame.
import type { Asset, Project } from "../types";
import { alpha, type Look, mixHex, type TimedScene, type Timeline } from "./resolve";

export interface FilmOptions {
  /** "render" waits for every video frame to seek exactly; "preview" lets video play in real time. */
  mode: "render" | "preview";
  assetUrl: (a: Asset) => string;
}

interface Layer {
  scene: TimedScene;
  el: HTMLDivElement;
  block?: HTMLElement;
  words: HTMLElement[];
  sub?: HTMLElement;
  media?: HTMLElement;
  /** The media fills the frame (rather than sitting in a card). */
  bleed?: boolean;
  video?: HTMLVideoElement;
  stat?: { el: HTMLElement; value: number; prefix: string; suffix: string; decimals: number; grouped: boolean };
  bar?: HTMLElement;
  captions: { el: HTMLElement; words: HTMLElement[]; from: number; to: number } | null;
}

const FONT_UI = '"Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const backOut = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;

/** "Meet *Lumen* today" -> words, with the starred ones marked for the accent colour. */
export function parseTitle(text: string): { text: string; emph: boolean }[] {
  const out: { text: string; emph: boolean }[] = [];
  for (const m of text.matchAll(/\*([^*]+)\*|([^\s*]+)/g)) {
    if (m[1]) m[1].split(/\s+/).filter(Boolean).forEach((w) => out.push({ text: w, emph: true }));
    else out.push({ text: m[2], emph: false });
  }
  return out;
}

/** A stat's number, so it can count up: "40%" -> 40 with suffix "%". */
export function parseStat(text: string) {
  const m = text.replace(/\*/g, "").match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return null;
  const raw = m[2];
  return { prefix: m[1], value: parseFloat(raw.replace(/,/g, "")), suffix: m[3], decimals: raw.includes(".") ? raw.split(".")[1].length : 0, grouped: raw.includes(",") };
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, parent?: HTMLElement, text?: string) => {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  if (text !== undefined) el.textContent = text;
  parent?.appendChild(el);
  return el;
};

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>\")";

export class Film {
  readonly root: HTMLDivElement;
  private layers: Layer[] = [];
  private backdrop: HTMLDivElement;
  private grain?: HTMLDivElement;
  private u: number;
  private playing = false;
  /** The time being posed, for the subtitles. */
  private now = 0;

  constructor(
    host: HTMLElement,
    private project: Project,
    private look: Look,
    readonly timeline: Timeline,
    private opts: FilmOptions,
  ) {
    const { width: W, height: H } = timeline;
    this.u = Math.min(W, H) / 1080;
    this.root = h("div", { position: "relative", width: `${W}px`, height: `${H}px`, overflow: "hidden", background: look.bg, color: look.fg, fontFamily: look.font, WebkitFontSmoothing: "antialiased", transformOrigin: "0 0" } as Partial<CSSStyleDeclaration>);
    this.root.className = "reel-film";
    this.backdrop = h("div", { position: "absolute", inset: "0" }, this.root);
    for (const s of timeline.scenes) this.layers.push(this.build(s));
    this.overlays();
    host.appendChild(this.root);
  }

  get assets() {
    return new Map(this.project.assets.map((a) => [a.id, a]));
  }

  setPlaying(on: boolean) {
    this.playing = on;
    if (!on) this.layers.forEach((l) => l.video?.pause());
  }

  /** Resolves when every image and video is ready to draw. */
  async ready() {
    const waits: Promise<unknown>[] = [document.fonts.ready];
    this.root.querySelectorAll("img").forEach((img) => waits.push(img.decode().catch(() => undefined)));
    this.root.querySelectorAll("video").forEach((v) =>
      waits.push(v.readyState >= 2 ? Promise.resolve() : new Promise((r) => { v.addEventListener("loadeddata", r, { once: true }); v.addEventListener("error", r, { once: true }); setTimeout(r, 15000); })),
    );
    await Promise.all(waits);
  }

  destroy() {
    this.layers.forEach((l) => l.video?.pause());
    this.root.remove();
  }

  // ---------------------------------------------------------------- building

  private text(parent: HTMLElement, title: string, size: number, opts: { align?: string; weight?: number } = {}) {
    const { look } = this;
    const block = h("div", { fontSize: `${size}px`, fontWeight: String(opts.weight ?? look.weight), letterSpacing: `${look.tracking}em`, lineHeight: look.fontKey === "serif" ? "1.08" : "1.02", textTransform: look.upper ? "uppercase" : "none", textAlign: opts.align ?? "inherit", textWrap: "balance" } as Partial<CSSStyleDeclaration>, parent);
    const words: HTMLElement[] = [];
    parseTitle(title).forEach((w, i) => {
      if (i) block.appendChild(document.createTextNode(" "));
      const span = h("span", { display: "inline-block", willChange: "transform, opacity" }, block, w.text);
      if (w.emph) {
        span.style.color = look.accent;
        if (look.theme.backdrop === "mesh") {
          span.style.backgroundImage = `linear-gradient(100deg, ${look.accent}, ${look.accent2})`;
          span.style.backgroundClip = "text";
          (span.style as CSSStyleDeclaration & { webkitBackgroundClip: string }).webkitBackgroundClip = "text";
          span.style.color = "transparent";
        }
      }
      words.push(span);
    });
    return { block, words };
  }

  private titleSize(title: string, scale = 1) {
    const n = title.replace(/\*/g, "").length;
    const { width: W, height: H } = this.timeline;
    const base = n <= 12 ? 150 : n <= 24 ? 118 : n <= 42 ? 92 : 72;
    return base * this.u * scale * (W < H ? 0.94 : 1);
  }

  private build(s: TimedScene): Layer {
    const { look, u } = this;
    const { width: W, height: H } = this.timeline;
    const portrait = W < H;
    const el = h("div", { position: "absolute", inset: "0", display: "none", willChange: "transform, opacity, filter" }, this.root);
    const layer: Layer = { scene: s, el, words: [], captions: null };
    const pad = (portrait ? 90 : 140) * u;
    const align = look.theme.align === "left" && s.visual !== "end" && s.visual !== "logo" ? "left" : "center";
    const asset = s.asset ? this.assets.get(s.asset) : undefined;

    const stack = (parent: HTMLElement, gap = 28) =>
      h("div", { position: "absolute", inset: `0 ${pad}px`, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: align === "left" ? "flex-start" : "center", textAlign: align, gap: `${gap * u}px` }, parent);

    const subLine = (parent: HTMLElement, text: string, size = 40) => {
      if (!text) return undefined;
      // Sub lines are set in the UI sans unless the look is handwritten, so long lines stay easy to read.
      return h("div", { fontSize: `${size * u}px`, fontWeight: "500", opacity: "0.72", letterSpacing: "-0.01em", lineHeight: "1.3", maxWidth: `${(portrait ? 900 : 1300) * u}px`, fontFamily: look.fontKey === "handwritten" ? look.font : FONT_UI } as Partial<CSSStyleDeclaration>, parent, text.replace(/\*/g, ""));
    };

    if (s.visual === "asset" && asset && (asset.kind === "image" || asset.kind === "video")) {
      const url = this.opts.assetUrl(asset);
      const aw = asset.width ?? 16, ah = asset.height ?? 9;
      const ratio = aw / ah, canvas = W / H;
      const phone = ratio < 0.75;
      const browser = !phone && (/\.png$/i.test(asset.file) || /capture|screen/i.test(asset.name));
      // Photos and footage close to the canvas's shape fill it; screens sit in a frame.
      const bleed = !browser && !phone && Math.abs(Math.log(ratio / canvas)) < 0.2;
      const subtitled = !!s.narration && (this.project.settings.narration === "captions" || this.project.settings.narration === "both");
      const make = (style: Partial<CSSStyleDeclaration>) => {
        if (asset.kind === "video") {
          const v = h("video", { ...style, objectFit: "cover", display: "block" } as Partial<CSSStyleDeclaration>);
          v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = true; v.crossOrigin = "anonymous";
          layer.video = v;
          return v;
        }
        const img = h("img", { ...style, objectFit: "cover", display: "block" } as Partial<CSSStyleDeclaration>);
        img.src = url; img.crossOrigin = "anonymous";
        return img;
      };
      if (bleed) {
        const wrap = h("div", { position: "absolute", inset: "0", overflow: "hidden" }, el);
        const m = make({ width: "100%", height: "100%" });
        wrap.appendChild(m);
        layer.media = m;
        layer.bleed = true;
        if (s.title || s.sub) {
          h("div", { position: "absolute", inset: "0", background: `linear-gradient(${portrait ? "0deg" : "15deg"}, ${alpha(mixHex(look.bg, "#000000", 0.4), 0.85)} 0%, ${alpha(look.bg, 0)} 55%)` }, el);
          const box = h("div", { position: "absolute", left: `${pad}px`, right: `${pad}px`, bottom: `${(portrait ? 320 : subtitled ? 190 : 120) * u}px`, display: "flex", flexDirection: "column", gap: `${18 * u}px`, color: "#fff" }, el);
          const t = this.text(box, s.title, this.titleSize(s.title, 0.72), { align: "left" });
          layer.block = t.block; layer.words = t.words;
          layer.sub = subLine(box, s.sub, 36);
        }
      } else {
        // A framed shot: a browser window for wide screens, a phone for tall ones, beside or under the headline.
        const hasText = !!(s.title || s.sub);
        const side = !portrait && hasText;
        const boxW = side ? W * (phone ? 0.36 : 0.6) : W - pad * 2;
        // A phone on a tall canvas gets more height, so its screen stays readable under the headline.
        const boxH = side ? H * 0.78 : hasText ? H * (portrait ? (phone ? 0.64 : 0.56) : 0.6) : H * 0.8;
        const chrome = browser ? 44 * u : 0;
        let mw = boxW, mh = mw / ratio + chrome;
        if (mh > boxH) { mh = boxH; mw = (mh - chrome) * ratio; }
        const card = h("div", {
          position: "absolute", width: `${mw}px`, height: `${mh}px`, overflow: "hidden",
          borderRadius: `${phone ? mw * 0.12 : look.theme.radius * u}px`,
          boxShadow: `0 ${40 * u}px ${110 * u}px -${30 * u}px rgba(0,0,0,.55), 0 0 0 ${1.5 * u}px ${alpha(look.fg, 0.12)}`,
          background: "#111", border: phone ? `${mw * 0.035}px solid #0b0b0d` : "none",
          left: side ? `${W - pad * 0.7 - mw}px` : `${(W - mw) / 2}px`,
          top: side ? `${(H - mh) / 2}px` : hasText ? `${H - mh - (portrait ? 200 : 90) * u}px` : `${(H - mh) / 2}px`,
          willChange: "transform",
        } as Partial<CSSStyleDeclaration>, el);
        if (browser) {
          const bar = h("div", { height: `${chrome}px`, background: mixHex(look.bg, look.fg, 0.08), display: "flex", alignItems: "center", gap: `${10 * u}px`, padding: `0 ${18 * u}px` }, card);
          ["#ff5f57", "#febc2e", "#28c840"].forEach((c) => h("i", { width: `${13 * u}px`, height: `${13 * u}px`, borderRadius: "50%", background: c, display: "block" }, bar));
        }
        card.appendChild(make({ width: "100%", height: `calc(100% - ${chrome}px)`, objectPosition: "top" }));
        layer.media = card;
        if (hasText) {
          const box = side
            ? h("div", { position: "absolute", left: `${pad}px`, width: `${W - mw - pad * 2.2}px`, top: "0", bottom: "0", display: "flex", flexDirection: "column", justifyContent: "center", gap: `${22 * u}px` }, el)
            : h("div", { position: "absolute", left: `${pad}px`, right: `${pad}px`, top: `${(portrait ? 200 : 70) * u}px`, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: `${18 * u}px` }, el);
          const t = this.text(box, s.title, this.titleSize(s.title, side ? 0.8 : 0.66), { align: side ? "left" : "center" });
          layer.block = t.block; layer.words = t.words;
          layer.sub = subLine(box, s.sub, side ? 31 : 34);
        }
      }
    } else if (s.visual === "stat") {
      const box = stack(el, 10);
      const stat = parseStat(s.title);
      const big = h("div", { fontSize: `${(portrait ? 260 : 300) * u}px`, fontWeight: "800", letterSpacing: "-0.05em", lineHeight: "1", color: look.accent, fontVariantNumeric: "tabular-nums" } as Partial<CSSStyleDeclaration>, box, s.title.replace(/\*/g, ""));
      if (stat) layer.stat = { el: big, ...stat };
      layer.block = big;
      layer.sub = subLine(box, s.sub, 46);
    } else if (s.visual === "quote") {
      const box = stack(el, 26);
      h("div", { fontSize: `${220 * u}px`, lineHeight: "0.6", height: `${110 * u}px`, color: look.accent, fontFamily: '"Georgia", serif' }, box, "“");
      const t = this.text(box, s.title, this.titleSize(s.title, 0.78), { weight: Math.min(look.weight, 700) });
      layer.block = t.block; layer.words = t.words;
      layer.sub = subLine(box, s.sub, 34);
    } else if (s.visual === "logo" || s.visual === "end") {
      const box = stack(el, s.visual === "end" ? 34 : 30);
      const logo = this.project.brand.logo ? this.assets.get(this.project.brand.logo) : undefined;
      const showLogo = logo && (s.visual === "logo" || this.project.brand.outro);
      if (showLogo) {
        const img = h("img", { maxWidth: `${(s.visual === "end" ? 300 : 520) * u}px`, maxHeight: `${(s.visual === "end" ? 140 : 260) * u}px`, objectFit: "contain", display: "block" } as Partial<CSSStyleDeclaration>, box);
        img.src = this.opts.assetUrl(logo);
        layer.media = img;
      }
      if (s.title && !(s.visual === "logo" && showLogo && s.intro)) {
        const t = this.text(box, s.title, this.titleSize(s.title, s.visual === "end" ? 0.9 : 0.8));
        layer.block = t.block; layer.words = t.words;
      }
      if (s.sub) {
        const pill = h("div", { fontSize: `${38 * u}px`, fontWeight: "600", padding: `${14 * u}px ${34 * u}px`, borderRadius: "999px", border: `${3 * u}px solid ${look.accent}`, color: look.fg, letterSpacing: "-0.01em" }, box, s.sub.replace(/\*/g, ""));
        layer.sub = pill;
      }
    } else {
      const box = stack(el);
      const t = this.text(box, s.title, this.titleSize(s.title, s.hero ? 1.12 : 1));
      layer.block = t.block; layer.words = t.words;
      if (s.hero) layer.bar = h("div", { height: `${10 * u}px`, width: `${240 * u}px`, borderRadius: "999px", background: `linear-gradient(90deg, ${look.accent}, ${look.accent2})`, transformOrigin: align === "left" ? "left" : "center" }, box);
      layer.sub = subLine(box, s.sub);
    }

    // Subtitles for the narration, timed word by word to the voice or the scene.
    const subtitled = this.project.settings.narration === "captions" || this.project.settings.narration === "both";
    if (subtitled && s.narration) {
      const voice = s.voice ? this.assets.get(s.voice) : undefined;
      const from = s.start + 0.15;
      const to = voice?.duration && this.project.settings.narration === "both" ? from + voice.duration : s.start + (s.end - s.start) * 0.92;
      const cap = h("div", {
        position: "absolute", left: "50%", bottom: `${(portrait ? 170 : this.look.theme.letterbox ? 150 : 70) * u}px`, transform: "translateX(-50%)",
        maxWidth: `${(portrait ? 920 : 1500) * u}px`, width: "max-content", textAlign: "center", fontFamily: FONT_UI,
        fontSize: `${(portrait ? 46 : 40) * u}px`, fontWeight: "600", lineHeight: "1.3", padding: `${12 * u}px ${26 * u}px`, borderRadius: `${16 * u}px`,
        background: alpha(mixHex(look.bg, "#000000", 0.5), 0.62), color: "#fff", backdropFilter: `blur(${10 * u}px)`, zIndex: "6",
      } as Partial<CSSStyleDeclaration>, this.root);
      const words = s.narration.split(/\s+/).filter(Boolean).map((w, i) => {
        if (i) cap.appendChild(document.createTextNode(" "));
        return h("span", { transition: "none" }, cap, w);
      });
      layer.captions = { el: cap, words, from, to };
    }
    return layer;
  }

  private overlays() {
    const { look, u, project } = this;
    const { width: W, height: H } = this.timeline;
    if (look.theme.letterbox && W > H) {
      h("div", { position: "absolute", left: "0", right: "0", top: "0", height: `${H * 0.1}px`, background: "#000", zIndex: "8" }, this.root);
      h("div", { position: "absolute", left: "0", right: "0", bottom: "0", height: `${H * 0.1}px`, background: "#000", zIndex: "8" }, this.root);
    }
    if (look.theme.grain) this.grain = h("div", { position: "absolute", inset: "-50%", backgroundImage: GRAIN, opacity: "0.09", mixBlendMode: "overlay", zIndex: "9", pointerEvents: "none" } as Partial<CSSStyleDeclaration>, this.root);
    const wm = project.brand.watermark;
    const inset = (look.theme.letterbox && W > H ? H * 0.1 : 0) + 40 * u;
    const pos = (p: string) => ({ [p.startsWith("top") ? "top" : "bottom"]: `${inset}px`, [p.endsWith("left") ? "left" : "right"]: `${48 * u}px` });
    if (wm.text.trim()) {
      h("div", { position: "absolute", ...pos(wm.position), fontFamily: FONT_UI, fontSize: `${24 * u}px`, fontWeight: "600", letterSpacing: "0.02em", color: look.fg, opacity: String(wm.opacity), zIndex: "10", textShadow: "0 1px 6px rgba(0,0,0,.25)" } as Partial<CSSStyleDeclaration>, this.root, wm.text);
    }
    const logo = project.brand.logo ? this.assets.get(project.brand.logo) : undefined;
    if (project.brand.corner && logo) {
      const corner = wm.text.trim() && wm.position === "top-right" ? "top-left" : "top-right";
      const img = h("img", { position: "absolute", ...pos(corner), height: `${54 * u}px`, maxWidth: `${220 * u}px`, objectFit: "contain", opacity: "0.92", zIndex: "10" } as Partial<CSSStyleDeclaration>, this.root);
      img.src = this.opts.assetUrl(logo);
    }
  }

  // ---------------------------------------------------------------- posing

  private paintBackdrop(t: number) {
    const { look, u } = this;
    const b = this.backdrop.style;
    const drift = (k: number, a: number) => 50 + Math.sin(t * k) * a;
    switch (look.theme.backdrop) {
      case "glow":
        b.background = `radial-gradient(60% 70% at ${drift(0.11, 18)}% ${drift(0.09, 12) - 20}%, ${alpha(look.accent, 0.2)}, transparent 70%), radial-gradient(50% 60% at ${drift(0.07, 20) + 10}% ${drift(0.12, 14) + 30}%, ${alpha(look.accent2, 0.14)}, transparent 70%), ${look.bg}`;
        break;
      case "mesh":
        b.background = `radial-gradient(40% 50% at ${drift(0.21, 25)}% ${drift(0.17, 20)}%, ${alpha(look.accent, 0.38)}, transparent 70%), radial-gradient(45% 55% at ${drift(0.15, 30) + 15}% ${drift(0.19, 25) + 25}%, ${alpha(look.accent2, 0.3)}, transparent 70%), radial-gradient(35% 45% at ${drift(0.13, 30) - 15}% ${drift(0.23, 20) + 30}%, ${alpha(mixHex(look.accent, look.accent2, 0.5), 0.22)}, transparent 70%), ${look.bg}`;
        break;
      case "grid": {
        const g = 120 * u;
        b.background = `linear-gradient(${alpha(look.fg, 0.07)} 1px, transparent 1px) 0 0 / ${g}px ${g}px, linear-gradient(90deg, ${alpha(look.fg, 0.07)} 1px, transparent 1px) 0 0 / ${g}px ${g}px, ${look.bg}`;
        break;
      }
      case "paper":
        b.background = `radial-gradient(120% 90% at 50% 40%, ${look.bg} 55%, ${mixHex(look.bg, "#7a5c3c", 0.16)} 100%)`;
        break;
      default:
        b.background = look.bg;
    }
    if (this.grain) {
      const f = Math.floor(t * 24);
      this.grain.style.transform = `translate(${((f * 37) % 100) - 50}px, ${((f * 61) % 100) - 50}px)`;
    }
  }

  private pose(layer: Layer, lt: number) {
    const { look, u } = this;
    const s = layer.scene;
    const d = s.end - s.start;
    const p = clamp(lt / d);
    const e = look.energy;
    const stagger = 0.1 - e * 0.05;
    const bouncy = look.theme.id === "playful";

    layer.words.forEach((w, i) => {
      const q = clamp((lt - 0.08 - i * stagger) / (0.55 - e * 0.2));
      const k = bouncy ? backOut(q) : easeOut(q);
      w.style.opacity = String(clamp(q * 1.6));
      w.style.transform = `translateY(${(1 - k) * 0.42}em)${s.hero ? ` scale(${0.94 + 0.06 * k})` : ""}`;
      w.style.filter = look.theme.id === "neon" && q < 1 ? `blur(${(1 - q) * 10 * u}px)` : "none";
    });
    const after = 0.15 + layer.words.length * stagger;
    if (layer.sub) {
      const q = easeOut(clamp((lt - after) / 0.5));
      layer.sub.style.opacity = String(q * (layer.sub.style.borderRadius ? 1 : 0.72));
      layer.sub.style.transform = `translateY(${(1 - q) * 24 * u}px)`;
    }
    if (layer.bar) layer.bar.style.transform = `scaleX(${easeInOut(clamp((lt - after) / 0.7))})`;
    if (layer.stat) {
      const { el, value, prefix, suffix, decimals, grouped } = layer.stat;
      const v = value * easeOut(clamp((lt - 0.1) / 1.1));
      const num = grouped ? v.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
      el.textContent = `${prefix}${num}${suffix}`;
      const q = easeOut(clamp(lt / 0.4));
      el.style.opacity = String(q);
      el.style.transform = `scale(${0.9 + 0.1 * q})`;
    }

    // The camera: on the media when there is some, gently on the type otherwise.
    const target = layer.media ?? layer.block;
    if (target) {
      const full = !!layer.bleed;
      const amp = (full ? 1 : 0.45) * (0.5 + e);
      let tf = "";
      switch (s.camera) {
        case "push": tf = `scale(${1 + 0.07 * amp * easeInOut(p)})`; break;
        case "pan": tf = `translateX(${(0.5 - p) * 5 * amp}%) scale(${full ? 1.08 : 1})`; break;
        case "handheld": tf = `translate(${Math.sin(lt * 1.3) * 7 * u * amp}px, ${Math.sin(lt * 2.1 + 1) * 5 * u * amp}px) rotate(${Math.sin(lt * 0.9) * 0.35 * amp}deg) scale(${full ? 1.05 : 1})`; break;
        case "float": tf = `translateY(${Math.sin(lt * 1.2) * 12 * u * amp}px) rotate(${Math.sin(lt * 0.7) * 0.6 * amp}deg)`; break;
        default: tf = "";
      }
      if (layer.media && !full && s.visual === "asset") {
        const q = (bouncy ? backOut : easeOut)(clamp(lt / 0.7));
        tf = `translateY(${(1 - q) * 80 * u}px) ${tf}`;
        layer.media.style.opacity = String(clamp(q * 1.4));
      } else if (layer.media && (s.visual === "logo" || s.visual === "end")) {
        const q = backOut(clamp(lt / 0.8));
        tf = `scale(${0.6 + 0.4 * q})`;
        layer.media.style.opacity = String(clamp(q * 1.5));
      }
      target.style.transform = tf;
    }

    if (layer.captions) {
      const { el, words, from, to } = layer.captions;
      const span = Math.max(0.5, to - from);
      const shown = clamp((this.now - from) / span);
      const n = Math.ceil(shown * words.length);
      const kinetic = look.captions === "kinetic";
      words.forEach((w, i) => {
        w.style.opacity = i < n ? "1" : kinetic ? "0.38" : "1";
        w.style.color = kinetic && i === n - 1 ? look.accent2 : "#fff";
      });
      el.style.opacity = String(clamp((this.now - s.start) / 0.25) * clamp((s.end - this.now) / 0.2));
    }
  }

  private transition(layer: Layer, q: number, incoming: boolean) {
    const k = easeInOut(q);
    const st = layer.el.style;
    const tr = layer.scene.transitionIn;
    const portrait = this.timeline.height > this.timeline.width;
    const axis = portrait ? "Y" : "X";
    st.opacity = "1"; st.filter = "none"; st.transform = "none";
    if (incoming) {
      if (tr === "fade") st.opacity = String(k);
      if (tr === "slide") st.transform = `translate${axis}(${(1 - k) * 100}%)`;
      if (tr === "zoom") { st.transform = `scale(${0.9 + 0.1 * k})`; st.opacity = String(k); }
      if (tr === "whip") { st.transform = `translate${axis}(${(1 - k) * 100}%)`; st.filter = `blur(${(1 - k) * 22 * this.u}px)`; }
    } else {
      if (tr === "fade") st.opacity = String(1 - k);
      if (tr === "slide") st.transform = `translate${axis}(${-k * 35}%)`;
      if (tr === "zoom") { st.transform = `scale(${1 + 0.18 * k})`; st.opacity = String(1 - k); }
      if (tr === "whip") { st.transform = `translate${axis}(${-k * 100}%)`; st.filter = `blur(${k * 22 * this.u}px)`; }
    }
  }

  /** Pose the film at time t. In render mode it resolves once any video on screen has seeked to its frame. */
  async renderAt(t: number): Promise<void> {
    const tl = this.timeline;
    t = clamp(t, 0, Math.max(0, tl.duration - 1e-3));
    this.now = t;
    this.paintBackdrop(t);
    const i = Math.max(0, tl.scenes.findIndex((s) => t >= s.start && t < s.end));
    const cur = this.layers[i];
    const lt = t - cur.scene.start;
    const inTransition = i > 0 && cur.scene.transitionTime > 0 && lt < cur.scene.transitionTime;
    const prev = inTransition ? this.layers[i - 1] : undefined;
    const seeks: Promise<void>[] = [];

    this.layers.forEach((l) => {
      const on = l === cur || l === prev;
      l.el.style.display = on ? "block" : "none";
      if (l.captions) l.captions.el.style.display = l === cur ? "block" : "none";
      if (!on && l.video && !l.video.paused) l.video.pause();
      if (!on) return;
      const local = t - l.scene.start;
      this.pose(l, Math.min(local, l.scene.end - l.scene.start));
      if (inTransition) this.transition(l, lt / cur.scene.transitionTime, l === cur);
      else Object.assign(l.el.style, { opacity: "1", transform: "none", filter: "none" });
      l.el.style.zIndex = l === cur ? "2" : "1";
      if (l.video) seeks.push(this.syncVideo(l.video, local));
    });
    await Promise.all(seeks);
  }

  private async syncVideo(v: HTMLVideoElement, local: number) {
    const len = v.duration || 0;
    const want = len ? Math.min(local, len - 0.05) % Math.max(len, 0.1) : Math.max(0, local);
    if (this.opts.mode === "preview") {
      if (this.playing) {
        if (v.paused) v.play().catch(() => undefined);
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
      } else if (Math.abs(v.currentTime - want) > 0.04) {
        v.pause();
        v.currentTime = want;
      }
      return;
    }
    if (Math.abs(v.currentTime - want) < 0.001 && v.readyState >= 2) return;
    await new Promise<void>((resolve) => {
      const done = () => { v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      v.currentTime = want;
      setTimeout(done, 4000);
    });
  }
}
