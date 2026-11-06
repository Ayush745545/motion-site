"""PostgreSQL-backed, fenced local renderer with bounded subprocess supervision."""

import hashlib
import json
import logging
import math
import os
import selectors
import shutil
import signal
import subprocess
import threading
import time
from fractions import Fraction
from pathlib import Path
from uuid import UUID, uuid4

from motion_dna_api.config import ROOT_ENV, Settings
from motion_dna_api.logging import configure_logging

from .models import OutputMetadata, RenderRequest
from .repository import RenderQuotaExceeded, Repository

logger = logging.getLogger("motion_dna_api.render_worker")
MAX_LOG_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 512 * 1024 * 1024
WALL_TIMEOUT = 600


class AttemptFailure(Exception):
    def __init__(self, code, message, *, retryable=False, exit_code=None):
        super().__init__(message)
        self.code, self.retryable, self.exit_code = code, retryable, exit_code


class RenderCancelled(Exception):
    pass


class LeaseLost(Exception):
    pass


def child_limits():
    """Apply Unix process limits to Node and its Chromium/FFmpeg descendants."""
    import resource

    for kind, maximum in (
        (resource.RLIMIT_NOFILE, 512),
        (resource.RLIMIT_FSIZE, MAX_OUTPUT_BYTES),
        (resource.RLIMIT_CPU, WALL_TIMEOUT),
    ):
        _, hard = resource.getrlimit(kind)
        bounded = maximum if hard == resource.RLIM_INFINITY else min(maximum, hard)
        resource.setrlimit(kind, (bounded, bounded))


