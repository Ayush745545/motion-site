"""Trusted-development CLI for static analysis of a local directory."""

import json
import sys
from pathlib import Path

from motion_dna_api.config import Settings

from .archive import SourceInputError, read_directory
from .service import analyze_files


def main():
    settings = Settings()
    if settings.app_env == "production" or not settings.source_local_mode:
        raise SystemExit(
            "Local directory analysis is disabled. Set SOURCE_LOCAL_MODE=1 in development."
        )
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m motion_dna_api.source.local_cli /path/to/project")
    try:
        files, name = read_directory(Path(sys.argv[1]))
        result = analyze_files(files, "local_directory", name)
    except (SourceInputError, ValueError) as exc:
        raise SystemExit(str(exc)) from None
    sys.stdout.write(json.dumps(result.model_dump(mode="json"), indent=2) + "\n")


if __name__ == "__main__":
    main()
