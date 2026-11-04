import type { Camera, Transition, Typography } from "../types";

export type FontKey = "sans" | "serif" | "mono" | "rounded" | "condensed" | "handwritten";

export const FONTS: Record<FontKey, string> = {
  sans: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Charter", "Georgia", "Times New Roman", serif',
  mono: '"SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace',
  rounded: '"SF Pro Rounded", "Nunito", "Avenir Next", "Segoe UI", system-ui, sans-serif',
  condensed: '"Avenir Next Condensed", "Helvetica Neue", "Arial Narrow", sans-serif',
  handwritten: '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive',
};

/** A reference's typography, as a font and a weight. */
export const TYPE_FONT: Record<Exclude<Typography, "none">, { font: FontKey; weight: number; tracking: number; upper: boolean }> = {
  "bold-sans": { font: "sans", weight: 800, tracking: -0.04, upper: false },
  "light-sans": { font: "sans", weight: 300, tracking: -0.02, upper: false },
  serif: { font: "serif", weight: 600, tracking: -0.02, upper: false },
  mono: { font: "mono", weight: 600, tracking: -0.03, upper: false },
  rounded: { font: "rounded", weight: 800, tracking: -0.03, upper: false },
  handwritten: { font: "handwritten", weight: 600, tracking: 0, upper: false },
};

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  bg: string;
  fg: string;
  accent: string;
  accent2: string;
  font: FontKey;
  weight: number;
  tracking: number;
  upper: boolean;
  energy: number;
  avgShot: number;
  bpm: number;
  mood: string[];
  transition: Transition;
  camera: Camera;
  backdrop: "flat" | "glow" | "grid" | "mesh" | "paper";
  grain: boolean;
  letterbox: boolean;
  align: "centre" | "left";
  radius: number;
}

export const THEMES: Theme[] = [
  {
    id: "keynote", name: "Keynote", blurb: "Dark stage, big white type, slow pushes.",
    bg: "#0b0b10", fg: "#f6f5f8", accent: "#ff6a3d", accent2: "#ffb03d", font: "sans", weight: 800, tracking: -0.045, upper: false,
    energy: 0.45, avgShot: 3.2, bpm: 104, mood: ["confident", "sleek"], transition: "fade", camera: "push", backdrop: "glow", grain: false, letterbox: false, align: "centre", radius: 22,
  },
  {
    id: "editorial", name: "Editorial", blurb: "Cream paper, serif headlines, quiet fades.",
    bg: "#f3ede3", fg: "#1f1b16", accent: "#b4532a", accent2: "#2f5d50", font: "serif", weight: 600, tracking: -0.02, upper: false,
    energy: 0.25, avgShot: 4.2, bpm: 88, mood: ["warm", "considered"], transition: "fade", camera: "pan", backdrop: "paper", grain: true, letterbox: false, align: "left", radius: 6,
  },
  {
    id: "neon", name: "Neon", blurb: "Black glass, electric gradients, whip cuts.",
    bg: "#07060d", fg: "#f4f2ff", accent: "#8b5cf6", accent2: "#22d3ee", font: "sans", weight: 800, tracking: -0.04, upper: false,
    energy: 0.8, avgShot: 1.9, bpm: 124, mood: ["energetic", "bold", "night"], transition: "whip", camera: "handheld", backdrop: "mesh", grain: false, letterbox: false, align: "centre", radius: 20,
  },
  {
    id: "swiss", name: "Swiss", blurb: "White grid, heavy grotesque, hard cuts.",
    bg: "#f7f7f5", fg: "#111111", accent: "#e30613", accent2: "#111111", font: "condensed", weight: 800, tracking: -0.03, upper: true,
    energy: 0.6, avgShot: 2.4, bpm: 116, mood: ["bold", "clean", "minimal"], transition: "cut", camera: "still", backdrop: "grid", grain: false, letterbox: false, align: "left", radius: 0,
  },
  {
    id: "playful", name: "Playful", blurb: "Pastel pop, rounded type, bouncy slides.",
    bg: "#fff3e6", fg: "#2b1b3d", accent: "#ff4f9a", accent2: "#5b8cff", font: "rounded", weight: 800, tracking: -0.03, upper: false,
    energy: 0.65, avgShot: 2.6, bpm: 118, mood: ["playful", "bright", "friendly"], transition: "slide", camera: "float", backdrop: "glow", grain: false, letterbox: false, align: "centre", radius: 32,
  },
  {
    id: "cinematic", name: "Cinematic", blurb: "Letterbox, film grain, slow and spare.",
    bg: "#0d0c0b", fg: "#ece6dc", accent: "#d9a35b", accent2: "#8aa1b1", font: "serif", weight: 500, tracking: 0.01, upper: true,
    energy: 0.2, avgShot: 4.6, bpm: 84, mood: ["cinematic", "moody", "dramatic"], transition: "fade", camera: "push", backdrop: "flat", grain: true, letterbox: true, align: "centre", radius: 4,
  },
];

export const theme = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];
