"""PostgreSQL persistence with owner predicates on every project lookup."""

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import struct
import zlib
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

import psycopg
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from motion_dna_api.config import Settings
from motion_dna_api.director.models import Storyboard
from motion_dna_api.dna.models import DNAResult
from motion_dna_api.renders.models import ProjectDocument
from motion_dna_api.source.models import SourceDNA

MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_CODE_BYTES = 256 * 1024
MAX_ASSET_BYTES = 10 * 1024 * 1024
MAX_ACCOUNT_STORAGE = 1024 * 1024 * 1024
RETENTION_DAYS = 30


class DocumentError(ValueError):
    pass


def validate_document(raw: dict, *, project_id: UUID | None = None) -> dict:
    try:
        encoded = json.dumps(
            raw, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
    except (TypeError, ValueError):
        raise DocumentError("Project document must contain valid JSON values.") from None
    if len(encoded) > MAX_DOCUMENT_BYTES:
        raise DocumentError("Project document exceeds the 4 MB limit.")
    if not isinstance(raw, dict):
        raise DocumentError("Project document must be an object.")
    name, kind, source = raw.get("name"), raw.get("sourceType"), raw.get("source")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise DocumentError("Project name must contain 1 to 80 characters.")
    if kind not in {"url", "code"} or not isinstance(source, str) or not source.strip():
        raise DocumentError("A website URL or source code is required.")
    if kind == "code" and len(source.encode("utf-8")) > MAX_CODE_BYTES:
        raise DocumentError("Source code exceeds the 256 KB limit.")
    if kind == "url":
        parsed = urlsplit(source)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or len(source) > 2048
        ):
            raise DocumentError("Use a valid public HTTP or HTTPS URL without credentials.")
    scenes = raw.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 12:
        raise DocumentError("A project must contain between 1 and 12 scenes.")
    scene_ids: set[str] = set()
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("id"), str):
            raise DocumentError("Every scene needs a valid identifier.")
        scene_id = scene["id"]
        if scene_id in scene_ids:
            raise DocumentError("Scene identifiers must be unique.")
        scene_ids.add(scene_id)
        duration = scene.get("duration")
        if (
            isinstance(duration, bool)
            or not isinstance(duration, (int, float))
            or not math.isfinite(duration)
            or not 0 < duration <= 300
        ):
            raise DocumentError("Scene duration must be between 0 and 300 seconds.")
        if not isinstance(scene.get("name"), str) or len(scene["name"]) > 80:
            raise DocumentError("Scene names must be 80 characters or shorter.")
    if raw.get("activeSceneId") not in scene_ids:
        raise DocumentError("Choose an existing active scene.")
    if raw.get("resolution") not in {"1920x1080", "1080x1920", "1080x1080"}:
        raise DocumentError("Choose a supported project resolution.")
    if raw.get("fps") not in {24, 30, 60}:
        raise DocumentError("Choose a supported frame rate.")
    try:
        if raw.get("timeline") is not None:
            ProjectDocument.model_validate(raw["timeline"])
        if raw.get("sourceDNA") is not None:
            SourceDNA.model_validate(raw["sourceDNA"])
        if raw.get("websiteDNA") is not None:
            DNAResult.model_validate(raw["websiteDNA"])
        if raw.get("storyboard") is not None:
            Storyboard.model_validate(raw["storyboard"])
        if raw.get("videoDraft") is not None:
            draft = raw["videoDraft"]
            if (
                not isinstance(draft, dict)
                or draft.get("template")
                not in {"cinematic", "saas", "typography", "technology", "walkthrough"}
                or draft.get("format") not in {"landscape", "portrait"}
                or not isinstance(draft.get("features"), list)
                or len(draft["features"]) != 3
            ):
                raise ValueError("Invalid video draft.")
    except (ValidationError, ValueError, TypeError):
        raise DocumentError("A saved DNA, storyboard, or timeline is invalid.") from None
    normalized = dict(raw)
    if project_id is not None:
        normalized["id"] = str(project_id)
    normalized["name"] = name.strip()
    return normalized


