/** Bound decoded images before passing user assets to the render browser. */
export function validateRasterDataURL(source: string): void {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match) throw new Error("Use a valid local image (PNG, JPEG or WebP).");
  const data = Buffer.from(match[2]!, "base64");
  if (data.length > 2 * 1024 * 1024) throw new Error("Use a valid local image up to 2 MB.");
  let width = 0, height = 0;
  if (match[1] === "png" && data.length >= 33 && data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && data.toString("ascii", 12, 16) === "IHDR") {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (match[1] === "jpeg" && data.length >= 4 && data.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 0xff) break;
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > data.length) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  } else if (match[1] === "webp" && data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    const kind = data.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1;
    } else if (kind === "VP8L" && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21);
      width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (kind === "VP8 " && data.subarray(23, 26).toString("hex") === "9d012a") {
      width = data.readUInt16LE(26) & 0x3fff; height = data.readUInt16LE(28) & 0x3fff;
    }
  }
  if (!width || !height || width > 4096 || height > 4096) throw new Error("Use a valid local image up to 4096 pixels per side.");
}
