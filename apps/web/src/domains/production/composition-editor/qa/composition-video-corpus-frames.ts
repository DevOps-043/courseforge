import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";

export const VIDEO_CORPUS_SOURCE_DURATION_SECONDS = 10;
export const VIDEO_CORPUS_FRAME_FILE_PATTERN = "frame-%03d.png";
const MAX_FRAME_PNG_BYTES = 1024 * 1024;

export function videoCorpusFramePath(directory: string, frameIndex: number) {
  return join(directory, `frame-${String(frameIndex).padStart(3, "0")}.png`);
}

/** Each frame carries a moving bar and binary frame index; no system font or network asset is involved. */
export async function renderVideoCorpusFrame(frameIndex: number, frameCount: number) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || !Number.isSafeInteger(frameCount)
    || frameCount < 1 || frameIndex >= frameCount || frameCount > 600) throw new Error("CONFORMANCE_CORPUS_FRAME_INDEX_INVALID");
  const barX = 80 + Math.round(frameIndex * 1680 / Math.max(1, frameCount - 1));
  const bits = Array.from({length: 10}, (_, bit) => `<rect x="${80 + bit * 70}" y="80" width="48" height="48" fill="${frameIndex & (1 << bit) ? "#ffffff" : "#111111"}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#1d3557"/><rect x="80" y="240" width="1760" height="160" fill="#e63946"/><rect x="80" y="440" width="1760" height="160" fill="#a8dadc"/><rect x="80" y="640" width="1760" height="160" fill="#457b9d"/><rect x="${barX}" y="220" width="32" height="600" fill="#ffffff"/>${bits}</svg>`;
  const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  if (png.length <= 0 || png.length > MAX_FRAME_PNG_BYTES) throw new Error("CONFORMANCE_CORPUS_FRAME_SIZE_INVALID");
  return png;
}

export async function writeVideoCorpusFrames(directory: string, fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number], signal?: AbortSignal) {
  if (!NATIVE_CONFORMANCE_CORPUS_FPS.includes(fps)) throw new Error("CONFORMANCE_CORPUS_FPS_INVALID");
  const frameCount = VIDEO_CORPUS_SOURCE_DURATION_SECONDS * fps;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    if (signal?.aborted) throw new Error("CONFORMANCE_CORPUS_ABORTED");
    await writeFile(videoCorpusFramePath(directory, frameIndex), await renderVideoCorpusFrame(frameIndex, frameCount),
      {flag: "wx", mode: 0o600});
  }
  return frameCount;
}
