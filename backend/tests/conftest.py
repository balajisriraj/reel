import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reel.api import create_app
from reel.config import Settings
from reel.director import ScriptedDirector


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="session")
def reference(tmp_path_factory) -> Path:
    """Ten seconds, five shots (cuts at 2, 4, 5 and 7 s), and a click on every half second: 120 bpm."""
    out = tmp_path_factory.mktemp("media") / "ref.mp4"
    colours = [("0xe63946", 2), ("0x1d3557", 2), ("0xf1c40f", 1), ("0xf1faee", 2), ("0x457b9d", 3)]
    inputs: list[str] = []
    for c, d in colours:
        inputs += ["-f", "lavfi", "-i", f"color=c={c}:s=320x180:d={d}"]
    inputs += ["-f", "lavfi", "-i", "aevalsrc='0.8*sin(2*PI*900*t)*exp(-40*mod(t\\,0.5))':s=22050:d=10"]
    ffmpeg(
        *inputs,
        "-filter_complex",
        "concat=n=5:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "5:a",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        str(out),
    )
    return out


@pytest.fixture(scope="session")
def image(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("media") / "screen.png"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1440x900:d=1", "-frames:v", "1", str(out))
    return out


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        llm="scripted", data_dir=tmp_path / "data", frontend_dist=tmp_path / "nodist", max_reference_seconds=8
    )


@pytest.fixture
def client(settings) -> TestClient:
    return TestClient(create_app(settings, ScriptedDirector()))
