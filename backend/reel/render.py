"""Render a reel: frames from the film engine, a score composed to the cut, voiceover, ducking and loudness.

1. The Node renderer opens the engine's render page for the project in headless Chrome, writes the resolved timeline,
   then steps through every frame into ffmpeg (silent.mp4).
2. As soon as the timeline exists, the score is synthesised to its marks, in parallel with the frames.
3. Voice clips are placed at their scenes, the music ducks under them, and the mix is normalised to -14 LUFS.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

from .config import Settings
from .models import Project, Render

SCORE = Path(__file__).with_name("score.py")

# The mix's mood picks the score's style.
MOOD_STYLES = {
    "midnight": {"cinematic", "moody", "dark", "mysterious", "dramatic", "night", "sleek"},
    "study": {"warm", "cosy", "calm", "considered", "nostalgic", "gentle", "human", "intimate"},
    "punch": {"bold", "loud", "energetic", "punchy", "confident", "urgent", "edgy", "gritty"},
    "forge": {"earthy", "crafted", "handmade", "rugged", "organic", "raw"},
    "air": {"bright", "optimistic", "airy", "playful", "fresh", "clean", "light", "minimal", "friendly"},
    "arena": {"epic", "triumphant", "competitive", "intense", "powerful", "sporty"},
}


def score_style(mood: list[str], energy: float) -> str:
    words = {w.lower() for w in mood}
    best = max(MOOD_STYLES, key=lambda s: len(MOOD_STYLES[s] & words))
    if not MOOD_STYLES[best] & words:
        return "punch" if energy >= 0.6 else "air" if energy >= 0.3 else "study"
    return best


class RenderError(RuntimeError):
    pass


def render_page(settings: Settings, project_id: str) -> str:
    if settings.render_page:
        base = settings.render_page
    else:
        if not (settings.frontend_dist / "render.html").exists():
            raise RenderError("The film engine isn't built yet. Run `pnpm build` in frontend/ first.")
        base = f"{settings.public_url}/render.html"
    return f"{base}?project={project_id}&api={settings.public_url}"


def render(settings: Settings, project: Project, quality: str, progress: Callable[[float, str], None]) -> Render:
    out_dir = settings.project_dir(project.id) / "renders"
    work = out_dir / f"work-{int(time.time())}"
    work.mkdir(parents=True, exist_ok=True)
    fps = 30 if quality == "final" else 24
    scale = 1.0 if quality == "final" else 0.6667
    url = render_page(settings, project.id)

    progress(0.01, "Opening the film")
    cmd = [
        "node",
        str(settings.renderer_dir / "render.mjs"),
        "--url",
        url,
        "--out",
        str(work),
        "--fps",
        str(fps),
        "--scale",
        str(scale),
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    music_thread: threading.Thread | None = None
    music_result: dict = {}
    log: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        log.append(line)
        if line.startswith("progress "):
            progress(0.03 + 0.82 * float(line.split()[1]), "Rendering frames")
        elif line == "timeline" and music_thread is None:
            timeline = json.loads((work / "timeline.json").read_text())
            music_thread = threading.Thread(
                target=_music, args=(project, settings, timeline, work, music_result), daemon=True
            )
            music_thread.start()
    proc.wait()
    if proc.returncode != 0:
        err = (proc.stderr.read() if proc.stderr else "") or "\n".join(log[-5:])
        raise RenderError(f"The renderer stopped: {err.strip()[-400:]}")
    timeline = json.loads((work / "timeline.json").read_text())
    progress(0.87, "Composing the music")
    if music_thread:
        music_thread.join()
    if "error" in music_result:
        raise RenderError(music_result["error"])

    progress(0.93, "Mixing the sound")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = f"{_slug(project.name)}-{project.settings.aspect.replace(':', 'x')}-{quality}-{stamp}"
    final = out_dir / f"{name}.mp4"
    _mix(settings, project, timeline, work / "silent.mp4", music_result.get("path"), final)
    poster = out_dir / f"{name}.jpg"
    at = timeline["marks"].get("hero", 1.0)
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{at + 0.8:.2f}",
            "-i",
            str(final),
            "-frames:v",
            "1",
            "-q:v",
            "3",
            str(poster),
        ],
        check=False,
    )
    for f in work.iterdir():
        f.unlink()
    work.rmdir()
    progress(1.0, "Done")
    return Render(
        file=final.name,
        poster=poster.name,
        duration=round(timeline["duration"], 2),
        aspect=project.settings.aspect,
        quality=quality,
    )  # type: ignore[arg-type]


def _music(project: Project, settings: Settings, timeline: dict, work: Path, result: dict) -> None:
    music = project.settings.music
    try:
        if music.source == "score":
            path = work / "score.wav"
            style = score_style(timeline.get("mood", []), timeline.get("energy", 0.5))
            marks = timeline["marks"]
            subprocess.run(
                [sys.executable, str(SCORE), str(path), f"{timeline['duration']:.2f}", json.dumps(marks), style],
                check=True,
                capture_output=True,
            )
            result["path"] = path
        elif music.source == "upload" and music.asset:
            asset = next((a for a in project.assets if a.id == music.asset), None)
            if asset:
                result["path"] = settings.project_dir(project.id) / "assets" / asset.file
    except subprocess.CalledProcessError as e:
        result["error"] = f"The score failed: {e.stderr.decode()[-300:] if e.stderr else e}"


def _mix(settings: Settings, project: Project, timeline: dict, silent: Path, music: Path | None, out: Path) -> None:
    duration = timeline["duration"]
    assets = {a.id: a for a in project.assets}
    voices = [
        (v["start"], settings.project_dir(project.id) / "assets" / assets[v["asset"]].file)
        for v in timeline.get("voices", [])
        if v.get("asset") in assets
    ]
    args = ["ffmpeg", "-v", "error", "-y", "-i", str(silent)]
    filters: list[str] = []
    idx = 1
    music_label = voice_label = None
    if music:
        args += ["-stream_loop", "-1", "-i", str(music)]
        vol = project.settings.music.volume
        fade = min(2.4, duration / 6)
        filters.append(
            f"[{idx}:a]atrim=0:{duration:.2f},asetpts=PTS-STARTPTS,volume={vol:.2f},afade=t=in:d=0.3,afade=t=out:st={duration - fade:.2f}:d={fade:.2f}[mus]"
        )
        music_label = "[mus]"
        idx += 1
    if voices:
        labels = []
        for start, path in voices:
            args += ["-i", str(path)]
            ms = int((start + 0.15) * 1000)
            filters.append(f"[{idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{idx}]")
            labels.append(f"[v{idx}]")
            idx += 1
        filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,apad=whole_dur={duration:.2f}[vo]")
        voice_label = "[vo]"
    if music_label and voice_label:
        filters.append("[vo]asplit=2[vo1][vokey]")
        filters.append(f"{music_label}[vokey]sidechaincompress=threshold=0.03:ratio=9:attack=15:release=350[duck]")
        filters.append("[duck][vo1]amix=inputs=2:normalize=0[pre]")
    elif music_label or voice_label:
        filters.append(f"{music_label or voice_label}anull[pre]")
    else:
        # A silent track keeps players happy. Loudness normalisation can't measure silence, so it's skipped.
        args += ["-f", "lavfi", "-t", f"{duration:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
        filters.append(f"[{idx}:a]anull[pre]")
    norm = _loudness(args, filters, duration) if music_label or voice_label else ""
    filters.append(f"[pre]atrim=0:{duration:.2f}{norm}[a]")
    args += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-t",
        f"{duration:.2f}",
        str(out),
    ]
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode != 0:
        raise RenderError(f"The sound mix failed: {done.stderr.strip()[-400:]}")


def _loudness(args: list[str], filters: list[str], duration: float) -> str:
    """Two-pass loudness: measure the mix, then one linear gain to -14 LUFS with the true peak kept under -1.5 dB.

    A single dynamic pass overshoots its peak target on dense, saturated music, and AAC adds a little more on top, so
    a limiter set below the ceiling catches what is left.
    """
    target = "I=-14:TP=-1.5:LRA=11"
    probe = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        *args[3:],
        "-filter_complex",
        ";".join([*filters, f"[pre]atrim=0:{duration:.2f},loudnorm={target}:print_format=json[a]"]),
        "-map",
        "[a]",
        "-f",
        "null",
        "-",
    ]
    out = subprocess.run(probe, capture_output=True, text=True).stderr
    limiter = ",aresample=44100,alimiter=limit=0.79:attack=1:release=50:level=false"
    try:
        m = json.loads(out[out.rindex("{") : out.rindex("}") + 1])
        measured = f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
        return f",loudnorm={target}:linear=true:{measured}{limiter}"
    except (ValueError, KeyError):
        return f",loudnorm={target}{limiter}"


def _slug(name: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "reel"
