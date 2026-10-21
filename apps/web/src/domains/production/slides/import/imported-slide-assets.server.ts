import { createHash } from "node:crypto";
import { load } from "cheerio";
import { IMPORTED_SLIDE_ASSET_LIMITS, importedSlideAssetsSchema, type ImportedSlideAsset } from "./imported-slide-assets.contract";
import { HtmlSlideImportError } from "./imported-slide-design.contract";

function reject(): never { throw new HtmlSlideImportError("Una imagen o fuente embebida no supera la validación de seguridad."); }
function dimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || width > IMPORTED_SLIDE_ASSET_LIMITS.pixels || height > IMPORTED_SLIDE_ASSET_LIMITS.pixels) reject();
  return width * height;
}

function assertSafeSvg(bytes: Buffer) {
  if (bytes.length > 100_000) reject();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!|<\?|\\|\bon\w+\s*=/i.test(text)) reject();
  const document = load(text, { xml: true }, false);
  if (document.root().children().length !== 1 || document.root().children().first()[0]?.name !== "svg") reject();
  const tags = new Set(["svg", "defs", "linearGradient", "radialGradient", "stop", "rect", "path", "circle", "ellipse", "g"]);
  const attributes = new Set(["xmlns", "width", "height", "viewBox", "id", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "fill", "opacity", "fill-opacity", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "transform", "d"]);
  const ids = new Set(document("[id]").map((_index, node) => document(node).attr("id")!).get());
  const root = document.root().children().first();
  const viewport = (root.attr("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = Number(root.attr("width") ?? viewport[2]);
  const height = Number(root.attr("height") ?? viewport[3]);
  if (![width, height].every(Number.isFinite)) reject();
  const pixels = dimensions(width, height);
  if (document("*").length > 512) reject();
  document("*").each((_index, node) => {
    if (!("name" in node) || !("attribs" in node) || !tags.has(node.name)) reject();
    for (const [key, value] of Object.entries(node.attribs)) {
      if (!attributes.has(key)) reject();
      if (["transform", "gradientTransform"].includes(key)) reject();
      if (key === "xmlns") { if (value !== "http://www.w3.org/2000/svg") reject(); continue; }
      if (/(?:https?:|data:|javascript:)/i.test(value)) reject();
      if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(value)) reject();
      const reference = /^url\(#([^)]*)\)$/.exec(value);
      if (reference && !ids.has(reference[1])) reject();
    }
  });
  return pixels;
}

export function assertImportedAssetBinary(asset: ImportedSlideAsset, bytes: Buffer) {
  let pixels = 0;
  if (!bytes.length || bytes.length > IMPORTED_SLIDE_ASSET_LIMITS.bytes) reject();
  if (asset.mimeType === "image/png") {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR") reject();
    pixels = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  } else if (asset.mimeType === "image/jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) reject();
    let found = false;
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) reject();
      const marker = bytes[offset + 1];
      if (marker === 0xda) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > bytes.length) reject();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) { pixels = dimensions(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)); found = true; break; }
      offset += length + 2;
    }
    if (!found) reject();
  } else if (asset.mimeType === "image/webp") {
    if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 16) !== "WEBPVP8X" || bytes.readUInt32LE(4) + 8 !== bytes.length) reject();
    pixels = dimensions(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
  } else if (asset.mimeType === "image/svg+xml") pixels = assertSafeSvg(bytes);
  else if (asset.mimeType === "font/ttf") {
    if (bytes.length < 12 || !["00010000", "4f54544f"].includes(bytes.subarray(0, 4).toString("hex"))) reject();
    const tables = bytes.readUInt16BE(4);
    if (!tables || tables > 256 || 12 + tables * 16 > bytes.length) reject();
    for (let index = 0; index < tables; index++) {
      const offset = 12 + index * 16;
      if (bytes.readUInt32BE(offset + 8) + bytes.readUInt32BE(offset + 12) > bytes.length) reject();
    }
  } else {
    const signature = asset.mimeType === "font/woff" ? "wOFF" : "wOF2";
    if (bytes.length < 48 || bytes.toString("ascii", 0, 4) !== signature || bytes.readUInt32BE(8) !== bytes.length
      || !bytes.readUInt16BE(12) || bytes.readUInt16BE(12) > 256 || bytes.readUInt32BE(16) > IMPORTED_SLIDE_ASSET_LIMITS.decodedFontBytes) reject();
  }
  return pixels;
}

export function normalizeImportedAssets(value: unknown): ImportedSlideAsset[] {
  const assets = importedSlideAssetsSchema.parse(value ?? []);
  let total = 0;
  let pixels = 0, decodedFontBytes = 0;
  return assets.map(asset => {
    if (asset.base64 === undefined) { total += asset.byteLength!; if (total > IMPORTED_SLIDE_ASSET_LIMITS.bytes) reject(); return asset; }
    const bytes = Buffer.from(asset.base64, "base64");
    if (bytes.toString("base64") !== asset.base64) reject();
    total += bytes.length;
    if (total > IMPORTED_SLIDE_ASSET_LIMITS.bytes) reject();
    try { pixels += assertImportedAssetBinary(asset, bytes); } catch { reject(); }
    if (asset.mimeType.startsWith("font/")) decodedFontBytes += asset.mimeType === "font/ttf" ? bytes.length : bytes.readUInt32BE(16);
    if (pixels > IMPORTED_SLIDE_ASSET_LIMITS.totalPixels || decodedFontBytes > IMPORTED_SLIDE_ASSET_LIMITS.decodedFontBytes) reject();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (asset.sha256 && asset.sha256 !== sha256 || asset.byteLength && asset.byteLength !== bytes.length) reject();
    return { ...asset, byteLength: bytes.length, sha256 };
  });
}

export function importedAssetManifest(assets: ImportedSlideAsset[] | undefined) {
  return assets?.map(asset => ({ id: asset.id, mimeType: asset.mimeType, byteLength: asset.byteLength, sha256: asset.sha256 }));
}