class ProjectRepository:
    def __init__(self, settings: Settings):
        self.dsn = settings.database_url.get_secret_value()
        self.storage = settings.render_storage_dir.parent / "private-assets"

    def connect(self):
        connection = psycopg.connect(self.dsn, connect_timeout=3)
        connection.execute("SET statement_timeout='5s'")
        return connection

    @staticmethod
    def _result(row):
        if not row:
            return None
        return {
            "id": str(row[0]),
            "revision": row[1],
            "document": row[2],
            "createdAt": row[3].isoformat(),
            "updatedAt": row[4].isoformat(),
        }

    def create(self, owner_id: UUID, document: dict) -> dict:
        identifier = uuid4()
        now = datetime.now(UTC)
        valid = validate_document(document, project_id=identifier)
        valid["createdAt"] = now.isoformat().replace("+00:00", "Z")
        valid["updatedAt"] = now.isoformat().replace("+00:00", "Z")
        with self.connect() as connection:
            count = connection.execute(
                "SELECT count(*) FROM projects WHERE owner_id=%s AND deleted_at IS NULL",
                (owner_id,),
            ).fetchone()[0]
            if count >= 100:
                raise DocumentError("This account has reached the 100-project local limit.")
            self._validate_asset_links(connection, owner_id, identifier, valid)
            connection.execute(
                "INSERT INTO projects(id,owner_id,name,schema_version,revision,document,"
                "created_at,updated_at) "
                "VALUES(%s,%s,%s,1,1,%s,%s,%s)",
                (identifier, owner_id, valid["name"], Jsonb(valid), now, now),
            )
            self._sync_relations(connection, owner_id, identifier, valid)
            connection.execute(
                "INSERT INTO project_versions(project_id,owner_id,revision,"
                "schema_version,document,created_at) "
                "VALUES(%s,%s,1,1,%s,%s)",
                (identifier, owner_id, Jsonb(valid), now),
            )
            row = connection.execute(
                "SELECT id,revision,document,created_at,updated_at FROM projects "
                "WHERE id=%s AND owner_id=%s",
                (identifier, owner_id),
            ).fetchone()
        return self._result(row)

    def list(self, owner_id: UUID) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id,revision,document,created_at,updated_at FROM projects "
                "WHERE owner_id=%s AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
                (owner_id,),
            ).fetchall()
        return [self._result(row) for row in rows]

    def get(self, owner_id: UUID, identifier: UUID) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id,revision,document,created_at,updated_at FROM projects "
                "WHERE owner_id=%s AND id=%s AND deleted_at IS NULL",
                (owner_id, identifier),
            ).fetchone()
        return self._result(row)

    def update(
        self, owner_id: UUID, identifier: UUID, revision: int, document: dict
    ) -> dict | None:
        current = self.get(owner_id, identifier)
        if not current:
            return None
        if current["revision"] != revision:
            raise RevisionConflict(current)
        valid = validate_document(document, project_id=identifier)
        valid["createdAt"] = current["document"].get("createdAt", current["createdAt"])
        now = datetime.now(UTC)
        valid["updatedAt"] = now.isoformat().replace("+00:00", "Z")
        with self.connect() as connection:
            self._validate_asset_links(connection, owner_id, identifier, valid)
            row = connection.execute(
                "UPDATE projects SET name=%s,document=%s,revision=revision+1,updated_at=%s "
                "WHERE owner_id=%s AND id=%s AND revision=%s AND deleted_at IS NULL "
                "RETURNING id,revision,document,created_at,updated_at",
                (valid["name"], Jsonb(valid), now, owner_id, identifier, revision),
            ).fetchone()
            if not row:
                latest = connection.execute(
                    "SELECT id,revision,document,created_at,updated_at FROM projects "
                    "WHERE owner_id=%s AND id=%s AND deleted_at IS NULL",
                    (owner_id, identifier),
                ).fetchone()
                if not latest:
                    return None
                raise RevisionConflict(self._result(latest))
            self._sync_relations(connection, owner_id, identifier, valid)
            connection.execute(
                "INSERT INTO project_versions(project_id,owner_id,revision,"
                "schema_version,document,created_at) "
                "VALUES(%s,%s,%s,1,%s,%s)",
                (identifier, owner_id, row[1], Jsonb(valid), now),
            )
            connection.execute(
                "DELETE FROM project_versions WHERE owner_id=%s AND project_id=%s "
                "AND revision NOT IN (SELECT revision FROM project_versions "
                "WHERE owner_id=%s AND project_id=%s ORDER BY revision DESC LIMIT 100)",
                (owner_id, identifier, owner_id, identifier),
            )
        return self._result(row)

    def versions(self, owner_id: UUID, identifier: UUID) -> list[dict] | None:
        with self.connect() as connection:
            owned = connection.execute(
                "SELECT 1 FROM projects WHERE owner_id=%s AND id=%s AND deleted_at IS NULL",
                (owner_id, identifier),
            ).fetchone()
            if not owned:
                return None
            rows = connection.execute(
                "SELECT revision,schema_version,created_at FROM project_versions "
                "WHERE owner_id=%s AND project_id=%s ORDER BY revision DESC LIMIT 100",
                (owner_id, identifier),
            ).fetchall()
        return [
            {"revision": row[0], "schema_version": row[1], "created_at": row[2].isoformat()}
            for row in rows
        ]

    def version(self, owner_id: UUID, identifier: UUID, revision: int) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT v.revision,v.schema_version,v.document,v.created_at "
                "FROM project_versions v "
                "JOIN projects p ON p.id=v.project_id AND p.owner_id=v.owner_id "
                "WHERE v.owner_id=%s AND v.project_id=%s AND v.revision=%s "
                "AND p.deleted_at IS NULL",
                (owner_id, identifier, revision),
            ).fetchone()
        if not row:
            return None
        return {
            "revision": row[0],
            "schema_version": row[1],
            "document": row[2],
            "created_at": row[3].isoformat(),
        }

    def delete(self, owner_id: UUID, identifier: UUID) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "UPDATE projects SET deleted_at=now(),updated_at=now() "
                "WHERE owner_id=%s AND id=%s AND deleted_at IS NULL RETURNING id",
                (owner_id, identifier),
            ).fetchone()
            if not row:
                return False
            connection.execute(
                """UPDATE render_jobs SET cancel_requested=true,
                status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
                payload=CASE WHEN status='queued' THEN
                    jsonb_set(jsonb_set(payload,'{status}','\"cancelled\"'::jsonb),
                    '{stage}','\"Project deleted\"'::jsonb) ELSE payload END,
                updated_at=now() WHERE owner_id=%s AND project_id=%s
                AND status IN ('queued','running','retrying','cancelling')""",
                (owner_id, identifier),
            )
            connection.execute(
                """UPDATE dna_jobs SET payload=jsonb_set(
                    jsonb_set(jsonb_set(payload,'{status}','\"failed\"'::jsonb),
                    '{error_code}','\"project_deleted\"'::jsonb),
                    '{error}','\"Project deleted.\"'::jsonb)
                    WHERE owner_id=%s AND project_id=%s
                    AND payload->>'status' IN ('queued','running')""",
                (owner_id, identifier),
            )
        return True

    def usage(self, owner_id: UUID) -> dict:
        with self.connect() as connection:
            projects = connection.execute(
                "SELECT count(*) FROM projects WHERE owner_id=%s AND deleted_at IS NULL",
                (owner_id,),
            ).fetchone()[0]
            assets = connection.execute(
                "SELECT coalesce(sum(byte_size),0) FROM assets WHERE owner_id=%s", (owner_id,)
            ).fetchone()[0]
            exports = connection.execute(
                "SELECT coalesce(sum(byte_size),0) FROM exports WHERE owner_id=%s", (owner_id,)
            ).fetchone()[0]
        return {
            "projects": projects,
            "assets_bytes": assets,
            "exports_bytes": exports,
            "used_bytes": assets + exports,
            "quota_bytes": MAX_ACCOUNT_STORAGE,
        }

    def save_asset(
        self, owner_id: UUID, project_id: UUID, filename: str, mime: str, data: bytes
    ) -> dict | None:
        if not 0 < len(data) <= MAX_ASSET_BYTES:
            raise DocumentError("Images must be 10 MB or smaller.")
        detected = sniff_image(data)
        if detected != mime:
            raise DocumentError("File contents do not match the declared image format.")
        safe_name = (
            re.sub(r"[^A-Za-z0-9._ -]", "_", Path(filename).name)[:180].strip(" .") or "image"
        )
        identifier = uuid4()
        project_dir = self.storage / str(owner_id) / str(project_id)
        target = project_dir / str(identifier)
        try:
            with self.connect() as connection:
                connection.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (owner_id,))
                owned = connection.execute(
                    "SELECT 1 FROM projects WHERE owner_id=%s AND id=%s AND deleted_at IS NULL",
                    (owner_id, project_id),
                ).fetchone()
                if not owned:
                    return None
                used = connection.execute(
                    """SELECT (SELECT coalesce(sum(byte_size),0) FROM assets WHERE owner_id=%s)
                        + (SELECT coalesce(sum(byte_size),0) FROM exports WHERE owner_id=%s)""",
                    (owner_id, owner_id),
                ).fetchone()[0]
                if used + len(data) > MAX_ACCOUNT_STORAGE:
                    raise DocumentError("The local account storage quota has been reached.")
                project_dir.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                key = f"{owner_id}/{project_id}/{identifier}"
                connection.execute(
                    "INSERT INTO assets(id,owner_id,project_id,filename,mime_type,byte_size,"
                    "sha256,storage_key) "
                    "VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
                    (
                        identifier,
                        owner_id,
                        project_id,
                        safe_name,
                        mime,
                        len(data),
                        hashlib.sha256(data).hexdigest(),
                        key,
                    ),
                )
        except Exception:
            target.unlink(missing_ok=True)
            raise
        return {
            "id": str(identifier),
            "filename": safe_name,
            "mime_type": mime,
            "byte_size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "created_at": datetime.now(UTC).isoformat(),
        }

    @staticmethod
    def _validate_asset_links(connection, owner_id: UUID, project_id: UUID, document: dict) -> None:
        timeline = document.get("timeline")
        if not isinstance(timeline, dict):
            return
        for asset in timeline.get("assets", []):
            stored_id = asset.get("storageAssetId") if isinstance(asset, dict) else None
            if (
                stored_id
                and not connection.execute(
                    "SELECT 1 FROM assets WHERE id=%s AND owner_id=%s AND project_id=%s",
                    (stored_id, owner_id, project_id),
                ).fetchone()
            ):
                raise DocumentError("A project image is missing or belongs to another account.")

    def asset(self, owner_id: UUID, project_id: UUID, asset_id: UUID):
        with self.connect() as connection:
            row = connection.execute(
                "SELECT a.storage_key,a.mime_type,a.filename,a.byte_size FROM assets a "
                "JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id "
                "WHERE a.owner_id=%s AND a.project_id=%s AND a.id=%s AND p.deleted_at IS NULL",
                (owner_id, project_id, asset_id),
            ).fetchone()
        if not row:
            return None
        path = (self.storage / row[0]).resolve()
        if (
            path.parent != (self.storage / str(owner_id) / str(project_id)).resolve()
            or not path.is_file()
            or path.stat().st_size != row[3]
        ):
            return None
        return path, row[1], row[2]

    def delete_asset(self, owner_id: UUID, project_id: UUID, asset_id: UUID) -> bool:
        with self.connect() as connection:
            row = connection.execute(
                "DELETE FROM assets WHERE owner_id=%s AND project_id=%s AND id=%s "
                "RETURNING storage_key",
                (owner_id, project_id, asset_id),
            ).fetchone()
        if row:
            file = (self.storage / row[0]).resolve()
            if file.parent == (self.storage / str(owner_id) / str(project_id)).resolve():
                file.unlink(missing_ok=True)
        return bool(row)

    def purge_expired(self) -> int:
        with self.connect() as connection:
            projects = connection.execute(
                "SELECT id,owner_id FROM projects "
                "WHERE deleted_at < now() - (%s * interval '1 day')",
                (RETENTION_DAYS,),
            ).fetchall()
            asset_keys, render_ids = [], []
            for project_id, owner_id in projects:
                asset_keys.extend(
                    row[0]
                    for row in connection.execute(
                        "SELECT storage_key FROM assets WHERE project_id=%s AND owner_id=%s",
                        (project_id, owner_id),
                    ).fetchall()
                )
                render_ids.extend(
                    row[0]
                    for row in connection.execute(
                        "SELECT id FROM render_jobs WHERE project_id=%s AND owner_id=%s",
                        (project_id, owner_id),
                    ).fetchall()
                )
                connection.execute(
                    "DELETE FROM render_jobs WHERE project_id=%s AND owner_id=%s",
                    (project_id, owner_id),
                )
                connection.execute(
                    "DELETE FROM projects WHERE id=%s AND owner_id=%s", (project_id, owner_id)
                )
            connection.execute("DELETE FROM sessions WHERE expires_at <= now()")
        for key in asset_keys:
            target = (self.storage / key).resolve()
            if self.storage.resolve() in target.parents:
                target.unlink(missing_ok=True)
        for render_id in render_ids:
            target = self.storage.parent / "renders" / str(render_id)
            if target.resolve().parent == (self.storage.parent / "renders").resolve():
                shutil.rmtree(target, ignore_errors=True)
        return len(projects)

    @staticmethod
    def _sync_relations(connection, owner_id: UUID, project_id: UUID, document: dict):
        connection.execute(
            "DELETE FROM scenes WHERE owner_id=%s AND project_id=%s", (owner_id, project_id)
        )
        for index, scene in enumerate(document.get("scenes", [])):
            scene_key = scene["id"]
            identifier = uuid5(NAMESPACE_URL, f"motion-dna:{project_id}:scene:{scene_key}")
            connection.execute(
                """INSERT INTO scenes(id,owner_id,project_id,scene_key,position,document,updated_at)
                VALUES(%s,%s,%s,%s,%s,%s,now())""",
                (identifier, owner_id, project_id, scene_key, index, Jsonb(scene)),
            )
        storyboard = document.get("storyboard")
        if isinstance(storyboard, dict):
            connection.execute(
                """INSERT INTO storyboards(id,owner_id,project_id,document,updated_at)
                VALUES(%s,%s,%s,%s,now()) ON CONFLICT(owner_id,project_id)
                DO UPDATE SET document=excluded.document,updated_at=now()""",
                (project_id, owner_id, project_id, Jsonb(storyboard)),
            )
        else:
            connection.execute(
                "DELETE FROM storyboards WHERE owner_id=%s AND project_id=%s",
                (owner_id, project_id),
            )
        for dna_key in ("sourceDNA", "websiteDNA"):
            dna = document.get(dna_key)
            if not isinstance(dna, dict):
                continue
            digest = hashlib.sha256(
                json.dumps(dna, sort_keys=True, ensure_ascii=False).encode()
            ).hexdigest()
            raw_id = dna.get("analysis_id")
            try:
                analysis_id = (
                    UUID(str(raw_id))
                    if raw_id
                    else uuid5(NAMESPACE_URL, f"motion-dna:{project_id}:dna:{digest}")
                )
            except ValueError:
                analysis_id = uuid5(NAMESPACE_URL, f"motion-dna:{project_id}:dna:{digest}")
            connection.execute(
                """INSERT INTO dna_analyses(id,owner_id,project_id,schema_version,result)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(id)
                DO UPDATE SET result=excluded.result""",
                (
                    analysis_id,
                    owner_id,
                    project_id,
                    str(dna.get("schema_version", "1.0"))[:20],
                    Jsonb(dna),
                ),
            )


