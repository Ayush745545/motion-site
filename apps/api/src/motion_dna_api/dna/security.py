"""Public-only HTTP broker. Chromium never owns an outbound network connection."""

import asyncio
import base64
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import aiohttp


class AnalysisError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def parse_url(value: str) -> str:
    try:
        url = urlsplit(value)
        if (
            len(value) > 2048
            or any(ord(char) < 33 for char in value)
            or "\\" in value
            or url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.port not in {None, 80, 443}
            or "%" in url.netloc
        ):
            raise ValueError
        hostname = url.hostname.encode("idna").decode().rstrip(".").lower()
        if (
            ("." not in hostname and ":" not in hostname)
            or hostname.endswith((".localhost", ".local", ".internal", ".home", ".test"))
            or hostname in {"metadata.google.internal", "metadata.google", "instance-data"}
        ):
            raise ValueError
        return urlunsplit((url.scheme, url.netloc, url.path or "/", url.query, ""))
    except (ValueError, UnicodeError):
        raise AnalysisError("unsafe_url", "Use a public HTTP(S) URL on port 80 or 443.") from None


def public_ip(value: str) -> bool:
    ip = ipaddress.ip_address(value)
    return (
        ip.is_global
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
        and not (
            isinstance(ip, ipaddress.IPv6Address) and (ip.ipv4_mapped or ip.sixtofour or ip.teredo)
        )
        and ip not in ipaddress.ip_network("64:ff9b::/96")
        and ip not in ipaddress.ip_network("64:ff9b:1::/48")
    )


async def resolve_public(url: str) -> tuple[str, int, list[str]]:
    parsed = urlsplit(parse_url(url))
    host = parsed.hostname.encode("idna").decode().rstrip(".")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 3
        )
    except (OSError, TimeoutError):
        raise AnalysisError("dns_failed", "The website hostname could not be resolved.") from None
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses or not all(public_ip(address) for address in addresses):
        raise AnalysisError("unsafe_url", "Internal and non-public network addresses are blocked.")
    return host, port, addresses


class PinnedResolver(aiohttp.abc.AbstractResolver):
    def __init__(self, host: str, addresses: list[str]):
        self.host, self.addresses = host, addresses

    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        if host.rstrip(".") != self.host:
            raise OSError("Unexpected hostname")
        return [
            {
                "hostname": host,
                "host": ip,
                "port": port,
                "family": socket.AF_INET6 if ":" in ip else socket.AF_INET,
                "proto": socket.IPPROTO_TCP,
                "flags": socket.AI_NUMERICHOST,
            }
            for ip in self.addresses
        ]

    async def close(self):
        pass


class Broker:
    max_resource = 2 * 1024 * 1024
    max_total = 20 * 1024 * 1024
    max_requests = 100

    def __init__(self):
        self.total = 0
        self.requests = 0
        self.blocked = 0

    async def fetch(self, url: str) -> dict:
        # Fresh resolution for every hop; the connector uses only those exact IPs.
        for _ in range(6):
            self.requests += 1
            if self.requests > self.max_requests:
                raise AnalysisError("resource_limit", "The page exceeded the request limit.")
            url = parse_url(url)
            host, port, addresses = await resolve_public(url)
            connector = aiohttp.TCPConnector(
                resolver=PinnedResolver(host, addresses), use_dns_cache=False, limit=1
            )
            async with aiohttp.ClientSession(
                connector=connector,
                trust_env=False,
                cookie_jar=aiohttp.DummyCookieJar(),
                auto_decompress=False,
                timeout=aiohttp.ClientTimeout(total=8),
                headers={
                    "User-Agent": "MotionDNA/0.1 public-page-analysis",
                    "Accept-Encoding": "identity",
                },
            ) as client:
                async with client.get(url, allow_redirects=False) as response:
                    if response.status in {301, 302, 303, 307, 308}:
                        url = urljoin(url, response.headers.get("Location", ""))
                        continue
                    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                        raise AnalysisError(
                            "encoded_resource", "Compressed responses are not accepted."
                        )
                    if response.content_length and response.content_length > self.max_resource:
                        raise AnalysisError("resource_limit", "A page resource exceeds 2 MB.")
                    chunks, size = [], 0
                    async for chunk in response.content.iter_chunked(32768):
                        size += len(chunk)
                        self.total += len(chunk)
                        if size > self.max_resource or self.total > self.max_total:
                            raise AnalysisError(
                                "resource_limit", "The page exceeded download limits."
                            )
                        chunks.append(chunk)
                    # Never forward Set-Cookie, authentication or arbitrary response headers.
                    return {
                        "status": response.status,
                        "url": url,
                        "headers": {
                            "content-type": response.headers.get(
                                "Content-Type", "application/octet-stream"
                            )
                        },
                        "body": base64.b64encode(b"".join(chunks)).decode(),
                    }
        raise AnalysisError("redirect_limit", "The website redirected too many times.")
