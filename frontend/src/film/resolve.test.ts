import { describe, expect, it } from "vitest";
import type { Project, Reference, Scene, StyleDNA } from "../types";
import { parseStat, parseTitle } from "./engine";
import { buildTimeline, contrast, paletteLook, resolveLook } from "./resolve";

const dna = (over: Partial<StyleDNA> = {}): StyleDNA => ({
  duration: 30, shots: 15, cuts_per_min: 30, avg_shot: 2, rhythm: "steady", palette: ["#101820", "#f2aa4c", "#e8e8e8", "#3a6ea5", "#c0392b"],
  brightness: 0.3, saturation: 0.5, contrast: 0.6, energy: 0.8, bpm: 128, loudness: -14, mood: ["cinematic", "bold"],
  typography: "serif", transitions: "whip", camera: "handheld", captions: "kinetic", summary: "", ...over,
});
const ref = (id: string, over: Partial<StyleDNA> = {}): Reference => ({ id, url: `https://v/${id}`, title: id, status: "ready", error: "", dna: dna(over), sheet: "" });
const scene = (id: string, duration: number, over: Partial<Scene> = {}): Scene => ({ id, beat: "Setup", narration: "", title: id, sub: "", visual: "type", asset: "", duration, motion: "auto", transition: "auto", messages: [], voice: "", ...over });

const project = (over: Partial<Project> = {}): Project => ({
  id: "prj", name: "t", created: 0, updated: 0,
  brief: { product: "Lumen", pitch: "", audience: "", cta: "", url: "" },
  messages: [{ id: "hero", text: "The hero" }, { id: "m2", text: "Two" }],
  references: [],
  mix: { pace: "theme", palette: "theme", energy: "theme", music: "theme", type: "theme", motion: "theme" },
  settings: { duration: 20, aspect: "16:9", theme: "keynote", framework: "three-act", tone: "confident", narration: "captions", music: { source: "score", asset: "", beat_sync: false, volume: 0.8 } },
  brand: { logo: "", colours: ["#123456", "#abcdef"], use_colours: false, font: "theme", intro: true, outro: true, corner: false, watermark: { text: "", position: "bottom-right", opacity: 0.5 } },
  assets: [],
  scenes: [scene("a", 4), scene("b", 5, { messages: ["m2"] }), scene("c", 6, { messages: ["hero"] }), scene("d", 5, { visual: "end" })],
  renders: [],
  ...over,
});

describe("the look", () => {
  it("uses the theme until a reference is chosen", () => {
    const look = resolveLook(project({ references: [ref("r1")] }));
    expect(look.avgShot).toBe(3.2);
    expect(look.sources.pace).toBe("Keynote");
  });

  it("takes each trait from the reference it is mixed from", () => {
    const p = project({ references: [ref("r1"), ref("r2", { avg_shot: 4, bpm: 96, typography: "mono" })] });
    p.mix = { ...p.mix, pace: "r2", music: "r1", type: "r2", motion: "r1" };
    const look = resolveLook(p);
    expect(look.avgShot).toBe(4);
    expect(look.bpm).toBe(128);
    expect(look.fontKey).toBe("mono");
    expect(look.transition).toBe("whip");
    expect(look.sources.pace).toBe("r2");
  });

  it("blends numbers across references", () => {
    const p = project({ references: [ref("r1", { avg_shot: 2, energy: 0.2 }), ref("r2", { avg_shot: 4, energy: 0.6 })] });
    p.mix = { ...p.mix, pace: "blend", energy: "blend" };
    const look = resolveLook(p);
    expect(look.avgShot).toBe(3);
    expect(look.energy).toBeCloseTo(0.4);
  });

  it("keeps text readable on a borrowed palette", () => {
    for (const dark of [true, false]) {
      const l = paletteLook(dna().palette, dark);
      expect(contrast(l.fg, l.bg)).toBeGreaterThan(7);
      expect(contrast(l.accent, l.bg)).toBeGreaterThan(2.5);
    }
  });

  it("lets brand colours win", () => {
    const look = resolveLook(project({ brand: { ...project().brand, use_colours: true } }));
    expect(look.accent).toBe("#123456");
  });
});

describe("the timeline", () => {
  it("lays scenes end to end and finds the hero", () => {
    const tl = buildTimeline(project(), resolveLook(project()));
    expect(tl.duration).toBe(20);
    expect(tl.scenes.map((s) => s.start)).toEqual([0, 4, 9, 15]);
    expect(tl.scenes.find((s) => s.hero)?.id).toBe("c");
    expect(tl.marks.hero).toBe(9);
    expect(tl.marks.outro).toBe(15);
    expect(tl.scenes[0].transitionIn).toBe("cut");
  });

  it("cuts on the beat", () => {
    const p = project();
    p.settings.music.beat_sync = true;
    const look = resolveLook(p);
    const tl = buildTimeline(p, look);
    const beat = 60 / look.bpm;
    for (const s of tl.scenes) expect((s.start / beat) % 1).toBeCloseTo(0, 5);
  });

  it("stretches a scene to fit its recorded line", () => {
    const p = project({ assets: [{ id: "v", kind: "voice", name: "v", file: "v.wav", mime: "", duration: 7, width: null, height: null, bpm: null, note: "" }] });
    p.settings.narration = "voice";
    p.scenes[0] = { ...p.scenes[0], voice: "v" };
    const tl = buildTimeline(p, resolveLook(p));
    expect(tl.scenes[0].end).toBeCloseTo(7.5);
    expect(tl.voices).toEqual([{ start: 0, asset: "v" }]);
  });

  it("opens on the logo when there is one", () => {
    const p = project({ brand: { ...project().brand, logo: "logo" } });
    const tl = buildTimeline(p, resolveLook(p));
    expect(tl.scenes[0].visual).toBe("logo");
    expect(tl.duration).toBeCloseTo(22.2);
  });

  it("sizes the canvas by shape", () => {
    const p = project();
    p.settings.aspect = "9:16";
    const tl = buildTimeline(p, resolveLook(p));
    expect([tl.width, tl.height]).toEqual([1080, 1920]);
  });
});

describe("titles and stats", () => {
  it("marks starred words for the accent", () => {
    expect(parseTitle("Meet *Lumen* today")).toEqual([{ text: "Meet", emph: false }, { text: "Lumen", emph: true }, { text: "today", emph: false }]);
    expect(parseTitle("*Inbox zero* by lunch").filter((w) => w.emph).map((w) => w.text)).toEqual(["Inbox", "zero"]);
  });

  it("reads a stat so it can count up", () => {
    expect(parseStat("40%")).toMatchObject({ value: 40, suffix: "%", decimals: 0 });
    expect(parseStat("£1,200")).toMatchObject({ prefix: "£", value: 1200, grouped: true });
    expect(parseStat("3.5x faster")).toMatchObject({ value: 3.5, decimals: 1, suffix: "x faster" });
    expect(parseStat("No number")).toBeNull();
  });
});
