#!/usr/bin/env python3
"""Package the walkthrough into a size-checked, standalone build folder.

Run with a Python interpreter containing Pillow: python tools/package.py.
Inputs: index.html, style.css, dist/app.js, data/, and the six runtime asset folders.
Output: build/, with resolved asset symlinks and compressed images/videos.
Requires ffmpeg and ffprobe on PATH when a video exceeds the upload limit.
Limits use decimal MB, conservatively matching the publishing hard caps.
Source assets are never modified; a failed package leaves the previous build intact.
"""

import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("ERROR: Pillow is required. Run this script with a Python environment containing Pillow.")

ROOT = Path(__file__).resolve().parents[1]
FILE_LIMIT = 15_000_000
TOTAL_LIMIT = 240_000_000
ASSET_FOLDERS = ("tex", "hdr", "photos", "panos", "rednote")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def process_image(src, dst, folder):
    """Downscale runtime images while preserving their names and aspect ratios."""
    with Image.open(src) as original:
        image = ImageOps.exif_transpose(original)
        if folder == "panos":
            if image.width <= 3072 and image.height <= 1536:
                shutil.copy2(src, dst)
                return
            image = image.resize((3072, 1536), Image.Resampling.LANCZOS)
        else:
            bound = 1024 if folder == "tex" else 1280
            if folder == "rednote" and max(image.size) <= bound:
                shutil.copy2(src, dst)
                return
            image.thumbnail((bound, bound), Image.Resampling.LANCZOS)
        if src.suffix.lower() in {".jpg", ".jpeg"}:
            image.convert("RGB").save(dst, quality=82 if folder == "tex" else 85, optimize=True)
        else:
            image.save(dst)


def compress_video(src, dst, scratch):
    """Use two-pass H.264 encoding to fit a video below the per-file cap."""
    if src.stat().st_size <= FILE_LIMIT:
        shutil.copy2(src, dst)
        return
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise RuntimeError(f"{tool} is required to compress {src.name}")
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(src)
    ], capture_output=True, text=True, check=True)
    duration = float(json.loads(probe.stdout)["format"]["duration"])
    if duration <= 0:
        raise RuntimeError(f"Invalid video duration: {src.name}")
    audio_rate = 96_000
    video_rate = int(FILE_LIMIT * 0.94 * 8 / duration - audio_rate)
    if video_rate <= 0:
        raise RuntimeError(f"Video too long for the size budget: {src.name}")
    for attempt in range(2):
        common = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
                  "-map", "0:v:0", "-c:v", "libx264", "-b:v", str(video_rate),
                  "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                  "-passlogfile", str(scratch / f"{src.stem}-{attempt}")]
        subprocess.run(common + ["-pass", "1", "-an", "-f", "null", "/dev/null"], check=True)
        subprocess.run(common + ["-pass", "2", "-map", "0:a:0?", "-c:a", "aac",
                                 "-b:a", str(audio_rate), "-movflags", "+faststart", str(dst)], check=True)
        if dst.stat().st_size <= FILE_LIMIT:
            print(f"Compressed {src.name}: {src.stat().st_size / 1e6:.2f} → {dst.stat().st_size / 1e6:.2f} MB")
            return
        video_rate = int(video_rate * 0.85)
    raise RuntimeError(f"Video still exceeds 15 MB after encoding: {src.name}")


def copy_folder(src, dst, folder, scratch):
    """Copy one approved runtime folder, dereferencing symlinks along the way."""
    if not src.is_dir():
        raise RuntimeError(f"Missing runtime folder: {src}")
    dst.mkdir(parents=True, exist_ok=True)
    for path in sorted(src.rglob("*")):
        if not path.is_file() or path.name.startswith("."):
            continue
        target = dst / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        suffix = path.suffix.lower()
        if folder in {"tex", "panos", "rednote"} and suffix in IMAGE_SUFFIXES:
            process_image(path, target, folder)
        elif folder == "rednote" and suffix == ".mp4":
            compress_video(path, target, scratch)
        else:
            shutil.copy2(path, target)


def report_and_check(build):
    """Print folder sizes and reject any package exceeding either hard limit."""
    total = 0
    sizes = {}
    oversized = []
    largest = (0, "")
    for path in sorted(build.rglob("*")):
        if not path.is_file():
            continue
        size = path.stat().st_size
        rel = path.relative_to(build)
        group = "/".join(rel.parts[:2]) if rel.parts[0] == "assets" else rel.parts[0]
        if len(rel.parts) == 1:
            group = "root"
        sizes[group] = sizes.get(group, 0) + size
        total += size
        largest = max(largest, (size, str(rel)))
        if size > FILE_LIMIT:
            oversized.append(f"{rel}: {size / 1e6:.2f} MB")
    for folder, size in sorted(sizes.items()):
        print(f"{folder:18} {size / 1e6:9.2f} MB")
    print(f"{'TOTAL':18} {total / 1e6:9.2f} MB / 240 MB")
    print(f"Largest file: {largest[1]} ({largest[0] / 1e6:.2f} MB / 15 MB)")
    if oversized or total > TOTAL_LIMIT:
        raise RuntimeError("Package exceeds hard limits: " + "; ".join(
            oversized + ([f"total {total / 1e6:.2f} MB"] if total > TOTAL_LIMIT else [])))


def main():
    """Build and validate a clean package before replacing a previous build."""
    build = ROOT / "build"
    if build.is_symlink():
        raise RuntimeError("Refusing to replace a symlink at build/")
    with tempfile.TemporaryDirectory(prefix="croton-package-") as temporary:
        scratch = Path(temporary)
        staged = scratch / "build"
        staged.mkdir()
        for name in ("index.html", "style.css", "dist/app.js"):
            src = ROOT / name
            target = staged / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name.endswith(".js"):
                code = re.sub(r"^//# sourceMappingURL=.*$", "", src.read_text(), flags=re.MULTILINE)
                target.write_text(code)
            else:
                shutil.copy2(src, target)
        copy_folder(ROOT / "data", staged / "data", "data", scratch)
        for folder in ASSET_FOLDERS:
            copy_folder(ROOT / "assets" / folder, staged / "assets" / folder, folder, scratch)
        report_and_check(staged)
        if build.exists():
            shutil.rmtree(build)
        shutil.move(str(staged), build)
    print(f"Ready: {build}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(f"ERROR: {error}")
