"""Safe ZIP and directory readers with strict resource and path limits."""

import io
import os
import stat
import zipfile
import zlib
from pathlib import Path, PurePosixPath

from .service import MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, SOURCE_EXTENSIONS

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_COMPRESSION_RATIO = 250


class SourceInputError(ValueError):
    """Invalid, unsafe, or oversized source input."""


def _safe_path(name: str) -> str:
    if name.endswith("/"):
        name = name[:-1]
    if (
        not name
        or "\x00" in name
        or "\\" in name
        or name.startswith("/")
        or (len(name) >= 2 and name[1] == ":")
    ):
        raise SourceInputError("The archive contains an unsafe file path.")
    parts = name.split("/")
    if any(part in {"..", ".", ""} for part in parts):
        raise SourceInputError("The archive contains an unsafe file path.")
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or len(path.parts) > 32:
        raise SourceInputError("The archive contains an unsafe file path.")
    return path.as_posix().rstrip("/")


def read_zip(data: bytes) -> dict[str, bytes]:
    if not data or len(data) > MAX_ARCHIVE_BYTES:
        raise SourceInputError("Choose a ZIP archive smaller than 20 MB.")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError, ValueError):
        raise SourceInputError("The uploaded file is not a valid ZIP archive.") from None
    files: dict[str, bytes] = {}
    seen: set[str] = set()
    count = 0
    expanded = 0
    decoded = 0
    try:
        for entry in archive.infolist():
            count += 1
            if count > MAX_FILES:
                raise SourceInputError("The archive contains too many entries.")
            path = _safe_path(entry.filename)
            if not path:
                if entry.is_dir():
                    continue
                raise SourceInputError("The archive contains an unsafe file path.")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise SourceInputError("Symbolic links are not accepted in source archives.")
            file_type = stat.S_IFMT(mode)
            if file_type and not entry.is_dir() and not stat.S_ISREG(mode):
                raise SourceInputError("The archive contains a non-regular file.")
            if entry.flag_bits & 0x1:
                raise SourceInputError("Encrypted ZIP archives are not supported.")
            if entry.is_dir():
                continue
            path_key = path.casefold()
            if path_key in seen:
                raise SourceInputError("The archive contains duplicate file paths.")
            seen.add(path_key)
            if entry.file_size > MAX_FILE_BYTES:
                raise SourceInputError("A project file exceeds the 2 MB file limit.")
            expanded += entry.file_size
            if expanded > MAX_TOTAL_BYTES:
                raise SourceInputError("The expanded project exceeds the 50 MB limit.")
            if entry.file_size > max(1, entry.compress_size) * MAX_COMPRESSION_RATIO:
                raise SourceInputError("The archive contains an excessive compression ratio.")
            # Read only source and asset metadata candidates; never unpack to disk.
            if not _supported(path):
                continue
            try:
                content_parts = []
                content_size = 0
                with archive.open(entry, "r") as source:
                    while chunk := source.read(32 * 1024):
                        content_size += len(chunk)
                        decoded += len(chunk)
                        if content_size > MAX_FILE_BYTES or decoded > MAX_TOTAL_BYTES:
                            raise SourceInputError("The expanded project exceeds analysis limits.")
                        content_parts.append(chunk)
                content = b"".join(content_parts)
            except SourceInputError:
                raise
            except (OSError, RuntimeError, EOFError, zlib.error, zipfile.BadZipFile):
                raise SourceInputError("A project file could not be read safely.") from None
            files[path] = content
    finally:
        archive.close()
    return _strip_common_root(files)


def _supported(path: str) -> bool:
    parts = PurePosixPath(path).parts
    excluded = {
        ".git",
        "node_modules",
        ".next",
        "dist",
        "build",
        "coverage",
        ".venv",
        "venv",
        "vendor",
        "target",
        ".cache",
        "__pycache__",
        ".turbo",
    }
    if any(part.casefold() in excluded for part in parts):
        return False
    basename = parts[-1].casefold()
    if basename in {
        ".env",
        ".env.local",
        "credentials.json",
        "secrets.json",
        "id_rsa",
        "id_ed25519",
    }:
        return False
    return PurePosixPath(path).suffix.casefold() in SOURCE_EXTENSIONS


def _strip_common_root(files: dict[str, bytes]) -> dict[str, bytes]:
    if not files:
        return files
    first_parts = [PurePosixPath(name).parts for name in files]
    common = (
        first_parts[0][0]
        if all(len(parts) > 1 and parts[0] == first_parts[0][0] for parts in first_parts)
        else None
    )
    if not common:
        return files
    return {
        PurePosixPath(name).relative_to(common).as_posix(): content
        for name, content in files.items()
    }


def read_directory(root: Path) -> tuple[dict[str, bytes], str]:
    if root.expanduser().is_symlink():
        raise SourceInputError("Symbolic links are not accepted as local project roots.")
    try:
        trusted_root = root.expanduser().resolve(strict=True)
    except OSError:
        raise SourceInputError("The local project directory does not exist.") from None
    if not trusted_root.is_dir():
        raise SourceInputError("Choose a local project directory.")
    files: dict[str, bytes] = {}
    total = 0
    count = 0
    for current, directories, names in os.walk(trusted_root, followlinks=False):
        directory = Path(current)
        for name in tuple(directories):
            child = directory / name
            if child.is_symlink():
                raise SourceInputError("Symbolic links are not accepted in local projects.")
        directories[:] = [name for name in directories if _supported(name + "/placeholder.ts")]
        for name in names:
            path = directory / name
            if path.is_symlink():
                raise SourceInputError("Symbolic links are not accepted in local projects.")
            relative = path.relative_to(trusted_root).as_posix()
            safe = _safe_path(relative)
            if not _supported(safe):
                continue
            count += 1
            if count > MAX_FILES:
                raise SourceInputError("The project contains too many files.")
            try:
                size = path.stat(follow_symlinks=False).st_size
                if size > MAX_FILE_BYTES:
                    if path.suffix.casefold() in {
                        ".svg",
                        ".png",
                        ".jpg",
                        ".jpeg",
                        ".webp",
                        ".avif",
                        ".gif",
                    }:
                        continue
                    raise SourceInputError("A project source file exceeds the 2 MB file limit.")
                total += size
                if total > MAX_TOTAL_BYTES:
                    raise SourceInputError("The project exceeds the 50 MB analysis limit.")
                files[safe] = path.read_bytes()
            except OSError:
                raise SourceInputError("A local project file could not be read safely.") from None
    if not files:
        raise SourceInputError("No supported source or asset files were found.")
    return files, trusted_root.name[:180] or "Local project"
