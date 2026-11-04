"""The shape of a reel project.

A project is one JSON document: the brief, the key messages, the style references and how to mix them, the settings,
the brand, the uploaded media, the scenes and the renders. The film engine in the browser resolves it into a timeline,
so the preview and the final render are drawn by the same code.
"""

from __future__ import annotations

import secrets
import time
from typing import Literal

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(5)}"


class Brief(BaseModel):
    product: str = ""
    pitch: str = ""
    audience: str = ""
    cta: str = ""
    url: str = ""


class KeyMessage(BaseModel):
    """A point the reel must land. The first one in the list is the hero: the music drops on it."""

    id: str = Field(default_factory=lambda: new_id("msg"))
    text: str


class StyleDNA(BaseModel):
    """What Reel measured in a reference video, plus how it reads to a director."""

    duration: float
    shots: int
    cuts_per_min: float
    avg_shot: float
    rhythm: Literal["steady", "varied", "accelerating"]
    palette: list[str]
    brightness: float
    saturation: float
    contrast: float
    energy: float
    bpm: float | None = None
    loudness: float | None = None
    # From the director's eye (Claude, or the scripted model reading the numbers).
    mood: list[str] = []
    typography: Literal["bold-sans", "light-sans", "serif", "mono", "rounded", "handwritten", "none"] = "bold-sans"
    transitions: Literal["cut", "fade", "slide", "zoom", "whip"] = "cut"
    camera: Literal["still", "push", "pan", "handheld", "float"] = "push"
    captions: Literal["none", "subtitles", "kinetic", "titles"] = "titles"
    summary: str = ""


class Reference(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ref"))
    url: str
    title: str = ""
    status: Literal["queued", "analysing", "ready", "failed"] = "queued"
    error: str = ""
    dna: StyleDNA | None = None
    # The contact sheet the analysis looked at, served for the style card.
    sheet: str = ""


Trait = Literal["pace", "palette", "energy", "music", "type", "motion"]


class Mix(BaseModel):
    """Where each trait of the look comes from: "theme", "blend" (all references), or a reference id."""

    pace: str = "theme"
    palette: str = "theme"
    energy: str = "theme"
    music: str = "theme"
    type: str = "theme"
    motion: str = "theme"


class Music(BaseModel):
    source: Literal["score", "upload", "none"] = "score"
    asset: str = ""
    beat_sync: bool = True
    volume: float = 0.8


class ReelSettings(BaseModel):
    duration: float = 60
    aspect: Literal["16:9", "9:16", "1:1", "4:5"] = "16:9"
    theme: str = "keynote"
    framework: str = "three-act"
    tone: str = "confident"
    narration: Literal["captions", "voice", "both", "titles"] = "captions"
    music: Music = Music()


class Watermark(BaseModel):
    text: str = ""
    position: Literal["top-left", "top-right", "bottom-left", "bottom-right"] = "bottom-right"
    opacity: float = 0.5


class Brand(BaseModel):
    logo: str = ""
    colours: list[str] = ["#ff6a3d", "#ffd166"]
    use_colours: bool = False
    font: Literal["theme", "sans", "serif", "mono", "rounded", "condensed"] = "theme"
    intro: bool = True
    outro: bool = True
    corner: bool = False
    watermark: Watermark = Watermark()


class Asset(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ast"))
    kind: Literal["image", "video", "audio", "voice"]
    name: str
    file: str
    mime: str = ""
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    # Tempo of an uploaded track, so scenes can cut on its beat.
    bpm: float | None = None
    note: str = ""


Visual = Literal["type", "asset", "stat", "quote", "logo", "end"]


class Scene(BaseModel):
    id: str = Field(default_factory=lambda: new_id("scn"))
    beat: str = ""
    narration: str = ""
    # On-screen text. Words wrapped in *asterisks* are drawn in the accent colour.
    title: str = ""
    sub: str = ""
    visual: Visual = "type"
    asset: str = ""
    duration: float = 4.0
    motion: Literal["auto", "push", "pan", "still", "float"] = "auto"
    transition: Literal["auto", "cut", "fade", "slide", "zoom", "whip"] = "auto"
    messages: list[str] = []
    voice: str = ""


class Render(BaseModel):
    id: str = Field(default_factory=lambda: new_id("ren"))
    file: str
    poster: str
    created: float = Field(default_factory=time.time)
    duration: float
    aspect: str
    quality: Literal["draft", "final"]


class Project(BaseModel):
    id: str = Field(default_factory=lambda: new_id("prj"))
    name: str = "Untitled reel"
    created: float = Field(default_factory=time.time)
    updated: float = Field(default_factory=time.time)
    brief: Brief = Brief()
    messages: list[KeyMessage] = []
    references: list[Reference] = []
    mix: Mix = Mix()
    settings: ReelSettings = ReelSettings()
    brand: Brand = Brand()
    assets: list[Asset] = []
    scenes: list[Scene] = []
    renders: list[Render] = []


class Job(BaseModel):
    id: str = Field(default_factory=lambda: new_id("job"))
    project: str
    kind: Literal["analyse", "render", "capture"]
    status: Literal["running", "done", "failed"] = "running"
    progress: float = 0.0
    message: str = ""
    result: dict = {}