def stop_process(process, grace=3):
    """Terminate the isolated process group, including browser/encoder descendants."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    # Node may have exited before all of its descendants. Clean the whole group.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if process.poll() is None:
        process.wait(timeout=3)


def _probe(command, check):
    if check is None:
        return subprocess.run(
            command, stdin=subprocess.DEVNULL, capture_output=True, timeout=30, check=True
        )
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    started = time.monotonic()
    try:
        while True:
            check()
            if time.monotonic() - started > 30:
                raise subprocess.TimeoutExpired(command, 30)
            try:
                output, _ = process.communicate(timeout=0.5)
                if process.returncode:
                    raise subprocess.CalledProcessError(process.returncode, command)
                return subprocess.CompletedProcess(command, process.returncode, output)
            except subprocess.TimeoutExpired:
                continue
    finally:
        stop_process(process, grace=0.1)


def verify_video(file: Path, request: RenderRequest, ffprobe: str, check=None):
    """Inspect actual decoded output; renderer-reported metadata is not sufficient."""
    try:
        result = _probe(
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration:format=duration",
                "-of",
                "json",
                str(file),
            ],
            check,
        )
        if len(result.stdout) > 65536:
            raise ValueError("Oversized FFprobe output")
        data = json.loads(result.stdout)
        stream = data["streams"][0]
        width, height = request.output.dimensions
        frames = int(stream["nb_read_frames"])
        duration = float(stream.get("duration", data.get("format", {}).get("duration", 0)))
        size = file.stat().st_size
        if (
            stream["codec_name"] != "h264"
            or stream["width"] != width
            or stream["height"] != height
            or Fraction(stream["r_frame_rate"]) != request.output.fps
            or frames != request.expected_frames
            or not math.isfinite(duration)
            or abs(duration - frames / request.output.fps) > 1 / request.output.fps + 0.002
            or not 0 < size <= MAX_OUTPUT_BYTES
        ):
            raise ValueError("Encoded output does not match the requested export")
        return OutputMetadata(
            width=width,
            height=height,
            fps=request.output.fps,
            frames=frames,
            duration=duration,
            codec="h264",
            bytes=size,
        )
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError) as error:
        raise AttemptFailure(
            "invalid_output", "The encoded file did not pass video verification."
        ) from error


class BoundedLog:
    def __init__(self, path):
        self.file = path.open("wb")
        self.size, self.truncated = 0, False

    def write(self, data):
        remaining = MAX_LOG_BYTES - self.size
        if remaining > 0:
            chunk = data[:remaining]
            self.file.write(chunk)
            self.file.flush()
            self.size += len(chunk)
        if len(data) > max(remaining, 0) and not self.truncated:
            # Keep the entire file bounded, including this notice.
            notice = b"\n[render log truncated at 2 MB]\n"
            self.file.seek(max(0, MAX_LOG_BYTES - len(notice)))
            self.file.write(notice)
            self.file.truncate(MAX_LOG_BYTES)
            self.truncated = True

    def close(self):
        self.file.close()


class RenderWorker:
    def __init__(
        self,
        repository,
        workspace,
        *,
        node=None,
        ffprobe=None,
        stop=None,
        poll_seconds=0.2,
        heartbeat_seconds=1.5,
        timeout=WALL_TIMEOUT,
    ):
        self.repository = repository
        self.workspace = Path(workspace).resolve()
        self.storage = Path(getattr(repository, "storage", self.workspace / "storage" / "renders"))
        self.node, self.ffprobe = node or shutil.which("node"), ffprobe or shutil.which("ffprobe")
        self.stop = stop or threading.Event()
        self.poll_seconds, self.heartbeat_seconds, self.timeout = (
            poll_seconds,
            heartbeat_seconds,
            timeout,
        )
        self.worker_id = f"local-{os.getpid()}-{uuid4().hex}"

    def run_once(self):
        claim = self.repository.claim(self.worker_id)
        if claim is None:
            return False
        self.run_claim(claim)
        return True

    def run_claim(self, claim):
        job, request, token = claim.job, claim.request, claim.token
        job_id = str(UUID(str(job.id)))
        directory = self.storage / job_id
        process = None
        temporary = directory / f"temporary-{token}"
        log = None
        try:
            if directory.is_symlink():
                raise AttemptFailure("invalid_storage", "The job storage directory is invalid.")
            directory.mkdir(parents=True, exist_ok=True)
            for stale in directory.glob("temporary-*"):
                if stale != temporary and stale.is_dir() and not stale.is_symlink():
                    shutil.rmtree(stale, ignore_errors=True)
            temporary.mkdir(mode=0o700)
            if not self.node or not self.ffprobe:
                raise AttemptFailure(
                    "runtime_unavailable", "Install Node.js and FFmpeg before rendering."
                )
            input_path = directory / "input.json"
            encoded = json.dumps(request.model_dump(mode="json"), sort_keys=True).encode()
            staged_input = temporary / "input.json"
            staged_input.write_bytes(encoded)
            staged_input.chmod(0o600)
            staged_input.replace(input_path)
            output = temporary / "video.mp4"
            metadata_path = temporary / "metadata.json"
            log = BoundedLog(directory / f"attempt-{job.attempt}.log")
            log.write(
                json.dumps(
                    {"event": "render_attempt", "job_id": job_id, "attempt": job.attempt}
                ).encode()
                + b"\n"
            )
            if self.repository.cancellation_requested(job.id, token):
                raise RenderCancelled
            command = [
                self.node,
                "--max-old-space-size=1024",
                "--import",
                "tsx",
                str(self.workspace / "packages" / "motion-engine" / "scripts" / "render.ts"),
                "--request-file",
                str(input_path),
                "--output",
                str(output),
                "--metadata",
                str(metadata_path),
            ]
            environment = {
                **os.environ,
                "TMPDIR": str(temporary),
                "TMP": str(temporary),
                "TEMP": str(temporary),
                "MOTION_RENDER_PARENT_PID": str(os.getpid()),
            }
            process = subprocess.Popen(
                command,
                cwd=self.workspace / "packages" / "motion-engine",
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=environment,
                preexec_fn=child_limits if os.name == "posix" else None,
            )
            self.supervise(process, job, token, log)
            if process.returncode != 0:
                invalid = process.returncode == 2
                raise AttemptFailure(
                    "invalid_input" if invalid else "renderer_exit",
                    "The composition failed validation."
                    if invalid
                    else "The local renderer exited before completing the export.",
                    retryable=not invalid,
                    exit_code=process.returncode,
                )
            if self.repository.cancellation_requested(job.id, token):
                raise RenderCancelled
            metadata = verify_video(
                output, request, self.ffprobe, check=lambda: self.check_lease(job, token)
            )
            reported_bytes = metadata_path.read_bytes()
            if len(reported_bytes) > 65536:
                raise AttemptFailure("invalid_output", "The renderer metadata was inconsistent.")
            try:
                reported = OutputMetadata.model_validate_json(reported_bytes)
                for key, value in metadata.model_dump().items():
                    received = getattr(reported, key)
                    if abs(received - value) > 0.002 if key == "duration" else received != value:
                        raise ValueError("Metadata mismatch")
            except (ValueError, TypeError) as error:
                raise AttemptFailure(
                    "invalid_output", "The renderer metadata was inconsistent."
                ) from error
            artifact = {
                **metadata.model_dump(mode="json"),
                "job_id": job_id,
                "project_id": str(job.project_id),
                "request_sha256": hashlib.sha256(encoded).hexdigest(),
            }
            metadata_path.write_text(json.dumps(artifact))

            def publish():
                output.replace(directory / "video.mp4")
                metadata_path.replace(directory / "metadata.json")

            if not self.repository.finish(job.id, token, metadata, publish=publish):
                self.repository.cancel_complete(job.id, token)
            logger.info("render_attempt_completed")
        except RenderCancelled:
            if process is not None:
                stop_process(process)
            if log is not None:
                log.write(
                    json.dumps(
                        {
                            "event": "render_attempt_cancelled",
                            "exit_code": process.returncode if process else None,
                        }
                    ).encode()
                    + b"\n"
                )
            self.repository.cancel_complete(job.id, token)
            logger.info("render_attempt_cancelled")
        except LeaseLost:
            if process is not None:
                stop_process(process)
            logger.warning("render_lease_lost")
        except Exception as error:
            if process is not None:
                stop_process(process)
            if isinstance(error, AttemptFailure):
                failure = error
            elif isinstance(error, RenderQuotaExceeded):
                failure = AttemptFailure("storage_quota", str(error), retryable=False)
            else:
                failure = AttemptFailure(
                    "worker_error",
                    "The render worker could not complete this attempt.",
                    retryable=True,
                )
            if failure.exit_code is None and process is not None:
                failure.exit_code = process.returncode
            if log is not None:
                log.write(
                    json.dumps(
                        {
                            "event": "render_attempt_failed",
                            "code": failure.code,
                            "error_type": type(error).__name__,
                            "exit_code": failure.exit_code,
                        }
                    ).encode()
                    + b"\n"
                )
            self.repository.fail(
                job.id,
                token,
                failure.code,
                str(failure),
                retryable=failure.retryable,
                exit_code=failure.exit_code,
            )
            logger.warning("render_attempt_failed", extra={"error_type": type(error).__name__})
        finally:
            if process is not None:
                stop_process(process, grace=0.1)
                if process.stdout is not None:
                    process.stdout.close()
            if log is not None:
                log.close()
            if temporary.is_dir() and not temporary.is_symlink():
                shutil.rmtree(temporary, ignore_errors=True)

    def supervise(self, process, job, token, log):
        started, heartbeat = time.monotonic(), 0.0
        pending = b""
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        try:
            while True:
                now = time.monotonic()
                if self.stop.is_set():
                    raise AttemptFailure(
                        "worker_interrupted",
                        "The worker stopped before the export completed.",
                        retryable=True,
                    )
                if now - started > self.timeout:
                    raise AttemptFailure(
                        "render_timeout",
                        "Rendering exceeded the ten-minute time limit.",
                        retryable=True,
                    )
                if now - heartbeat >= self.heartbeat_seconds:
                    try:
                        retained = self.repository.heartbeat(job.id, token)
                    except Exception as error:
                        raise LeaseLost from error
                    if not retained:
                        raise LeaseLost
                    heartbeat = now
                if self.repository.cancellation_requested(job.id, token):
                    raise RenderCancelled
                for key, _ in selector.select(self.poll_seconds):
                    chunk = os.read(key.fileobj.fileno(), 16384)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    log.write(chunk)
                    pending += chunk
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        self.progress(line, job, token)
                    if len(pending) > 65536:
                        pending = b""
                if process.poll() is not None and not selector.get_map():
                    if pending:
                        self.progress(pending, job, token)
                    return
        finally:
            selector.close()

    def check_lease(self, job, token):
        if self.stop.is_set():
            raise AttemptFailure(
                "worker_interrupted",
                "The worker stopped before the export completed.",
                retryable=True,
            )
        try:
            retained = self.repository.heartbeat(job.id, token)
        except Exception as error:
            raise LeaseLost from error
        if not retained:
            raise LeaseLost
        if self.repository.cancellation_requested(job.id, token):
            raise RenderCancelled

    def progress(self, line, job, token):
        try:
            event = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            return
        if not isinstance(event, dict) or event.get("event") != "render_progress":
            return
        percent = event.get("percent")
        if (
            type(percent) not in (int, float)
            or not math.isfinite(percent)
            or not 0 <= percent <= 100
        ):
            return
        if not self.repository.heartbeat(
            job.id, token, progress=min(99, percent), stage="Rendering and encoding"
        ):
            raise LeaseLost


def main():
    settings = Settings()
    configure_logging(settings.log_level)
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda _signal, _frame: stop.set())
    repository = Repository(settings)
    worker = RenderWorker(repository, ROOT_ENV.parent, stop=stop)
    logger.info("render_worker_started")
    while not stop.is_set():
        try:
            repository.recover_expired()
            if not worker.run_once():
                stop.wait(1)
        except Exception as error:
            logger.warning("render_worker_unavailable", extra={"error_type": type(error).__name__})
            stop.wait(3)
    logger.info("render_worker_stopped")


if __name__ == "__main__":
    main()
