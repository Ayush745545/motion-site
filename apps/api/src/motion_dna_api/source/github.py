"""Fetch public GitHub project archives through pinned, allowlisted HTTPS endpoints."""

import asyncio
import json
import re
from urllib.parse import quote, urlsplit

import aiohttp

from motion_dna_api.dna.security import PinnedResolver, resolve_public

from .archive import MAX_ARCHIVE_BYTES, SourceInputError

GITHUB_API = "api.github.com"
GITHUB_CDN = "codeload.github.com"
OWNER_REPO = re.compile(r"^/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(?:\.git)?/?$")


def parse_github_url(value: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(value.strip())
        if (
            parsed.scheme != "https"
            or parsed.hostname != "github.com"
            or parsed.port not in (None, 443)
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError
        match = OWNER_REPO.fullmatch(parsed.path)
        if not match:
            raise ValueError
        owner, repository = match.groups()
        if owner in {".", ".."} or repository in {".", ".."}:
            raise ValueError
        return owner, repository.removesuffix(".git")
    except ValueError:
        raise SourceInputError(
            "Enter a public GitHub repository URL such as https://github.com/owner/repo."
        ) from None


async def _get(
    url: str, max_bytes: int, allowed_hosts: set[str]
) -> tuple[int, bytes, str | None, str]:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if (
        parsed.scheme != "https"
        or host not in allowed_hosts
        or parsed.port not in (None, 443)
        or parsed.username
        or parsed.password
    ):
        raise SourceInputError("The GitHub download URL is outside the allowlist.")
    _, _, addresses = await resolve_public(url)
    connector = aiohttp.TCPConnector(
        resolver=PinnedResolver(host, addresses), use_dns_cache=False, limit=1
    )
    try:
        async with aiohttp.ClientSession(
            connector=connector,
            trust_env=False,
            cookie_jar=aiohttp.DummyCookieJar(),
            auto_decompress=False,
            timeout=aiohttp.ClientTimeout(total=12, connect=4, sock_read=8),
            headers={
                "Accept": "application/vnd.github+json, application/zip",
                "Accept-Encoding": "identity",
                "User-Agent": "MotionDNA-static-source-analyzer/1.0",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        ) as client:
            async with client.get(url, allow_redirects=False) as response:
                location = response.headers.get("Location")
                if response.status in {301, 302, 303, 307, 308}:
                    return response.status, b"", location, response.headers.get("Content-Type", "")
                if response.content_length and response.content_length > max_bytes:
                    raise SourceInputError(
                        "The public repository archive exceeds the 20 MB download limit."
                    )
                chunks = bytearray()
                async for chunk in response.content.iter_chunked(32 * 1024):
                    chunks.extend(chunk)
                    if len(chunks) > max_bytes:
                        raise SourceInputError(
                            "The public repository archive exceeds the 20 MB download limit."
                        )
                return (
                    response.status,
                    bytes(chunks),
                    None,
                    response.headers.get("Content-Type", ""),
                )
    except (aiohttp.ClientError, TimeoutError, OSError):
        raise SourceInputError(
            "GitHub could not be reached safely. Check the repository URL and retry."
        ) from None


async def download_github_archive(value: str) -> tuple[bytes, str]:
    owner, repository = parse_github_url(value)
    metadata_url = (
        f"https://{GITHUB_API}/repos/{quote(owner, safe='')}/{quote(repository, safe='')}"
    )
    status, body, location, _ = await _get(metadata_url, 128 * 1024, {GITHUB_API})
    if status != 200 or location:
        if status in {403, 429}:
            raise SourceInputError(
                "GitHub rate-limited this request. Try again later or upload a ZIP archive."
            )
        raise SourceInputError("The GitHub repository was not found or is not publicly accessible.")
    try:
        metadata = json.loads(body)
        branch = metadata["default_branch"]
        full_name = metadata["full_name"]
    except (ValueError, KeyError, TypeError):
        raise SourceInputError("GitHub returned invalid repository metadata.") from None
    if (
        not isinstance(branch, str)
        or not branch
        or len(branch) > 200
        or ".." in branch.split("/")
        or not isinstance(full_name, str)
    ):
        raise SourceInputError("GitHub returned an unsupported default branch name.")
    archive_path = f"{quote(owner, safe='')}/{quote(repository, safe='')}/zip/refs/heads/"
    archive_url = f"https://{GITHUB_CDN}/{archive_path}{quote(branch, safe='/-._')}"
    status, archive, location, _ = await _get(archive_url, MAX_ARCHIVE_BYTES, {GITHUB_CDN})
    if status != 200 or location:
        raise SourceInputError("The public GitHub source archive could not be downloaded.")
    if not archive.startswith(b"PK\x03\x04"):
        raise SourceInputError("GitHub did not return a valid ZIP project archive.")
    return archive, full_name[:180]


async def download_with_timeout(value: str):
    try:
        async with asyncio.timeout(25):
            return await download_github_archive(value)
    except TimeoutError:
        raise SourceInputError("The GitHub download exceeded its 25-second time limit.") from None
