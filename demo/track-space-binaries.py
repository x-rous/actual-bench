#!/usr/bin/env python3
"""Track Git-detected binary files in a prepared Hugging Face Space clone."""

import os
from pathlib import Path
import subprocess
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 demo/track-space-binaries.py SPACE_CLONE")
    root = Path(sys.argv[1]).resolve(strict=True)
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=root,
    ).split(b"\0")
    binaries = []
    for raw_path in sorted(set(paths)):
        if not raw_path:
            continue
        path = os.fsdecode(raw_path)
        file = root / path
        if file.is_symlink() or not file.is_file():
            continue
        with file.open("rb") as stream:
            if b"\0" in stream.read(8000):
                binaries.append(path)
    if binaries:
        subprocess.run(["git", "lfs", "track", "--filename", "--", *binaries], cwd=root, check=True)
    print(f"Tracked {len(binaries)} binary files in the Space clone.")


if __name__ == "__main__":
    main()
