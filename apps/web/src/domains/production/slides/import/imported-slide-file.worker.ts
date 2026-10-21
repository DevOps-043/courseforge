import { prepareImportedSlideFile } from "./imported-slide-file-preparation.service";
import type { SlideFileWorkerMessage } from "./imported-slide-file.contract";

const port = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ file: File }>) => void;
  postMessage: (message: SlideFileWorkerMessage) => void;
};
port.onmessage = async event => {
  try {
    const result = await prepareImportedSlideFile(event.data.file, percent => port.postMessage({ type: "progress", percent }), true);
    port.postMessage({ type: "complete", result });
  } catch (error) {
    port.postMessage({ type: "error", message: error instanceof Error ? error.message : "No se pudo preparar el archivo HTML." });
  }
};
