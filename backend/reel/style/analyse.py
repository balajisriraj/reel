"""Measure a reference video's style with ffmpeg and numpy.

Nothing of the video is kept but numbers and a small contact sheet: cut rhythm, colour palette, brightness, saturation,
contrast, motion energy, tempo and loudness.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import numpy as np

from ..models import StyleDNA

FRAME_W, FRAME_H = 96, 54


def _run(args: list[str], binary: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, check=False, text=not binary)


def probe(path: Path) -> dict:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    if out.returncode != 0:
        raise ValueError("That file isn't a video Reel can read.")
    return json.loads(out.stdout)


def duration_of(path: Path) -> float:
    info = probe(path)
    return float(info.get("format", {}).get("duration") or 0)


def has_audio(path: Path) -> bool:
    return any(s.get("codec_type") == "audio" for s in probe(path).get("streams", []))


def cut_times(path: Path, threshold: float = 0.3) -> list[float]:
    """Shot changes, from ffmpeg's scene score."""
    out = _run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-vf",
            f"scale=320:-2,select='gt(scene,{threshold})',showinfo",
            "-an",
            "-f",
            "null",
            "-",
        ]
    )
    return [float(t) for t in re.findall(r"pts_time:([\d.]+)", out.stderr)]


def soft_changes(
    px: np.ndarray, fps: float, window: float = 1.0, threshold: float = 0.04, gap: float = 1.2
) -> list[float]:
    """Shot changes a cut detector misses: crossfades, wipes and camera moves onto new content.

    Each frame is compared with the one a second earlier; peaks in that difference are changes of scene.
    """
    lag = max(1, round(window * fps))
    if len(px) <= lag + 2:
        return []
    d = np.abs(px[lag:] - px[:-lag]).mean((1, 2, 3))
    out: list[float] = []
    for i in range(1, len(d) - 1):
        if d[i] > threshold and d[i] >= d[i - 1] and d[i] >= d[i + 1]:
            t = (i + lag) / fps - window / 2
            if not out or t - out[-1] >= gap:
                out.append(round(t, 2))
    return out


def merge_cuts(hard: list[float], soft: list[float], within: float = 0.6) -> list[float]:
    cuts = sorted(hard)
    for t in soft:
        if all(abs(t - c) > within for c in cuts):
            cuts.append(t)
    return sorted(cuts)


def frames(path: Path, fps: float = 2.0) -> np.ndarray:
    out = _run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(path),
            "-vf",
            f"fps={fps},scale={FRAME_W}:{FRAME_H}",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        binary=True,
    )
    data = np.frombuffer(out.stdout, dtype=np.uint8)
    n = len(data) // (FRAME_W * FRAME_H * 3)
    return data[: n * FRAME_W * FRAME_H * 3].reshape(n, FRAME_H, FRAME_W, 3).astype(np.float32) / 255.0


