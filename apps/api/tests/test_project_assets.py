"""Validation checks for private image uploads."""

import struct
import zlib

import pytest

from motion_dna_api.projects.repository import DocumentError, sniff_image


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    body = kind + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


PNG_1X1 = (
    b"\x89PNG\r\n\x1a\n"
    + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    + png_chunk(b"IDAT", zlib.compress(b"\0\0\0\0\0"))
    + png_chunk(b"IEND", b"")
)


def test_upload_validator_accepts_complete_png_and_rejects_truncated_or_corrupt_files():
    assert sniff_image(PNG_1X1) == "image/png"
    with pytest.raises(DocumentError, match="valid PNG"):
        sniff_image(PNG_1X1[:24])
    corrupted = bytearray(PNG_1X1)
    corrupted[16] = 2
    with pytest.raises(DocumentError, match="valid PNG"):
        sniff_image(bytes(corrupted))
    with pytest.raises(DocumentError, match="valid PNG"):
        sniff_image(b"\x89PNG\r\n\x1a\n" + b"not-a-png")