class RevisionConflict(Exception):
    def __init__(self, latest: dict):
        self.latest = latest
        super().__init__("The project changed in another session. Reload it before saving again.")


def sniff_image(data: bytes) -> str:
    """Check image container structure and bounded dimensions before storing uploads."""
    if _valid_png(data):
        return "image/png"
    if _valid_jpeg(data):
        return "image/jpeg"
    if _valid_webp(data):
        return "image/webp"
    raise DocumentError("Upload a valid PNG, JPEG, or WebP image.")


def _valid_dimensions(width: int, height: int) -> bool:
    return 0 < width <= 4096 and 0 < height <= 4096 and width * height <= 16_000_000


def _valid_png(data: bytes) -> bool:
    signature = b"\x89PNG\r\n\x1a\n"
    if len(data) < 57 or not data.startswith(signature):
        return False

    offset = len(signature)
    chunk_count = 0
    saw_header = saw_image = saw_end = False
    width = height = 0
    while offset + 12 <= len(data) and chunk_count < 1024:
        chunk_count += 1
        size = int.from_bytes(data[offset : offset + 4], "big")
        kind = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + size
        if chunk_end > len(data) or not all(65 <= byte <= 90 or 97 <= byte <= 122 for byte in kind):
            return False
        chunk = data[offset + 4 : chunk_end - 4]
        expected_crc = int.from_bytes(data[chunk_end - 4 : chunk_end], "big")
        if zlib.crc32(chunk) & 0xFFFFFFFF != expected_crc:
            return False
        if not saw_header:
            if kind != b"IHDR" or size != 13:
                return False
            width, height = struct.unpack(">II", data[offset + 8 : offset + 16])
            bit_depth, color_type = data[offset + 16], data[offset + 17]
            valid_depths = {
                0: {1, 2, 4, 8, 16},
                2: {8, 16},
                3: {1, 2, 4, 8},
                4: {8, 16},
                6: {8, 16},
            }
            if (
                not _valid_dimensions(width, height)
                or color_type not in {0, 2, 3, 4, 6}
                or bit_depth not in valid_depths[color_type]
                or data[offset + 18 : offset + 20] != b"\0\0"
                or data[offset + 20] not in {0, 1}
            ):
                return False
            saw_header = True
        elif kind == b"IHDR":
            return False
        if kind == b"IDAT":
            if saw_end:
                return False
            saw_image = True
        elif kind == b"IEND":
            if size != 0 or not saw_image or chunk_end != len(data):
                return False
            saw_end = True
            break
        offset = chunk_end
    return saw_header and saw_image and saw_end


