"""The director: reads a reference's look, writes the script, and rewrites a scene on request.

Two directors share one interface. ``ClaudeDirector`` uses Claude with structured outputs (and vision for the style
read). ``ScriptedDirector`` is deterministic and offline, so the whole product runs, tests and demos with no API key.

The script is written into a slot plan: the framework's beats are split into scenes sized by the reel's length and the
style's pace, each with a time and a word budget. The model fills the slots; it never decides the timing.
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel

from .config import Settings
from .frameworks import TONES, framework
from .models import Asset, Brief, KeyMessage, Scene, StyleDNA, Visual

T = TypeVar("T", bound=BaseModel)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
WORDS_PER_SECOND = 2.5


# ---------------------------------------------------------------- shapes


class StyleHint(BaseModel):
    """The resolved look, sent by the studio so the script is paced like the film it will become."""

    avg_shot: float = 3.5
    energy: float = 0.5
    mood: list[str] = []


class StyleRead(BaseModel):
    mood: list[str]
    typography: Literal["bold-sans", "light-sans", "serif", "mono", "rounded", "handwritten", "none"]
    transitions: Literal["cut", "fade", "slide", "zoom", "whip"]
    camera: Literal["still", "push", "pan", "handheld", "float"]
    captions: Literal["none", "subtitles", "kinetic", "titles"]
    summary: str


class SceneDraft(BaseModel):
    narration: str
    title: str
    sub: str
    visual: Visual
    asset: str
    messages: list[str]


class ScriptDraft(BaseModel):
    scenes: list[SceneDraft]


class SceneText(BaseModel):
    narration: str
    title: str
    sub: str


class MessageIdeas(BaseModel):
    messages: list[str]


class Slot(BaseModel):
    beat: str
    purpose: str
    seconds: float
    words: int
    lands_hero: bool = False


class ScriptBrief(BaseModel):
    """Everything the writer needs, in one place."""

    brief: Brief
    messages: list[KeyMessage]
    framework: str
    tone: str
    narration: str
    duration: float
    style: StyleHint
    assets: list[Asset]


# ---------------------------------------------------------------- the slot plan

# The beat where each framework's story peaks: the hero message lands there and the music drops.
HERO_BEATS = {"Confrontation", "Finale", "Solve", "Bridge", "Desire", "Transformation", "Until finally", "Tour"}


def plan_slots(req: ScriptBrief) -> list[Slot]:
    fw = framework(req.framework)
    # A narrated scene needs room for a line, so scenes run longer than the reference's shots.
    shot = min(8.0, max(3.2, req.style.avg_shot * 1.8))
    count = max(len(fw.beats), min(40, round(req.duration / shot)))
    # Scenes per beat by share (largest remainder), at least one each.
    raw = [b.share * count for b in fw.beats]
    per = [max(1, int(r)) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: raw[i] - int(raw[i]), reverse=True)
    k = 0
    while sum(per) < count:
        per[order[k % len(order)]] += 1
        k += 1
    slots: list[Slot] = []
    hero_done = False
    for beat, n in zip(fw.beats, per, strict=True):
        seconds = req.duration * beat.share / n
        for i in range(n):
            hero = beat.name in HERO_BEATS and not hero_done and i == min(n - 1, n // 2)
            hero_done = hero_done or hero
            slots.append(
                Slot(
                    beat=beat.name,
                    purpose=beat.purpose,
                    seconds=seconds,
                    words=max(3, int(seconds * WORDS_PER_SECOND * 0.85)),
                    lands_hero=hero,
                )
            )
    if not hero_done and len(slots) > 2:
        slots[len(slots) * 2 // 3].lands_hero = True
    # The last scene is always the end card.
    slots[-1].purpose += " This is the end card: the call to action."
    return slots


def finish(req: ScriptBrief, slots: list[Slot], drafts: list[SceneDraft]) -> list[Scene]:
    """Turn drafts into scenes on the slot plan's timing, with any invented ids dropped."""
    asset_ids = {a.id for a in req.assets if a.kind in ("image", "video")}
    message_ids = {m.id for m in req.messages}
    scenes: list[Scene] = []
    for i, slot in enumerate(slots):
        d = (
            drafts[i]
            if i < len(drafts)
            else SceneDraft(narration="", title=slot.beat, sub="", visual="type", asset="", messages=[])
        )
        visual: Visual = d.visual
        asset = d.asset if d.asset in asset_ids else ""
        if visual == "asset" and not asset:
            visual = "type"
        if i == len(slots) - 1:
            visual, asset = "end", ""
        scenes.append(
            Scene(
                beat=slot.beat,
                narration="" if req.narration == "titles" else d.narration.strip(),
                title=d.title.strip(),
                sub=d.sub.strip(),
                visual=visual,
                asset=asset,
                duration=round(slot.seconds, 2),
                messages=[m for m in d.messages if m in message_ids],
            )
        )
    return scenes


