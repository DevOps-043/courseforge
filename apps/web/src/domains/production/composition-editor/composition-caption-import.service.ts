import type { CompositionCaptionCue } from "./composition-text-layer.types";

export const MAX_CAPTION_IMPORT_BYTES = 1024 * 1024;
export const MAX_CAPTION_IMPORT_CUES = 2_000;

export type CompositionCaptionImportFormat = "SRT" | "VTT";

export class CompositionCaptionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionCaptionImportError";
  }
}

export function parseCompositionCaptionImport(params: {
  content: string;
  fileName: string;
  maxDurationSeconds: number;
}) {
  if (!Number.isFinite(params.maxDurationSeconds) || params.maxDurationSeconds <= 0) {
    throw new CompositionCaptionImportError("La duración de la capa de captions no es válida.");
  }
  if (new TextEncoder().encode(params.content).byteLength > MAX_CAPTION_IMPORT_BYTES) {
    throw new CompositionCaptionImportError("El archivo de captions excede el límite de 1 MiB.");
  }

  const normalized = params.content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new CompositionCaptionImportError("El archivo de captions está vacío.");
  const format = resolveCaptionFormat(params.fileName, normalized);
  const body = format === "VTT" ? removeWebVttHeader(normalized) : normalized;
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const cues: CompositionCaptionCue[] = [];

  for (const block of blocks) {
    if (format === "VTT" && /^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split("\n");
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingLineIndex < 0) {
      throw new CompositionCaptionImportError(`No se encontró un timestamp válido en el bloque ${cues.length + 1}.`);
    }
    if (format === "SRT" && timingLineIndex > 1) {
      throw new CompositionCaptionImportError(`El bloque SRT ${cues.length + 1} tiene una estructura inválida.`);
    }
    const { endSeconds, startSeconds } = parseTimingLine(lines[timingLineIndex]!, format, cues.length + 1);
    const text = plainCaptionText(lines.slice(timingLineIndex + 1).join("\n"));
    if (!text) throw new CompositionCaptionImportError(`El caption ${cues.length + 1} no contiene texto.`);
    if (text.length > 1_000) throw new CompositionCaptionImportError(`El caption ${cues.length + 1} excede 1,000 caracteres.`);
    if (endSeconds > params.maxDurationSeconds) {
      throw new CompositionCaptionImportError(
        `El caption ${cues.length + 1} termina en ${formatSeconds(endSeconds)}, fuera de la capa (${formatSeconds(params.maxDurationSeconds)}).`,
      );
    }
    const previous = cues.at(-1);
    if (previous && startSeconds < previous.endSeconds) {
      throw new CompositionCaptionImportError(`El caption ${cues.length + 1} se solapa con el anterior.`);
    }
    cues.push({
      endSeconds,
      id: `cue-${cues.length + 1}`,
      startSeconds,
      text,
    });
    if (cues.length > MAX_CAPTION_IMPORT_CUES) {
      throw new CompositionCaptionImportError(`El archivo excede el límite de ${MAX_CAPTION_IMPORT_CUES.toLocaleString("en-US")} captions.`);
    }
  }

  if (cues.length === 0) throw new CompositionCaptionImportError("El archivo no contiene captions importables.");
  return { cues, format };
}

function resolveCaptionFormat(fileName: string, content: string): CompositionCaptionImportFormat {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "vtt") {
    if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(content)) {
      throw new CompositionCaptionImportError("El archivo .vtt debe comenzar con WEBVTT.");
    }
    return "VTT";
  }
  if (extension === "srt") {
    if (/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(content)) {
      throw new CompositionCaptionImportError("La extensión .srt no coincide con el contenido WebVTT.");
    }
    return "SRT";
  }
  throw new CompositionCaptionImportError("Selecciona un archivo .srt o .vtt.");
}

function removeWebVttHeader(content: string) {
  const lines = content.split("\n");
  lines.shift();
  while (lines[0]?.trim() && !lines[0]!.includes("-->")) lines.shift();
  return lines.join("\n").trim();
}

function parseTimingLine(line: string, format: CompositionCaptionImportFormat, cueNumber: number) {
  const parts = line.split("-->");
  if (parts.length !== 2) throw new CompositionCaptionImportError(`El timestamp del caption ${cueNumber} es inválido.`);
  const startToken = parts[0]!.trim();
  const endToken = parts[1]!.trim().split(/\s+/)[0] || "";
  const startSeconds = parseTimestamp(startToken, format);
  const endSeconds = parseTimestamp(endToken, format);
  if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
    throw new CompositionCaptionImportError(`El rango temporal del caption ${cueNumber} es inválido.`);
  }
  return { endSeconds, startSeconds };
}

function parseTimestamp(value: string, format: CompositionCaptionImportFormat) {
  const separator = format === "SRT" ? "," : ".";
  const escapedSeparator = separator === "." ? "\\." : separator;
  const match = value.match(new RegExp(`^(?:(\\d{2,}):)?([0-5]\\d):([0-5]\\d)${escapedSeparator}(\\d{3})$`));
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  const total = hours * 3_600 + minutes * 60 + seconds + milliseconds / 1_000;
  return Number.isFinite(total) ? total : null;
}

function plainCaptionText(value: string) {
  return decodeCaptionEntities(value.replace(/<[^>\r\n]{0,200}>/g, "")).trim();
}

function decodeCaptionEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}
