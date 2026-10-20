import { formatHtmlSlideImportBytes } from "./imported-slide-design.contract";

export const HTML_SLIDE_FILE_LIMITS = Object.freeze({
  bytes: 100_000_000,
  chunkBytes: 256 * 1024,
  timeoutMs: 120_000,
  elements: 10_000,
  depth: 80,
});
export const HTML_SLIDE_FILE_SIZE_LABEL = formatHtmlSlideImportBytes(HTML_SLIDE_FILE_LIMITS.bytes);

export interface PreparedSlideFile {
  html: string;
  originalBytes: number;
  preparedBytes: number;
  removedScripts: number;
  removedResources: number;
  removedCssUrls: number;
}

export type SlideFileWorkerMessage =
  | { type: "progress"; percent: number }
  | { type: "complete"; result: PreparedSlideFile }
  | { type: "error"; message: string };