def coverage(messages: list[KeyMessage], scenes: list[Scene]) -> dict[str, float]:
    """Seconds of screen time each key message gets."""
    out = {m.id: 0.0 for m in messages}
    for s in scenes:
        for m in s.messages:
            if m in out:
                out[m] += s.duration
    return out


# ---------------------------------------------------------------- prompts

SYSTEM_WRITER = """You are the writer-director of short product films. You write tight, specific copy that sounds like a person, \
never like a brochure. British spelling. No em dashes or en dashes: use commas, full stops or plain hyphens.

You fill a slot plan. Each slot is one scene with a beat, a purpose, a length in seconds and a word budget for the \
narration. Write exactly one scene per slot, in order.

For each scene:
- narration: what the narrator says (or the subtitle shows). Stay within the word budget. One idea per scene.
- title: the on-screen text, 2 to 7 words, a punchline rather than a repeat of the narration. Wrap the one or two words \
that matter most in *asterisks*; they are drawn in the accent colour.
- sub: an optional short line under the title (a detail, a number, a feature name), or "".
- visual: "asset" to show one of the provided media (set asset to its id), "type" for kinetic typography, "stat" for a \
big number (title is the number, sub the label), "quote" for a line of testimony or a bold claim, "logo" for a brand \
moment, "end" only for the last scene.
- messages: the ids of the key messages this scene lands.

Rules:
- Land every key message at least once. The hero message lands in the slot marked lands_hero, with emphasis, and is \
echoed in the last scene.
- Use each provided asset at least once before repeating any, and match it to the scene it fits (read its name and note).
- Never invent numbers, customers or quotes. A stat or quote scene must come from the brief or the key messages.
- The first scene is the hook: earn the next five seconds.
- The last scene is the end card: the call to action, and the product name or URL as the sub."""

SYSTEM_EDITOR = """You are rewriting one scene of a short product film. Keep the meaning and the key messages it lands; follow the \
instruction. Stay within the word budget. British spelling, no em or en dashes. Keep *asterisks* around the one or two \
words of the title that matter most."""

SYSTEM_EYE = """You are a film editor describing the visual style of a reference video so another film can borrow it. You get a \
contact sheet (nine frames, in order) and measurements. Describe what you see: the mood (three to five words), the \
typography of any on-screen text, how shots change, how the camera moves, how text is used, and a two-sentence summary \
a designer could act on. Judge the look only; never describe or repeat the content."""

SYSTEM_MESSAGES = """Suggest three key messages for a short product film: the points a viewer must remember. Each under 9 words, \
concrete, in the product's voice. The first is the hero message, the single most important point. British spelling, \
no em or en dashes. Never invent numbers."""


