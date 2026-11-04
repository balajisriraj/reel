"""The studio's API: projects, references, media, the script, and renders.

Slow work (analysing a reference, capturing screens, rendering) runs as a job in a background thread; the studio polls
``/api/jobs/{id}`` for progress.
"""

from __future__ import annotations

import asyncio
import mimetypes
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import render as renderer
from .config import Settings, get_settings
from .director import Director, ScriptBrief, StyleHint, coverage, make_director
from .frameworks import FRAMEWORKS, TONES
from .models import Asset, Brand, Brief, Job, KeyMessage, Mix, Project, ReelSettings, Reference, Scene
from .store import Store
from .style import analyse
from .style.fetch import FetchError, check_url, fetch


class ProjectPatch(BaseModel):
    name: str | None = None
    brief: Brief | None = None
    messages: list[KeyMessage] | None = None
    mix: Mix | None = None
    settings: ReelSettings | None = None
    brand: Brand | None = None
    scenes: list[Scene] | None = None


class NewProject(BaseModel):
    name: str = "Untitled reel"
    sample: bool = False


class RefIn(BaseModel):
    url: str


class AssetPatch(BaseModel):
    name: str | None = None
    note: str | None = None


class CaptureIn(BaseModel):
    url: str
    mobile: bool = False


class ScriptIn(BaseModel):
    style: StyleHint = StyleHint()


class RewriteIn(BaseModel):
    instruction: str


class RenderIn(BaseModel):
    quality: Literal["draft", "final"] = "draft"


SAMPLE = Project(
    name="Lumen launch",
    brief=Brief(
        product="Lumen",
        pitch="A calm inbox that sorts itself, drafts your replies and tells you what actually needs you today.",
        audience="Busy founders",
        cta="Join the beta",
        url="lumen.example",
    ),
    messages=[
        KeyMessage(text="Only what needs you, first"),
        KeyMessage(text="Replies drafted in your voice"),
        KeyMessage(text="Inbox zero by lunch"),
    ],
)