def _valid_jpeg(data: bytes) -> bool:
    if len(data) < 20 or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        return False
    offset = 2
    dimensions = None
    saw_scan = False
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset < len(data) - 2:
        if data[offset] != 0xFF:
            return False
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            return False
        marker = data[offset]
        offset += 1
        if marker == 0xD9:
            return saw_scan and dimensions is not None and offset == len(data)
        if marker == 0x00 or marker == 0xD8 or 0xD0 <= marker <= 0xD7:
            return False
        if marker == 0x01:
            continue
        if offset + 2 > len(data):
            return False
        size = int.from_bytes(data[offset : offset + 2], "big")
        if size < 2 or offset + size > len(data):
            return False
        payload = data[offset + 2 : offset + size]
        if marker in sof_markers:
            if len(payload) < 6:
                return False
            height, width = struct.unpack(">HH", payload[1:5])
            if not _valid_dimensions(width, height):
                return False
            dimensions = (width, height)
        offset += size
        if marker == 0xDA:
            saw_scan = True
            while offset < len(data) - 1:
                if data[offset] != 0xFF:
                    offset += 1
                    continue
                marker_offset = offset
                offset += 1
                while offset < len(data) and data[offset] == 0xFF:
                    offset += 1
                if offset >= len(data):
                    return False
                next_marker = data[offset]
                if next_marker == 0x00 or 0xD0 <= next_marker <= 0xD7:
                    offset += 1
                    continue
                offset = marker_offset
                break
    return False


