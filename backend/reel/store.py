"""Projects and jobs in SQLite. A project is one JSON document; jobs track the slow work (analysis, capture, render)."""

from __future__ import annotations

import shutil
import sqlite3
import threading
import time
from pathlib import Path

from .models import Job, Project


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project TEXT NOT NULL, data TEXT NOT NULL);
                """
            )

    # ---- projects
    def list(self) -> list[Project]:
        with self.lock:
            rows = self.db.execute("SELECT data FROM projects ORDER BY updated DESC").fetchall()
        return [Project.model_validate_json(r[0]) for r in rows]

    def get(self, project_id: str) -> Project | None:
        with self.lock:
            row = self.db.execute("SELECT data FROM projects WHERE id = ?", (project_id,)).fetchone()
        return Project.model_validate_json(row[0]) if row else None

    def save(self, project: Project) -> Project:
        project.updated = time.time()
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO projects (id, data, updated) VALUES (?, ?, ?)",
                (project.id, project.model_dump_json(), project.updated),
            )
            self.db.commit()
        return project

    def update(self, project_id: str, change) -> Project:
        """Read, change and write a project under the lock, so background jobs and edits don't overwrite each other."""
        with self.lock:
            project = self.get(project_id)
            if project is None:
                raise KeyError(project_id)
            change(project)
            return self.save(project)

    def delete(self, project_id: str, files: Path | None = None) -> None:
        with self.lock:
            self.db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            self.db.execute("DELETE FROM jobs WHERE project = ?", (project_id,))
            self.db.commit()
        if files and files.exists():
            shutil.rmtree(files)

    # ---- jobs
    def put_job(self, job: Job) -> Job:
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO jobs (id, project, data) VALUES (?, ?, ?)",
                (job.id, job.project, job.model_dump_json()),
            )
            self.db.commit()
        return job

    def job(self, job_id: str) -> Job | None:
        with self.lock:
            row = self.db.execute("SELECT data FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return Job.model_validate_json(row[0]) if row else None

    def jobs(self, project_id: str) -> list[Job]:
        with self.lock:
            rows = self.db.execute("SELECT data FROM jobs WHERE project = ?", (project_id,)).fetchall()
        return [Job.model_validate_json(r[0]) for r in rows]
