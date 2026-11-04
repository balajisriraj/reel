import asyncio
import itertools

import pytest

from reel.director import ScriptBrief, ScriptedDirector, StyleHint, _clip, coverage, plan_slots
from reel.frameworks import FRAMEWORKS
from reel.models import Asset, Brief, KeyMessage


def brief(framework="three-act", duration=60.0, avg_shot=3.0, assets=()):
    return ScriptBrief(
        brief=Brief(
            product="Lumen",
            pitch="A calm inbox that sorts itself, drafts your replies and tells you what needs you",
            cta="Join the beta",
            url="lumen.app",
        ),
        messages=[
            KeyMessage(text="Only what needs you, first"),
            KeyMessage(text="Replies in your voice"),
            KeyMessage(text="Inbox zero by lunch"),
        ],
        framework=framework,
        tone="confident",
        narration="captions",
        duration=duration,
        style=StyleHint(avg_shot=avg_shot),
        assets=list(assets),
    )


@pytest.mark.parametrize("fw", [f.id for f in FRAMEWORKS])
@pytest.mark.parametrize("duration", [15, 60, 300])
def test_slots_fill_the_length_and_peak_once(fw, duration):
    slots = plan_slots(brief(fw, duration))
    assert sum(s.seconds for s in slots) == pytest.approx(duration)
    assert sum(s.lands_hero for s in slots) == 1
    assert "end card" in slots[-1].purpose
    # Every beat of the framework is in the plan, in order.
    names = list(dict.fromkeys(s.beat for s in slots))
    assert names == [b.name for b in next(f for f in FRAMEWORKS if f.id == fw).beats]


def test_faster_references_mean_more_scenes():
    assert len(plan_slots(brief(avg_shot=2))) > len(plan_slots(brief(avg_shot=4.5)))


def test_scripted_script_lands_every_message_and_ends_on_the_card():
    req = brief(assets=[Asset(id="ast_a", kind="image", name="dashboard.png", file="a.png", note="The dashboard")])
    scenes = asyncio.run(ScriptedDirector().write(req))
    assert scenes[-1].visual == "end" and scenes[-1].title == "Join the beta"
    cov = coverage(req.messages, scenes)
    assert all(v > 0 for v in cov.values())
    assert any(s.asset == "ast_a" for s in scenes)
    assert sum(s.duration for s in scenes) == pytest.approx(60, abs=0.2)
    # No two neighbouring scenes say the same thing.
    assert all(a.narration != b.narration for a, b in itertools.pairwise(scenes))


def test_rewrite_shorter():
    from reel.models import Scene

    scene = Scene(narration="Lumen sorts your inbox, drafts your replies, and clears the noise.", title="x")
    out = asyncio.run(ScriptedDirector().rewrite(brief(), scene, "Shorter"))
    assert len(out.narration) < len(scene.narration)


def test_clip_never_cuts_mid_thought():
    assert _clip("Join the beta today", 3) == "Join the beta today"
    long = "Lumen sorts your inbox, drafts every reply in your voice and tells you what needs you"
    assert _clip(long, 6) == "Lumen sorts your inbox."