def audio(path: Path, rate: int = 11025) -> np.ndarray | None:
    if not has_audio(path):
        return None
    out = _run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"], binary=True
    )
    samples = np.frombuffer(out.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return samples if len(samples) > rate else None


def palette(pixels: np.ndarray, k: int = 5, rounds: int = 12) -> list[str]:
    """The dominant colours, by k-means, most common first. Deterministic: seeded from luminance quantiles."""
    px = pixels.reshape(-1, 3)
    if len(px) > 20000:
        px = px[:: len(px) // 20000]
    lum = px @ np.array([0.299, 0.587, 0.114])
    centres = np.stack([px[np.argsort(lum)[int(q * (len(px) - 1))]] for q in np.linspace(0.05, 0.95, k)])
    for _ in range(rounds):
        labels = np.argmin(((px[:, None, :] - centres[None]) ** 2).sum(-1), axis=1)
        for j in range(k):
            members = px[labels == j]
            if len(members):
                centres[j] = members.mean(0)
    counts = np.bincount(labels, minlength=k)
    order = np.argsort(-counts)
    return ["#{:02x}{:02x}{:02x}".format(*(np.clip(centres[j], 0, 1) * 255).astype(int)) for j in order]


def hsv_stats(pixels: np.ndarray) -> tuple[float, float, float]:
    """Mean brightness, mean saturation and contrast (spread of luma), each 0 to 1."""
    mx, mn = pixels.max(-1), pixels.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    luma = pixels @ np.array([0.299, 0.587, 0.114])
    return float(mx.mean()), float(sat.mean()), float(min(1.0, luma.std() * 3.0))


def tempo(samples: np.ndarray, rate: int = 11025) -> float | None:
    """Beats per minute from the onset envelope's autocorrelation, or None if there's no clear pulse."""
    hop = 256
    n = len(samples) // hop
    if n < 64:
        return None
    energy = np.sqrt((samples[: n * hop].reshape(n, hop) ** 2).mean(1))
    onset = np.maximum(0, np.diff(energy))
    onset -= onset.mean()
    if not onset.any():
        return None
    ac = np.correlate(onset, onset, mode="full")[len(onset) - 1 :]
    fps = rate / hop
    lags = np.arange(len(ac))
    window = (lags >= fps * 60 / 180) & (lags <= fps * 60 / 60)
    if not window.any():
        return None
    best = lags[window][np.argmax(ac[window])]
    strength = ac[best] / (ac[0] or 1)
    if strength < 0.15:
        return None
    bpm = 60 * fps / best
    while bpm < 80:
        bpm *= 2
    while bpm > 160:
        bpm /= 2
    return round(float(bpm), 1)


def loudness(samples: np.ndarray) -> float:
    rms = float(np.sqrt((samples**2).mean()))
    return round(20 * np.log10(max(rms, 1e-6)), 1)


def contact_sheet(path: Path, seconds: float, out: Path) -> Path:
    """Nine frames, evenly spaced, tiled 3x3."""
    fps = 9 / max(seconds, 1)
    vf = f"fps={fps:.5f},scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=3x3"
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf", vf, "-frames:v", "1", "-q:v", "4", str(out)])
    if not out.exists():
        raise ValueError("Couldn't read frames from that video.")
    return out


def measure(path: Path) -> StyleDNA:
    seconds = duration_of(path)
    if seconds <= 0:
        raise ValueError("That video has no length.")
    px = frames(path, fps=4.0)
    if not len(px):
        raise ValueError("Couldn't read frames from that video.")
    cuts = [c for c in merge_cuts(cut_times(path), soft_changes(px, 4.0)) if 0.2 < c < seconds - 0.2]
    shots = len(cuts) + 1
    edges = [0.0, *cuts, seconds]
    gaps = np.diff(edges)
    half = seconds / 2
    early = sum(1 for c in cuts if c < half)
    late = len(cuts) - early
    if len(cuts) >= 4 and late > 1.6 * max(early, 1):
        rhythm = "accelerating"
    elif gaps.std() / max(gaps.mean(), 1e-6) < 0.45:
        rhythm = "steady"
    else:
        rhythm = "varied"

    bright, sat, contrast = hsv_stats(px)
    motion = float(np.abs(px[2:] - px[:-2]).mean()) if len(px) > 2 else 0.0  # half a second apart, as at 2 fps
    cpm = len(cuts) / seconds * 60
    energy = min(1.0, 0.6 * min(1.0, motion / 0.12) + 0.4 * min(1.0, cpm / 40))

    sound = audio(path)
    return StyleDNA(
        duration=round(seconds, 2),
        shots=shots,
        cuts_per_min=round(cpm, 1),
        avg_shot=round(seconds / shots, 2),
        rhythm=rhythm,
        palette=palette(px),
        brightness=round(bright, 3),
        saturation=round(sat, 3),
        contrast=round(contrast, 3),
        energy=round(energy, 3),
        bpm=tempo(sound) if sound is not None else None,
        loudness=loudness(sound) if sound is not None else None,
    )