def create_app(settings: Settings | None = None, director: Director | None = None) -> FastAPI:
    settings = settings or get_settings()
    store = Store(settings.db_path)
    director = director or make_director(settings)
    app = FastAPI(title="Reel")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"])
    app.state.store = store

    def project(pid: str) -> Project:
        p = store.get(pid)
        if p is None:
            raise HTTPException(404, "No such project.")
        return p

    def assets_dir(pid: str) -> Path:
        d = settings.project_dir(pid) / "assets"
        d.mkdir(exist_ok=True)
        return d

    def run_job(job: Job, work) -> Job:
        store.put_job(job)

        def progress(value: float, message: str) -> None:
            job.progress, job.message = round(value, 3), message
            store.put_job(job)

        def target() -> None:
            try:
                job.result = work(progress) or {}
                job.status, job.progress = "done", 1.0
            except (FetchError, ValueError, renderer.RenderError) as e:
                job.status, job.message = "failed", str(e)
            except Exception as e:  # keep the studio informed whatever broke
                job.status, job.message = "failed", f"Something went wrong: {e}"
            store.put_job(job)

        threading.Thread(target=target, daemon=True).start()
        return job

    def script_brief(p: Project, style: StyleHint) -> ScriptBrief:
        return ScriptBrief(
            brief=p.brief,
            messages=p.messages,
            framework=p.settings.framework,
            tone=p.settings.tone,
            narration=p.settings.narration,
            duration=p.settings.duration,
            style=style,
            # The logo has its own moments (intro, end card, corner); the scenes show the product.
            assets=[a for a in p.assets if a.id != p.brand.logo],
        )

    # ---------------------------------------------------------------- meta and projects

    @app.get("/api/meta")
    def meta() -> dict[str, Any]:
        return {
            "director": director.name,
            "model": settings.model if director.name == "claude" else "scripted",
            "frameworks": [f.model_dump() for f in FRAMEWORKS],
            "tones": [{"id": k, "description": v} for k, v in TONES.items()],
            "limits": {
                "reference_seconds": settings.max_reference_seconds,
                "references": settings.max_references,
                "duration": settings.max_duration,
                "upload_mb": settings.max_upload_mb,
            },
        }

    @app.get("/api/projects")
    def list_projects() -> list[dict]:
        out = []
        for p in store.list():
            latest = p.renders[-1] if p.renders else None
            out.append(
                {
                    "id": p.id,
                    "name": p.name,
                    "updated": p.updated,
                    "aspect": p.settings.aspect,
                    "duration": p.settings.duration,
                    "scenes": len(p.scenes),
                    "poster": f"/api/projects/{p.id}/files/renders/{latest.poster}" if latest else "",
                }
            )
        return out

    @app.post("/api/projects")
    def create(body: NewProject) -> Project:
        p = SAMPLE.model_copy(deep=True) if body.sample else Project(name=body.name)
        if body.sample:
            fresh = Project()
            p.id, p.created = fresh.id, fresh.created
            for m in p.messages:
                m.id = KeyMessage(text=m.text).id
        return store.save(p)

    @app.get("/api/projects/{pid}")
    def get(pid: str) -> Project:
        return project(pid)

    @app.patch("/api/projects/{pid}")
    def patch(pid: str, body: ProjectPatch) -> Project:
        project(pid)
        changes = body.model_dump(exclude_none=True)

        def apply(p: Project) -> None:
            for key in changes:
                setattr(p, key, getattr(body, key))

        return store.update(pid, apply)

    @app.delete("/api/projects/{pid}")
    def delete(pid: str) -> dict:
        project(pid)
        store.delete(pid, settings.data_dir / "projects" / pid)
        return {"ok": True}

    @app.get("/api/projects/{pid}/files/{path:path}")
    def files(pid: str, path: str) -> FileResponse:
        root = settings.project_dir(pid).resolve()
        target = (root / path).resolve()
        if root not in target.parents or not target.is_file():
            raise HTTPException(404, "No such file.")
        return FileResponse(target, headers={"Cache-Control": "private, max-age=3600"})

    @app.get("/api/projects/{pid}/jobs")
    def project_jobs(pid: str) -> list[Job]:
        return [j for j in store.jobs(pid) if j.status == "running"]

    @app.get("/api/jobs/{jid}")
    def job(jid: str) -> Job:
        j = store.job(jid)
        if j is None:
            raise HTTPException(404, "No such job.")
        return j

    # ---------------------------------------------------------------- style references

    def start_analysis(pid: str, ref: Reference, local: Path | None) -> Job:
        def work(progress) -> dict:
            folder = settings.project_dir(pid) / "refs" / ref.id
            folder.mkdir(parents=True, exist_ok=True)

            def mark(**fields) -> None:
                def change(p: Project) -> None:
                    r = next((r for r in p.references if r.id == ref.id), None)
                    if r:
                        for k, v in fields.items():
                            setattr(r, k, v)

                store.update(pid, change)

            try:
                mark(status="analysing")
                if local is None:
                    progress(0.1, "Fetching the video")
                    video, title = fetch(ref.url, folder, settings.max_reference_seconds)
                    mark(title=title)
                else:
                    video = local
                    seconds = analyse.duration_of(video)
                    if seconds > settings.max_reference_seconds + 1:
                        raise FetchError(
                            f"That video is longer than {int(settings.max_reference_seconds // 60)} minutes."
                        )
                progress(0.4, "Measuring cuts, colour and motion")
                dna = analyse.measure(video)
                sheet = analyse.contact_sheet(video, dna.duration, folder / "sheet.jpg")
                progress(0.75, "Reading the look")
                read = asyncio.run(director.read_style(sheet.read_bytes(), dna))
                dna = dna.model_copy(update=read.model_dump())
                video.unlink(missing_ok=True)
                mark(status="ready", dna=dna, sheet=f"refs/{ref.id}/sheet.jpg", error="")
                return {"reference": ref.id}
            except Exception as e:
                for f in folder.glob("source.*"):
                    f.unlink(missing_ok=True)
                mark(status="failed", error=str(e))
                raise

        return run_job(Job(project=pid, kind="analyse"), work)

    def add_reference(pid: str, ref: Reference) -> None:
        p = project(pid)
        if len(p.references) >= settings.max_references:
            raise HTTPException(400, f"Up to {settings.max_references} references per reel.")

        def change(p: Project) -> None:
            p.references.append(ref)

        store.update(pid, change)

    @app.post("/api/projects/{pid}/references")
    def add_ref(pid: str, body: RefIn) -> dict:
        try:
            url = check_url(body.url)
        except FetchError as e:
            raise HTTPException(400, str(e)) from e
        if any(r.url == url for r in project(pid).references):
            raise HTTPException(400, "That reference is already in this reel.")
        ref = Reference(url=url)
        add_reference(pid, ref)
        job = start_analysis(pid, ref, None)
        return {"reference": ref, "job": job.id}

    @app.post("/api/projects/{pid}/references/upload")
    async def upload_ref(pid: str, file: UploadFile = File(...)) -> dict:
        ref = Reference(url=f"file:{file.filename}", title=file.filename or "Uploaded video")
        add_reference(pid, ref)
        folder = settings.project_dir(pid) / "refs" / ref.id
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / f"source{Path(file.filename or 'v.mp4').suffix or '.mp4'}"
        await _save_upload(file, dest, settings.max_upload_mb)
        job = start_analysis(pid, ref, dest)
        return {"reference": ref, "job": job.id}

    @app.delete("/api/projects/{pid}/references/{rid}")
    def delete_ref(pid: str, rid: str) -> Project:
        def change(p: Project) -> None:
            p.references = [r for r in p.references if r.id != rid]
            for trait in ("pace", "palette", "energy", "music", "type", "motion"):
                if getattr(p.mix, trait) == rid:
                    setattr(p.mix, trait, "theme")

        p = store.update(pid, change)
        shutil.rmtree(settings.project_dir(pid) / "refs" / rid, ignore_errors=True)
        return p

    # ---------------------------------------------------------------- media

    @app.post("/api/projects/{pid}/assets")
    async def upload_asset(pid: str, file: UploadFile = File(...)) -> Asset:
        project(pid)
        mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
        kind = (
            "image"
            if mime.startswith("image/")
            else "video"
            if mime.startswith("video/")
            else "audio"
            if mime.startswith("audio/")
            else None
        )
        if kind is None:
            raise HTTPException(400, "Reel takes images, video clips and audio.")
        asset = Asset(kind=kind, name=file.filename or kind, file="", mime=mime)
        asset.file = f"{asset.id}{Path(file.filename or '').suffix.lower() or mimetypes.guess_extension(mime) or ''}"
        dest = assets_dir(pid) / asset.file
        await _save_upload(file, dest, settings.max_upload_mb)
        _describe(asset, dest)

        def change(p: Project) -> None:
            p.assets.append(asset)

        store.update(pid, change)
        return asset

    @app.patch("/api/projects/{pid}/assets/{aid}")
    def patch_asset(pid: str, aid: str, body: AssetPatch) -> Asset:
        def change(p: Project) -> None:
            for a in p.assets:
                if a.id == aid:
                    if body.name is not None:
                        a.name = body.name
                    if body.note is not None:
                        a.note = body.note

        p = store.update(pid, change)
        return next(a for a in p.assets if a.id == aid)

    @app.delete("/api/projects/{pid}/assets/{aid}")
    def delete_asset(pid: str, aid: str) -> Project:
        gone: list[Asset] = []

        def change(p: Project) -> None:
            gone.extend(a for a in p.assets if a.id == aid)
            p.assets = [a for a in p.assets if a.id != aid]
            for s in p.scenes:
                if s.asset == aid:
                    s.asset, s.visual = "", "type"
                if s.voice == aid:
                    s.voice = ""
            if p.brand.logo == aid:
                p.brand.logo = ""
            if p.settings.music.asset == aid:
                p.settings.music.asset, p.settings.music.source = "", "score"

        p = store.update(pid, change)
        for a in gone:
            (assets_dir(pid) / a.file).unlink(missing_ok=True)
        return p

    @app.post("/api/projects/{pid}/voice/{sid}")
    async def record_voice(pid: str, sid: str, file: UploadFile = File(...)) -> Project:
        p = project(pid)
        if not any(s.id == sid for s in p.scenes):
            raise HTTPException(404, "No such scene.")
        raw = assets_dir(pid) / f"take-{sid}{Path(file.filename or 'take.webm').suffix or '.webm'}"
        await _save_upload(file, raw, 50)
        asset = Asset(kind="voice", name=f"Voice: {sid}", file="", mime="audio/wav")
        asset.file = f"{asset.id}.wav"
        dest = assets_dir(pid) / asset.file
        # Trim silence at the head and tail of the take, so the line starts on the cut.
        trim = "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
        done = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", trim, "-ac", "1", "-ar", "44100", str(dest)],
            capture_output=True,
            text=True,
        )
        raw.unlink(missing_ok=True)
        if done.returncode != 0 or not dest.exists():
            raise HTTPException(400, "Couldn't read that recording.")
        _describe(asset, dest)
        old: list[str] = []

        def change(p: Project) -> None:
            for s in p.scenes:
                if s.id == sid:
                    if s.voice:
                        old.append(s.voice)
                    s.voice = asset.id
            p.assets = [a for a in p.assets if a.id not in old] + [asset]

        p = store.update(pid, change)
        for a in old:
            for f in assets_dir(pid).glob(f"{a}.*"):
                f.unlink(missing_ok=True)
        return p

    @app.post("/api/projects/{pid}/capture")
    def capture(pid: str, body: CaptureIn) -> dict:
        project(pid)
        try:
            url = check_url(body.url)
        except FetchError as e:
            raise HTTPException(400, str(e)) from e

        def work(progress) -> dict:
            progress(0.1, "Opening the page")
            out = assets_dir(pid)
            cmd = [
                "node",
                str(settings.renderer_dir / "capture.mjs"),
                "--url",
                url,
                "--out",
                str(out),
                "--mobile",
                "1" if body.mobile else "0",
            ]
            done = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if done.returncode != 0:
                raise ValueError(f"Couldn't capture that page: {(done.stderr or done.stdout).strip()[-200:]}")
            made: list[Asset] = []
            for line in done.stdout.splitlines():
                if line.startswith("shot "):
                    _, file, label = line.split(" ", 2)
                    a = Asset(kind="image", name=f"Screen: {label}", file="", mime="image/png", note="")
                    a.file = f"{a.id}.png"
                    (out / file).rename(out / a.file)
                    _describe(a, out / a.file)
                    made.append(a)

            def change(p: Project) -> None:
                p.assets.extend(made)

            store.update(pid, change)
            return {"assets": [a.id for a in made]}

        return {"job": run_job(Job(project=pid, kind="capture"), work).id}

    # ---------------------------------------------------------------- the script

    @app.post("/api/projects/{pid}/script")
    async def write_script(pid: str, body: ScriptIn) -> dict:
        p = project(pid)
        if not (p.brief.product or p.brief.pitch):
            raise HTTPException(400, "Give the reel a product name or a pitch first.")
        scenes = await director.write(script_brief(p, body.style))

        def change(p: Project) -> None:
            p.scenes = scenes

        p = store.update(pid, change)
        return {"project": p, "coverage": coverage(p.messages, p.scenes)}

    @app.post("/api/projects/{pid}/scenes/{sid}/rewrite")
    async def rewrite(pid: str, sid: str, body: RewriteIn) -> dict:
        p = project(pid)
        scene = next((s for s in p.scenes if s.id == sid), None)
        if scene is None:
            raise HTTPException(404, "No such scene.")
        text = await director.rewrite(script_brief(p, StyleHint()), scene, body.instruction)
        return text.model_dump()

    @app.post("/api/projects/{pid}/messages/suggest")
    async def suggest(pid: str) -> dict:
        p = project(pid)
        if not (p.brief.product or p.brief.pitch):
            raise HTTPException(400, "Add the product and a pitch first.")
        return {"messages": await director.suggest_messages(p.brief)}

    # ---------------------------------------------------------------- render

    @app.post("/api/projects/{pid}/render")
    def start_render(pid: str, body: RenderIn) -> dict:
        p = project(pid)
        if not p.scenes:
            raise HTTPException(400, "Write the script first: there's nothing to render yet.")
        if any(j.kind == "render" for j in store.jobs(pid) if j.status == "running"):
            raise HTTPException(409, "This reel is already rendering.")

        def work(progress) -> dict:
            made = renderer.render(settings, project(pid), body.quality, progress)

            def change(p: Project) -> None:
                p.renders.append(made)

            store.update(pid, change)
            return {"render": made.model_dump()}

        return {"job": run_job(Job(project=pid, kind="render"), work).id}

    @app.delete("/api/projects/{pid}/renders/{rid}")
    def delete_render(pid: str, rid: str) -> Project:
        gone = [r for r in project(pid).renders if r.id == rid]

        def change(p: Project) -> None:
            p.renders = [r for r in p.renders if r.id != rid]

        p = store.update(pid, change)
        for r in gone:
            for f in (r.file, r.poster):
                (settings.project_dir(pid) / "renders" / f).unlink(missing_ok=True)
        return p

    # The built studio, and the film engine's render page, from the same origin as the API.
    if settings.frontend_dist.exists():
        app.mount("/", StaticFiles(directory=settings.frontend_dist, html=True), name="studio")
    return app


async def _save_upload(file: UploadFile, dest: Path, max_mb: int) -> None:
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > max_mb * 1024 * 1024:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"Files can be up to {max_mb} MB.")
            out.write(chunk)


def _describe(asset: Asset, path: Path) -> None:
    """Fill in size and length from ffprobe."""
    try:
        info = analyse.probe(path)
    except ValueError:
        return
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and s.get("width"):
            asset.width, asset.height = int(s["width"]), int(s["height"])
            break
    if asset.kind in ("video", "audio", "voice"):
        d = info.get("format", {}).get("duration")
        asset.duration = round(float(d), 2) if d else None
    if asset.kind == "audio":
        samples = analyse.audio(path)
        asset.bpm = analyse.tempo(samples) if samples is not None else None