def writer_prompt(req: ScriptBrief, slots: list[Slot]) -> str:
    fw = framework(req.framework)
    body = {
        "product": req.brief.model_dump(),
        "key_messages": [{"id": m.id, "text": m.text, "hero": i == 0} for i, m in enumerate(req.messages)],
        "framework": {"name": fw.name, "idea": fw.blurb},
        "tone": TONES.get(req.tone, req.tone),
        "narration_mode": {
            "captions": "Narration is shown as subtitles, no voice. Keep lines short and readable.",
            "voice": "Narration is spoken by a voiceover. Write for the ear.",
            "both": "Narration is spoken and subtitled.",
            "titles": "There is no narration: the titles carry the story, so make them do the work.",
        }[req.narration],
        "style_mood": req.style.mood,
        "assets": [
            {"id": a.id, "kind": a.kind, "name": a.name, "note": a.note}
            for a in req.assets
            if a.kind in ("image", "video")
        ],
        "slots": [s.model_dump() | {"seconds": round(s.seconds, 1)} for s in slots],
    }
    return json.dumps(body, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- directors


class Director(Protocol):
    name: str

    async def read_style(self, sheet: bytes, dna: StyleDNA) -> StyleRead: ...

    async def write(self, req: ScriptBrief) -> list[Scene]: ...

    async def rewrite(self, req: ScriptBrief, scene: Scene, instruction: str) -> SceneText: ...

    async def suggest_messages(self, brief: Brief) -> list[str]: ...


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON Schema for structured outputs: every field required, no extra keys, no numeric bounds."""

    def tighten(node: Any) -> Any:
        if isinstance(node, dict):
            drop = ("title", "default", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems")
            node = {k: tighten(v) for k, v in node.items() if k not in drop}
            if node.get("type") == "object" and "properties" in node:
                node["required"] = list(node["properties"])
                node["additionalProperties"] = False
        elif isinstance(node, list):
            node = [tighten(v) for v in node]
        return node

    schema = model.model_json_schema()
    defs = schema.pop("$defs", None)
    schema = tighten(schema)
    if defs:
        schema["$defs"] = {k: tighten(v) for k, v in defs.items()}
    return schema


class DirectorRefusal(RuntimeError):
    pass


class ClaudeDirector:
    name = "claude"

    def __init__(self, settings: Settings) -> None:
        import anthropic

        self.client = anthropic.AsyncAnthropic()
        self.model = settings.model

    async def _structured(self, system: str, content: Any, schema: type[T], effort: str, think: bool = False) -> T:
        extra: dict[str, Any] = {"thinking": {"type": "adaptive"}} if think else {}
        async with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=32000 if think else 8000,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": strict_schema(schema)}},
            betas=[FALLBACK_BETA],
            fallbacks="default",
            **extra,
        ) as stream:
            response = await stream.get_final_message()
        if response.stop_reason == "refusal":
            raise DirectorRefusal("Claude declined this request.")
        text = next(block.text for block in response.content if block.type == "text")
        return schema.model_validate(json.loads(text))

    async def read_style(self, sheet: bytes, dna: StyleDNA) -> StyleRead:
        stats = dna.model_dump(
            include={
                "duration",
                "shots",
                "cuts_per_min",
                "avg_shot",
                "rhythm",
                "palette",
                "brightness",
                "saturation",
                "contrast",
                "energy",
                "bpm",
            }
        )
        content = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(sheet).decode()},
            },
            {"type": "text", "text": f"Measurements: {json.dumps(stats)}"},
        ]
        return await self._structured(SYSTEM_EYE, content, StyleRead, "low")

    async def write(self, req: ScriptBrief) -> list[Scene]:
        slots = plan_slots(req)
        draft = await self._structured(SYSTEM_WRITER, writer_prompt(req, slots), ScriptDraft, "high", think=True)
        return finish(req, slots, draft.scenes)

    async def rewrite(self, req: ScriptBrief, scene: Scene, instruction: str) -> SceneText:
        words = max(3, int(scene.duration * WORDS_PER_SECOND * 0.85))
        body = {
            "product": req.brief.model_dump(),
            "tone": TONES.get(req.tone, req.tone),
            "key_messages": [m.text for m in req.messages if m.id in scene.messages],
            "scene": scene.model_dump(include={"beat", "narration", "title", "sub", "visual"}),
            "word_budget": words,
            "instruction": instruction,
        }
        return await self._structured(SYSTEM_EDITOR, json.dumps(body, ensure_ascii=False), SceneText, "medium")

    async def suggest_messages(self, brief: Brief) -> list[str]:
        out = await self._structured(
            SYSTEM_MESSAGES, json.dumps(brief.model_dump(), ensure_ascii=False), MessageIdeas, "low"
        )
        return out.messages[:5]


# ---------------------------------------------------------------- the scripted director

KIND = {
    "Setup": "hook",
    "Opening image": "hook",
    "Problem": "hook",
    "Before": "hook",
    "Attention": "hook",
    "Ordinary world": "hook",
    "Once upon a time": "hook",
    "Hook": "hook",
    "Theme stated": "pain",
    "Agitate": "pain",
    "Debate": "pain",
    "Every day": "pain",
    "Call to adventure": "pain",
    "All is lost": "pain",
    "Catalyst": "turn",
    "Break into two": "turn",
    "One day": "turn",
    "Meeting the mentor": "turn",
    "Interest": "turn",
    "After": "turn",
    "Confrontation": "feature",
    "Fun and games": "feature",
    "Solve": "feature",
    "Bridge": "feature",
    "Desire": "feature",
    "Trials": "feature",
    "Because of that": "feature",
    "Tour": "feature",
    "Finale": "hero",
    "Transformation": "hero",
    "Until finally": "hero",
    "Resolution": "close",
    "Final image": "close",
    "Call to action": "close",
    "Action": "close",
    "Return": "close",
    "Ever since": "close",
    "Close": "close",
}


def _clip(text: str, words: int) -> str:
    """Keep a line near its word budget. A little over is fine; a sentence cut mid-thought is not, so cut at a clause."""
    w = text.split()
    if len(w) <= words * 1.4:
        return text
    head = " ".join(w[:words])
    cut = max(head.rfind(", "), head.rfind(". "))
    return (head[:cut] if cut > len(head) // 3 else head).rstrip(",;: ") + "."


def _emph(text: str) -> str:
    """Mark the longest word as the accent."""
    words = re.findall(r"[A-Za-z][A-Za-z'-]+", text)
    if not words:
        return text
    key = max(words, key=len)
    return text.replace(key, f"*{key}*", 1)


class ScriptedDirector:
    """Deterministic and offline: the same slot plan as Claude, filled from templates and the brief."""

    name = "scripted"

    async def read_style(self, sheet: bytes, dna: StyleDNA) -> StyleRead:
        fast = dna.cuts_per_min >= 24
        bright = dna.brightness >= 0.55
        mood = (["energetic", "bold"] if dna.energy >= 0.35 or fast else ["calm", "considered"]) + (
            ["bright", "optimistic"] if bright else ["moody", "cinematic"]
        )
        return StyleRead(
            mood=mood,
            typography="bold-sans" if bright or fast else "serif",
            transitions="cut" if fast else "fade",
            camera="handheld" if dna.energy >= 0.5 else "push" if dna.energy >= 0.15 else "still",
            captions="kinetic" if fast else "titles",
            summary=(
                f"{'Quick' if fast else 'Unhurried'} cutting, a shot every {dna.avg_shot:.1f} s, "
                f"{'bright' if bright else 'low-key'} and {'saturated' if dna.saturation >= 0.4 else 'muted'} colour. "
                f"{'Lean on hard cuts and big type.' if fast else 'Let shots breathe and fade between them.'}"
            ),
        )

    async def write(self, req: ScriptBrief) -> list[Scene]:
        slots = plan_slots(req)
        b = req.brief
        product = b.product or "it"
        who = b.audience or "You"
        msgs = req.messages or [KeyMessage(id="", text=b.pitch or f"{product}, made simple")]
        hero, rest = msgs[0], msgs[1:]
        visuals = [a for a in req.assets if a.kind in ("image", "video")]
        # What the product does, from the pitch: "sorts itself, drafts your replies" -> features to show.
        clauses = [c.strip().rstrip(".") for c in re.split(r"[.;,]| and ", b.pitch) if len(c.strip().split()) >= 2]
        lines = {
            "hook": [
                (f"What if {product} did the hard part?", f"Meet *{product}*"),
                (f"{who}, this one is for you.", "This one's *for you*"),
                ("There is a better way to do this.", "There's a *better* way"),
            ],
            "pain": [
                ("Too many steps. Too many tabs. Too little time.", "Sound *familiar*?"),
                ("It eats the hours you meant for real work.", "Where did the *day* go?"),
                ("And it never gets easier on its own.", "It doesn't *fix itself*"),
            ],
            "turn": [
                (f"Then there's {product}.", f"Enter *{product}*"),
                (f"{product} changes the routine.", "A new *routine*"),
                ("One place. One flow. Done.", "One *flow*"),
            ],
            "payoff": [
                ("Less busywork. More of what matters.", "More of what *matters*"),
                (f"That's {product}.", f"That's *{product}*"),
                ("It just works, every single day.", "It just *works*"),
            ],
        }
        features = [(m.text, m.id) for m in rest] + [(c[:1].upper() + c[1:], "") for c in clauses]
        drafts: list[SceneDraft] = []
        seen: dict[str, int] = {}
        used = 0
        for i, slot in enumerate(slots):
            last = i == len(slots) - 1
            kind = "close" if last else "hero" if slot.lands_hero else KIND.get(slot.beat, "feature")
            if kind == "close" and not last:
                kind = "payoff"
            asset, sub, ids, visual = "", "", [], "type"
            if kind in lines:
                k = seen.get(kind, 0)
                seen[kind] = k + 1
                narration, title = lines[kind][k % len(lines[kind])]
                if kind == "turn" and k == 0:
                    sub = b.pitch
                    visual = "logo" if not visuals else "type"
            elif kind == "hero":
                narration, title, ids = hero.text, _emph(hero.text), [hero.id]
            elif kind == "close":
                narration = f"{b.cta or 'Try it today'}."
                title, sub, visual, ids = (b.cta or f"Try *{product}*"), b.url or product, "end", [hero.id]
            else:
                text, mid = features[used % len(features)] if features else (f"{product}, at work", "")
                if visuals:
                    a = visuals[used % len(visuals)]
                    asset, visual = a.id, "asset"
                    sub = a.note
                narration, title, ids = f"{text}.", _emph(_clip(text, 6)), [mid]
                used += 1
            drafts.append(
                SceneDraft(
                    narration=_clip(narration, slot.words),
                    title=title,
                    sub=sub,
                    visual=visual,
                    asset=asset,
                    messages=[x for x in ids if x],
                )
            )
        return finish(req, slots, drafts)

    async def rewrite(self, req: ScriptBrief, scene: Scene, instruction: str) -> SceneText:
        text = scene.narration
        ask = instruction.lower()
        if "short" in ask or "punch" in ask:
            text = re.split(r"(?<=[.!?,])\s", text)[0].rstrip(",")
        if "warm" in ask and not text.lower().startswith("you"):
            text = f"You'll love this: {text[:1].lower()}{text[1:]}"
        if "question" in ask and not text.endswith("?"):
            text = f"What if {text[:1].lower()}{text[1:].rstrip('.')}?"
        return SceneText(narration=text, title=scene.title, sub=scene.sub)

    async def suggest_messages(self, brief: Brief) -> list[str]:
        parts = [p.strip() for p in re.split(r"[.;,]| and ", brief.pitch) if len(p.strip().split()) >= 2]
        ideas = [_clip(p[:1].upper() + p[1:], 8) for p in parts][:3]
        while len(ideas) < 3:
            ideas.append(["Set up in minutes", "Works where you already are", "Your data stays yours"][len(ideas)])
        return ideas


def make_director(settings: Settings) -> Director:
    if settings.llm == "scripted":
        return ScriptedDirector()
    if settings.llm == "anthropic":
        return ClaudeDirector(settings)
    raise ValueError(f"Unknown director: {settings.llm}")
