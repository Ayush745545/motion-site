import asyncio
import socket

import pytest

from motion_dna_api.dna.security import (
    AnalysisError,
    PinnedResolver,
    parse_url,
    public_ip,
    resolve_public,
)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "ftp://example.com",
        "http://localhost",
        "http://foo.localhost",
        "http://metadata.google.internal",
        "http://user:pass@example.com",
        "http://example.com:22",
        "http://example.com\\@127.0.0.1",
        "http://example.com\n",
        "http://[fe80::1%25en0]/",
        "http://%31%32%37.0.0.1",
        "http://example.com:bad",
    ],
)
def test_reject_invalid_syntax(url):
    with pytest.raises(AnalysisError):
        parse_url(url)


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.0.1",
        "169.254.169.254",
        "100.100.100.200",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "64:ff9b::7f00:1",
        "2002:7f00:1::",
        "192.0.2.1",
    ],
)
def test_nonpublic_addresses_blocked(ip):
    assert not public_ip(ip)


def test_public_addresses_allowed():
    assert public_ip("93.184.216.34")
    assert public_ip("2606:4700:4700::1111")
    assert parse_url("https://example.com/path#secret") == "https://example.com/path"


def test_mixed_dns_and_rebinding_rejected(monkeypatch):
    async def run():
        loop = asyncio.get_running_loop()
        responses = [["93.184.216.34"], ["93.184.216.34", "127.0.0.1"], ["169.254.169.254"]]

        async def resolve(*args, **kwargs):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80)) for ip in responses.pop(0)
            ]

        monkeypatch.setattr(loop, "getaddrinfo", resolve)
        host, port, addresses = await resolve_public("http://example.com")
        resolver = PinnedResolver(host, addresses)
        # Connector gets the approved address without a second OS DNS lookup.
        assert (await resolver.resolve(host, port))[0]["host"] == "93.184.216.34"
        with pytest.raises(OSError):
            await resolver.resolve("different.example")
        for _ in range(2):
            with pytest.raises(AnalysisError, match="non-public"):
                await resolve_public("http://example.com")

    asyncio.run(run())


def test_numeric_and_metadata_hosts_rejected():
    async def run():
        for url in [
            "http://127.0.0.1",
            "http://2130706433",
            "http://0x7f000001",
            "http://169.254.169.254/latest/meta-data",
        ]:
            with pytest.raises(AnalysisError):
                await resolve_public(url)

    asyncio.run(run())
