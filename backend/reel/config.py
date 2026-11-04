import os
from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent


class Settings(BaseSettings):
    """Runtime configuration, read from the environment (prefix ``REEL_``) or ``.env``."""

    model_config = SettingsConfigDict(env_prefix="REEL_", env_file=".env", extra="ignore")

    # "anthropic" talks to Claude; "scripted" is a deterministic offline director for tests and demos.
    # Left empty, it is "anthropic" when ANTHROPIC_API_KEY is set and "scripted" otherwise.
    llm: str = ""
    model: str = "claude-opus-5-5"

    data_dir: Path = ROOT / "data"
    # Reference videos longer than this are refused before anything is downloaded.
    max_reference_seconds: float = 300
    max_references: int = 5
    max_upload_mb: int = 200
    max_duration: float = 300

    # The film engine's page and the Node renderer. The page is the built frontend, served by this API.
    frontend_dist: Path = REPO / "frontend" / "dist"
    renderer_dir: Path = REPO / "renderer"
    render_page: str = ""  # override, e.g. http://localhost:5190/render.html while developing
    public_url: str = "http://127.0.0.1:8070"
    cors_origins: list[str] = ["http://localhost:5190", "http://127.0.0.1:5190"]

    @model_validator(mode="after")
    def _pick_llm(self) -> "Settings":
        if not self.llm:
            self.llm = "anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "scripted"
        return self

    @property
    def db_path(self) -> Path:
        return self.data_dir / "reel.db"

    def project_dir(self, project_id: str) -> Path:
        path = self.data_dir / "projects" / project_id
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
