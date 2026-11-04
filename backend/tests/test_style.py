import functools
import http.server
import subprocess
import threading

import numpy as np
import pytest

from reel.style import analyse
from reel.style.fetch import FetchError, check_url, fetch


def test_measures_cuts_tempo_and_colour(reference):
    dna = analyse.measure(reference)
    assert dna.shots == 5
    assert dna.avg_shot == pytest.approx(2.0, abs=0.05)
    assert dna.cuts_per_min == pytest.approx(24, abs=1)
    assert dna.bpm == pytest.approx(120, abs=2)
    # The red of the first shot is one of the dominant colours.
    reds = [c for c in dna.palette if int(c[1:3], 16) > 180 and int(c[3:5], 16) < 100]
    assert reds


def test_contact_sheet(reference, tmp_path):
    sheet = analyse.contact_sheet(reference, 10, tmp_path / "sheet.jpg")
    assert sheet.stat().st_size > 1000


def test_no_tempo_in_silence():
    assert analyse.tempo(np.zeros(11025 * 4, dtype=np.float32)) is None


def test_palette_is_deterministic():
    px = np.random.default_rng(1).random((4, 20, 20, 3), dtype=np.float32)
    assert analyse.palette(px) == analyse.palette(px)


@pytest.mark.parametrize("url", ["", "notaurl", "ftp://x.com/v.mp4", "file:///etc/passwd"])
def test_rejects_bad_links(url):
    with pytest.raises(FetchError):
        check_url(url)


@pytest.fixture
def served(reference):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(reference.parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/{reference.name}"
    server.shutdown()


def test_fetches_a_direct_link(served, tmp_path):
    path, title = fetch(served, tmp_path, max_seconds=60)
    assert path.exists() and title


def test_refuses_a_video_over_the_limit(served, tmp_path):
    with pytest.raises(FetchError, match="up to 5 s"):
        fetch(served, tmp_path, max_seconds=5)
    assert not list(tmp_path.glob("source.*"))


def test_finds_a_crossfade(tmp_path):
    """A one-second dissolve has no hard cut, but it is still a change of shot."""
    out = tmp_path / "fade.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xe63946:s=320x180:d=4",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x1d3557:s=320x180:d=4",
            "-filter_complex",
            "[0][1]xfade=transition=fade:duration=1:offset=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(out),
        ],
        check=True,
    )
    assert analyse.measure(out).shots == 2
