"""Narration frameworks: the story shapes a reel can follow, as beats with a share of the running time."""

from __future__ import annotations

from pydantic import BaseModel


class Beat(BaseModel):
    name: str
    purpose: str
    share: float


class Framework(BaseModel):
    id: str
    name: str
    blurb: str
    beats: list[Beat]


def _fw(id_: str, name: str, blurb: str, beats: list[tuple[str, str, float]]) -> Framework:
    return Framework(id=id_, name=name, blurb=blurb, beats=[Beat(name=n, purpose=p, share=s) for n, p, s in beats])


FRAMEWORKS: list[Framework] = [
    _fw(
        "three-act",
        "Three-act",
        "Set up the world, put it under pressure, resolve it with the product.",
        [
            ("Setup", "The viewer's world and the itch they live with. Hook in the first line.", 0.25),
            ("Confrontation", "The product meets the problem. Show it working; raise the stakes.", 0.5),
            ("Resolution", "The payoff and the new normal. Close on the call to action.", 0.25),
        ],
    ),
    _fw(
        "save-the-cat",
        "Save the Cat",
        "Blake Snyder's beat sheet, condensed: a hero, a catalyst, a low point and a finale.",
        [
            ("Opening image", "A snapshot of the 'before': the viewer, stuck.", 0.07),
            ("Theme stated", "One line that says what this is really about.", 0.06),
            ("Catalyst", "The moment that changes everything: the product arrives.", 0.08),
            ("Debate", "The doubt. Will it really work? Name the objection.", 0.07),
            ("Break into two", "The leap: trying it for the first time.", 0.07),
            ("Fun and games", "The promise of the premise: the best features in action.", 0.3),
            ("All is lost", "The hardest case, the one that would break other tools.", 0.08),
            ("Finale", "The product wins the hard case. The hero message lands here.", 0.19),
            ("Final image", "The 'after', mirroring the opening. Then the call to action.", 0.08),
        ],
    ),
    _fw(
        "pas",
        "Problem, agitate, solve",
        "The copywriter's classic: name the pain, twist the knife, then relieve it.",
        [
            ("Problem", "Name the pain in the viewer's own words.", 0.2),
            ("Agitate", "Show what it costs them: time, money, nerves.", 0.2),
            ("Solve", "The product, working. Each feature answers part of the pain.", 0.45),
            ("Call to action", "What to do next, and why now.", 0.15),
        ],
    ),
    _fw(
        "bab",
        "Before, after, bridge",
        "Show life without it, life with it, then how to cross.",
        [
            ("Before", "Life today, with the friction.", 0.25),
            ("After", "Life with the friction gone. Make it vivid.", 0.25),
            ("Bridge", "The product is how you get there. Show how.", 0.35),
            ("Call to action", "Cross the bridge: the next step.", 0.15),
        ],
    ),
    _fw(
        "aida",
        "AIDA",
        "Attention, interest, desire, action: the oldest funnel in advertising.",
        [
            ("Attention", "A bold, surprising opener.", 0.15),
            ("Interest", "What it is and why it's different.", 0.3),
            ("Desire", "The moments that make the viewer want it.", 0.35),
            ("Action", "One clear next step.", 0.2),
        ],
    ),
    _fw(
        "heros-journey",
        "Hero's journey",
        "The viewer is the hero; the product is the mentor who helps them win.",
        [
            ("Ordinary world", "The hero's normal day, and what's missing.", 0.12),
            ("Call to adventure", "A goal or a challenge appears.", 0.12),
            ("Meeting the mentor", "The product arrives with a gift.", 0.16),
            ("Trials", "The hero uses it, feature by feature.", 0.3),
            ("Transformation", "The hero wins. The hero message lands here.", 0.18),
            ("Return", "Home, changed. Invite the viewer to start.", 0.12),
        ],
    ),
    _fw(
        "story-spine",
        "Story spine",
        "Once upon a time... every day... one day... because of that... until finally.",
        [
            ("Once upon a time", "Who and where.", 0.12),
            ("Every day", "The routine, and its friction.", 0.12),
            ("One day", "The product enters.", 0.12),
            ("Because of that", "A chain of better things, one feature each.", 0.3),
            ("Until finally", "The big change. The hero message lands here.", 0.2),
            ("Ever since", "The new normal, and the invitation.", 0.14),
        ],
    ),
    _fw(
        "feature-tour",
        "Feature tour",
        "Straight to the demo: a hook, the features one by one, a clean close.",
        [
            ("Hook", "What it is, in one breath.", 0.12),
            ("Tour", "One feature per scene, shown, not described.", 0.7),
            ("Close", "The one-line summary and the call to action.", 0.18),
        ],
    ),
]

TONES = {
    "confident": "Confident and clear. Short declarative lines, no hedging.",
    "warm": "Warm and human. Talks to one person, a little personal.",
    "witty": "Witty and light. One clever turn per beat, never a pun pile.",
    "cinematic": "Cinematic. Spare, evocative lines with room to breathe, like a trailer.",
    "plain": "Plain and factual. Explain like a good teacher, zero hype.",
    "urgent": "Urgent and punchy. Fast lines, strong verbs, momentum.",
}


def framework(fid: str) -> Framework:
    return next((f for f in FRAMEWORKS if f.id == fid), FRAMEWORKS[0])
