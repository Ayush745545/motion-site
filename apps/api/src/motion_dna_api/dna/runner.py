"""Launch only a locked-down image; there is deliberately no host-browser fallback."""

import asyncio
import base64
import json
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

from .models import DNAResult
from .security import AnalysisError, Broker


def reference(url):
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


async def run_analysis(url, analysis_id, image, timeout=50):
    name = f"motion-dna-{analysis_id}"
    process = None
    broker = Broker()
    try:
        async with asyncio.timeout(timeout):
            process = await asyncio.create_subprocess_exec(
                "docker",
                "run",
                "--rm",
                "-i",
                "--name",
                name,
                "--pull=never",
                "--network=none",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--memory=768m",
                "--memory-swap=768m",
                "--cpus=1",
                "--pids-limit=128",
                "--user=1000:1000",
                "--tmpfs=/tmp:rw,nosuid,nodev,size=256m",
                "--shm-size=128m",
                "--log-driver=none",
                image,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                limit=4 * 1024 * 1024,
            )
            process.stdin.write(json.dumps({"url": url}).encode() + b"\n")
            await process.stdin.drain()
            while line := await process.stdout.readline():
                message = json.loads(line)
                if message.get("type") == "fetch":
                    try:
                        response = await broker.fetch(message["url"])
                    except AnalysisError as exc:
                        broker.blocked += 1
                        response = {"error": exc.message}
                    except Exception:
                        broker.blocked += 1
                        response = {"error": "A resource timed out or could not be downloaded."}
                    process.stdin.write(json.dumps(response).encode() + b"\n")
                    await process.stdin.drain()
                elif message.get("type") == "error":
                    raise AnalysisError("capture_failed", message.get("message", "Capture failed."))
                elif message.get("type") == "result":
                    screenshot = base64.b64decode(message["screenshots"]["viewport"], validate=True)
                    if len(screenshot) > 2 * 1024 * 1024 or not screenshot.startswith(
                        b"\x89PNG\r\n\x1a\n"
                    ):
                        raise AnalysisError(
                            "resource_limit", "The screenshot exceeded capture limits."
                        )
                    data = message["data"]
                    data["final_url"] = reference(data["final_url"])
                    if broker.blocked:
                        data["confidence"] = min(data["confidence"], 0.5)
                    result = DNAResult.model_validate(
                        {
                            **data,
                            "analysis_id": analysis_id,
                            "source_url": reference(url),
                            "captured_at": datetime.now(UTC),
                            "screenshots": [
                                {
                                    "kind": "viewport",
                                    "width": 1440,
                                    "height": 900,
                                    "path": f"/api/dna/results/{analysis_id}/screenshots/viewport",
                                }
                            ],
                        }
                    )
                    return result, screenshot
            raise AnalysisError("browser_unavailable", "Start Docker and run pnpm setup:analyzer.")
    except TimeoutError:
        raise AnalysisError("timeout", "Analysis exceeded its 50-second time limit.") from None
    except FileNotFoundError:
        raise AnalysisError(
            "browser_unavailable", "Docker is required for isolated website analysis."
        ) from None
    finally:
        if process:
            # Killing the CLI alone does not guarantee container termination.
            try:
                cleanup = await asyncio.create_subprocess_exec(
                    "docker",
                    "rm",
                    "-f",
                    name,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(cleanup.wait(), 5)
            except (OSError, TimeoutError):
                pass
            if process.returncode is None:
                process.kill()
            await process.wait()
