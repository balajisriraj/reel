import subprocess

from reel.config import Settings
from reel.models import Asset, Project
from reel.render import _mix, score_style


def test_mood_picks_the_score():
    assert score_style(["cinematic", "moody"], 0.2) == "midnight"
    assert score_style(["bright", "playful"], 0.5) == "air"
    assert score_style([], 0.8) == "punch"


def test_mix_ducks_music_under_voice(tmp_path):
    settings = Settings(llm="scripted", data_dir=tmp_path)
    project = Project()
    assets = settings.project_dir(project.id) / "assets"
    assets.mkdir()
    run = lambda *a: subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)  # noqa: E731
    run(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=320x180:d=6",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(tmp_path / "silent.mp4"),
    )
    run("-f", "lavfi", "-i", "sine=f=220:d=3", str(tmp_path / "music.wav"))
    run("-f", "lavfi", "-i", "sine=f=660:d=1.5", str(assets / "v.wav"))
    project.assets.append(Asset(id="ast_v", kind="voice", name="v", file="v.wav"))
    timeline = {"duration": 6.0, "voices": [{"start": 2.0, "asset": "ast_v"}]}
    out = tmp_path / "out.mp4"
    _mix(settings, project, timeline, tmp_path / "silent.mp4", tmp_path / "music.wav", out)
    info = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "csv=p=0", str(out)],
        capture_output=True,
        text=True,
    ).stdout
    assert "audio" in info and "video" in info
    # The short track loops to fill the reel.
    assert abs(float(info.strip().splitlines()[-1]) - 6.0) < 0.15


def test_silent_reel_still_has_a_soundtrack(tmp_path):
    settings = Settings(llm="scripted", data_dir=tmp_path)
    project = Project()
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(tmp_path / "silent.mp4"),
        ],
        check=True,
    )
    _mix(settings, project, {"duration": 2.0, "voices": []}, tmp_path / "silent.mp4", None, tmp_path / "out.mp4")
    assert (tmp_path / "out.mp4").stat().st_size > 0
