import type { CompositionClip } from "./composition-document.types";

export const COMPOSITION_CLIP_EXPORT_POLICY = Object.freeze({
  maximumBytes: 256 * 1024 * 1024,
  maximumDurationSeconds: 600,
  timeoutMs: 15 * 60 * 1000,
  videoBitrate: 4_000_000,
  audioBitrate: 192_000,
});

export function buildCompositionClipExportPlan(clip: CompositionClip) {
  if ((clip.kind !== "VIDEO" && clip.kind !== "AUDIO") || clip.source.type !== "PRODUCTION_ASSET") {
    throw new Error("Selecciona un clip de video o audio de la biblioteca para descargarlo.");
  }
  if ((clip.playbackRate ?? 1) !== 1 || (clip.freezeTailSeconds ?? 0) > 0) {
    throw new Error("Restablece la velocidad y la congelación antes de descargar el recorte temporal.");
  }
  const start = clip.sourceOffsetSeconds ?? 0;
  const end = start + clip.durationSeconds;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || clip.durationSeconds <= 0
    || clip.durationSeconds > COMPOSITION_CLIP_EXPORT_POLICY.maximumDurationSeconds) {
    throw new Error("El tramo debe durar más de cero y hasta diez minutos para descargarlo en el navegador.");
  }
  if (clip.sourceDurationSeconds && end > clip.sourceDurationSeconds + 0.001) {
    throw new Error("El clip repite su fuente. Recorta el tramo dentro de la duración original antes de descargarlo.");
  }
  const extension = clip.kind === "VIDEO" ? "mp4" : "wav";
  const baseName = clip.label.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "clip";
  return { start, end, kind: clip.kind, fileName: `${baseName}-recorte.${extension}`,
    mimeType: clip.kind === "VIDEO" ? "video/mp4" : "audio/wav" } as const;
}

export type CompositionClipExportPlan = ReturnType<typeof buildCompositionClipExportPlan>;
