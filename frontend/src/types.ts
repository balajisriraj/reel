// The project document, mirroring backend/reel/models.py.

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Visual = "type" | "asset" | "stat" | "quote" | "logo" | "end";
export type Transition = "cut" | "fade" | "slide" | "zoom" | "whip";
export type Camera = "still" | "push" | "pan" | "handheld" | "float";
export type Typography = "bold-sans" | "light-sans" | "serif" | "mono" | "rounded" | "handwritten" | "none";
export type Narration = "captions" | "voice" | "both" | "titles";
export type Trait = "pace" | "palette" | "energy" | "music" | "type" | "motion";
export const TRAITS: Trait[] = ["pace", "palette", "energy", "music", "type", "motion"];

export interface Brief { product: string; pitch: string; audience: string; cta: string; url: string }
export interface KeyMessage { id: string; text: string }

export interface StyleDNA {
  duration: number;
  shots: number;
  cuts_per_min: number;
  avg_shot: number;
  rhythm: "steady" | "varied" | "accelerating";
  palette: string[];
  brightness: number;
  saturation: number;
  contrast: number;
  energy: number;
  bpm: number | null;
  loudness: number | null;
  mood: string[];
  typography: Typography;
  transitions: Transition;
  camera: Camera;
  captions: "none" | "subtitles" | "kinetic" | "titles";
  summary: string;
}

export interface Reference {
  id: string;
  url: string;
  title: string;
  status: "queued" | "analysing" | "ready" | "failed";
  error: string;
  dna: StyleDNA | null;
  sheet: string;
}

export type Mix = Record<Trait, string>;

export interface Music { source: "score" | "upload" | "none"; asset: string; beat_sync: boolean; volume: number }
export interface ReelSettings {
  duration: number;
  aspect: Aspect;
  theme: string;
  framework: string;
  tone: string;
  narration: Narration;
  music: Music;
}

export interface Watermark { text: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; opacity: number }
export interface Brand {
  logo: string;
  colours: string[];
  use_colours: boolean;
  font: "theme" | "sans" | "serif" | "mono" | "rounded" | "condensed";
  intro: boolean;
  outro: boolean;
  corner: boolean;
  watermark: Watermark;
}

export interface Asset {
  id: string;
  kind: "image" | "video" | "audio" | "voice";
  name: string;
  file: string;
  mime: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  bpm: number | null;
  note: string;
}

export interface Scene {
  id: string;
  beat: string;
  narration: string;
  title: string;
  sub: string;
  visual: Visual;
  asset: string;
  duration: number;
  motion: "auto" | Exclude<Camera, "handheld">;
  transition: "auto" | Transition;
  messages: string[];
  voice: string;
}

export interface Render { id: string; file: string; poster: string; created: number; duration: number; aspect: Aspect; quality: "draft" | "final" }

export interface Project {
  id: string;
  name: string;
  created: number;
  updated: number;
  brief: Brief;
  messages: KeyMessage[];
  references: Reference[];
  mix: Mix;
  settings: ReelSettings;
  brand: Brand;
  assets: Asset[];
  scenes: Scene[];
  renders: Render[];
}

export interface Job { id: string; project: string; kind: "analyse" | "render" | "capture"; status: "running" | "done" | "failed"; progress: number; message: string; result: Record<string, unknown> }

export interface Beat { name: string; purpose: string; share: number }
export interface Framework { id: string; name: string; blurb: string; beats: Beat[] }
export interface Meta {
  director: "claude" | "scripted";
  model: string;
  frameworks: Framework[];
  tones: { id: string; description: string }[];
  limits: { reference_seconds: number; references: number; duration: number; upload_mb: number };
}

export interface ProjectCard { id: string; name: string; updated: number; aspect: Aspect; duration: number; scenes: number; poster: string }
