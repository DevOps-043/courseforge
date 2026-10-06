import { createHash } from "node:crypto";
import { stereoFloatWavHeader } from "./composition-pcm-wav";

export type CorpusLocalAsset = {id: string; checksum: string; mimeType: "image/svg+xml" | "audio/wav"; bytes: Buffer};
const AUDIO_SAMPLE_RATE = 8000;
export const CORPUS_AUDIO_DURATION_SECONDS = 10;

export function createCorpusColorChart(): CorpusLocalAsset {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#808080"/><rect x="100" y="100" width="400" height="400" fill="#ff0000"/><rect x="700" y="100" width="400" height="400" fill="#00ff00"/><rect x="1300" y="100" width="400" height="400" fill="#0000ff"/><rect x="100" y="650" width="800" height="200" fill="#000000"/><rect x="1000" y="650" width="800" height="200" fill="#ffffff"/></svg>', "utf8");
  return pin("27000000-0000-4000-8000-000000000001", "image/svg+xml", bytes);
}

/** Real IEEE-float stereo WAV bytes. Levels are not an assertion of LUFS/true peak. */
export function createCorpusStereoAudio(role: "VOICE" | "MUSIC"): CorpusLocalAsset {
  const pcm = Buffer.alloc(AUDIO_SAMPLE_RATE * CORPUS_AUDIO_DURATION_SECONDS * 8);
  const seed = role === "VOICE" ? 17 : 31;
  for (let frame = 0; frame < pcm.length / 8; frame++) {
    const seconds = frame / AUDIO_SAMPLE_RATE;
    const block = Math.floor(frame / 320);
    const envelope = 0.1 + ((Math.imul(block + seed, 1103515245) >>> 0) % 997) / 997 * 0.25;
    pcm.writeFloatLE(envelope * Math.sin(2 * Math.PI * (role === "VOICE" ? 330 : 220) * seconds), frame * 8);
    pcm.writeFloatLE(envelope * Math.sin(2 * Math.PI * (role === "VOICE" ? 440 : 270) * seconds + 0.3), frame * 8 + 4);
  }
  return pin(role === "VOICE" ? "27000000-0000-4000-8000-000000000002" : "27000000-0000-4000-8000-000000000003",
    "audio/wav", Buffer.concat([stereoFloatWavHeader(pcm.length, AUDIO_SAMPLE_RATE), pcm]));
}

function pin(id: string, mimeType: CorpusLocalAsset["mimeType"], bytes: Buffer): CorpusLocalAsset {
  return {id, mimeType, bytes, checksum: createHash("sha256").update(bytes).digest("hex")};
}
