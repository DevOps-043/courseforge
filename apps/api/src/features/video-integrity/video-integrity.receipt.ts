import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type CheckedVideo = {
  checksum: string;
  documentHash: string;
  status: "MATCH";
};

export function buildVerifiedVideoReceipt(video: CheckedVideo) {
  if (video.status !== "MATCH" || !/^[a-f0-9]{64}$/.test(video.checksum)
    || !/^[a-f0-9]{64}$/.test(video.documentHash)) {
    throw new Error("VIDEO_INTEGRITY_RECEIPT_INPUT_INVALID");
  }
  return { documentHash: video.documentHash, videoSha256: video.checksum };
}

export async function writeVerifiedVideoReceipt(outputPath: string, video: CheckedVideo): Promise<void> {
  if (!outputPath.trim()) throw new Error("VIDEO_INTEGRITY_RECEIPT_PATH_INVALID");
  const receipt = buildVerifiedVideoReceipt(video);
  try {
    await writeFile(resolve(outputPath), `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("VIDEO_INTEGRITY_RECEIPT_EXISTS");
    throw error;
  }
}
