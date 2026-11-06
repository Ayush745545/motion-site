import { describe, expect, it } from "vitest";
import { validateRasterDataURL } from "../src/lib/server/image-data";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aob8AAAAASUVORK5CYII=";
const asData = (kind: string, bytes: Buffer) => `data:image/${kind};base64,${bytes.toString("base64")}`;

describe("timeline raster assets", () => {
  it("accepts a bounded local PNG without fetching any URL", () => {
    expect(() => validateRasterDataURL(png)).not.toThrow();
    expect(() => validateRasterDataURL("https://example.com/image.png")).toThrow("valid local image");
    expect(() => validateRasterDataURL("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toThrow("valid local image");
  });
  it("rejects image type mismatches, corrupt headers and oversized dimensions", () => {
    expect(() => validateRasterDataURL(png.replace("image/png", "image/jpeg"))).toThrow();
    expect(() => validateRasterDataURL(asData("png", Buffer.from("not an image")))).toThrow();
    const bytes = Buffer.from(png.split(",")[1]!, "base64");
    bytes.writeUInt32BE(4097, 16);
    expect(() => validateRasterDataURL(asData("png", bytes))).toThrow("4096");
    expect(() => validateRasterDataURL(asData("png", Buffer.alloc(2 * 1024 * 1024 + 1)))).toThrow("2 MB");
  });
  it("bounds JPEG and WebP dimensions before the render browser decodes them", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 100, 0, 100, 1]);
    expect(() => validateRasterDataURL(asData("jpeg", jpeg))).not.toThrow();
    jpeg.writeUInt16BE(5000, 9);
    expect(() => validateRasterDataURL(asData("jpeg", jpeg))).toThrow("4096");
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0); webp.write("WEBP", 8); webp.write("VP8X", 12);
    webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(99, 27, 3);
    expect(() => validateRasterDataURL(asData("webp", webp))).not.toThrow();
    webp.writeUIntLE(5000, 24, 3);
    expect(() => validateRasterDataURL(asData("webp", webp))).toThrow("4096");
  });
});
