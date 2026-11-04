"""Fetch a reference video from a link, refusing anything over the length limit before it downloads.

yt-dlp handles video sites and direct file links. Reel downloads a small copy (480p at most), measures it, and deletes
it: only the numbers and a contact sheet are kept.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from .analyse import duration_of


class FetchError(ValueError):
    pass


def check_url(url: str) -> str:
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise FetchError("Paste a full link, starting with http:// or https://.")
    return url


def fetch(url: str, dest: Path, max_seconds: float) -> tuple[Path, str]:
    """Download a reference into dest. Returns the file and the video's title."""
    import yt_dlp

    url = check_url(url)
    dest.mkdir(parents=True, exist_ok=True)
    base = {"quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True}
    try:
        with yt_dlp.YoutubeDL(base) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:  # yt-dlp raises many types; all mean the same thing to the user
        raise FetchError(f"Couldn't open that link: {_reason(e)}") from e
    if info.get("_type") == "playlist":
        raise FetchError("That's a playlist. Paste a link to one video.")
    seconds = info.get("duration")
    if seconds and seconds > max_seconds:
        raise FetchError(f"That video is {_mins(seconds)}. References can be up to {_mins(max_seconds)}.")
    title = info.get("title") or urlparse(url).path.rsplit("/", 1)[-1] or url
    opts = base | {
        "format": "best[height<=480][ext=mp4]/best[height<=480]/worst",
        "outtmpl": str(dest / "source.%(ext)s"),
        "max_filesize": 400 * 1024 * 1024,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise FetchError(f"Couldn't download that video: {_reason(e)}") from e
    files = sorted(dest.glob("source.*"))
    if not files:
        raise FetchError("That link didn't give Reel a video to analyse.")
    path = files[0]
    real = duration_of(path)
    if real > max_seconds + 1:
        path.unlink(missing_ok=True)
        raise FetchError(f"That video is {_mins(real)}. References can be up to {_mins(max_seconds)}.")
    return path, title


def _mins(seconds: float) -> str:
    m, s = divmod(round(seconds), 60)
    return f"{m} min {s} s" if m and s else f"{m} min" if m else f"{s} s"


def _reason(e: Exception) -> str:
    text = str(e).replace("ERROR: ", "").strip()
    return text.split("\n")[0][:160] or type(e).__name__
