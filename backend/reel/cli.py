"""Command line: run the studio, or analyse a reference video's style."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(prog="reel", description="Product films, directed by AI.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    serve = sub.add_parser("serve", help="Run the API (and the built studio, if frontend/dist exists).")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8070)
    style = sub.add_parser("style", help="Print the style DNA of a local video file.")
    style.add_argument("video", type=Path)
    args = parser.parse_args()

    if args.cmd == "serve":
        import os

        import uvicorn

        os.environ.setdefault("REEL_PUBLIC_URL", f"http://{args.host}:{args.port}")
        from .api import create_app

        uvicorn.run(create_app(), host=args.host, port=args.port)
    elif args.cmd == "style":
        import tempfile

        from .config import get_settings
        from .director import make_director
        from .style.analyse import contact_sheet, measure

        dna = measure(args.video)
        with tempfile.TemporaryDirectory() as tmp:
            sheet = contact_sheet(args.video, dna.duration, Path(tmp) / "sheet.jpg")
            read = asyncio.run(make_director(get_settings()).read_style(sheet.read_bytes(), dna))
        print(json.dumps(dna.model_copy(update=read.model_dump()).model_dump(), indent=2))


if __name__ == "__main__":
    main()