def _valid_webp(data: bytes) -> bool:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return False
    if int.from_bytes(data[4:8], "little") != len(data) - 8:
        return False
    offset = 12
    dimensions = None
    saw_pixels = False
    while offset + 8 <= len(data):
        kind = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        start, end = offset + 8, offset + 8 + size
        padded_end = end + (size & 1)
        if end > len(data) or padded_end > len(data):
            return False
        chunk = data[start:end]
        if kind == b"VP8X" and len(chunk) >= 10:
            width = int.from_bytes(chunk[4:7], "little") + 1
            height = int.from_bytes(chunk[7:10], "little") + 1
            dimensions = (width, height)
        elif kind == b"VP8L" and len(chunk) >= 5 and chunk[0] == 0x2F:
            bits = int.from_bytes(chunk[1:5], "little")
            dimensions = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
            saw_pixels = True
        elif kind == b"VP8 " and len(chunk) >= 10 and chunk[3:6] == b"\x9d\x01\x2a":
            dimensions = (
                int.from_bytes(chunk[6:8], "little") & 0x3FFF,
                int.from_bytes(chunk[8:10], "little") & 0x3FFF,
            )
            saw_pixels = True
        offset = padded_end
    return (
        offset == len(data)
        and dimensions is not None
        and saw_pixels
        and _valid_dimensions(*dimensions)
    )
