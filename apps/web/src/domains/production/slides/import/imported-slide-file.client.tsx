import { HTML_SLIDE_FILE_LIMITS, type PreparedSlideFile, type SlideFileWorkerMessage } from "./imported-slide-file.contract";

export function prepareImportedSlideFileInWorker(file: File, signal: AbortSignal, onProgress: (percent: number) => void): Promise<PreparedSlideFile> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("Preparación cancelada.")); return; }
    const worker = new Worker(new URL("./imported-slide-file.worker.ts", import.meta.url));
    let settled = false;
    const finish = (error?: string, result?: PreparedSlideFile) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (result) resolve(result);
      else reject(new Error(error ?? "No se pudo preparar el archivo HTML."));
    };
    const abort = () => finish("Preparación cancelada.");
    const timeout = setTimeout(() => finish("La preparación tardó demasiado. Divide el archivo o reduce sus recursos embebidos."), HTML_SLIDE_FILE_LIMITS.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<SlideFileWorkerMessage>) => {
      if (settled) return;
      if (event.data.type === "progress") onProgress(event.data.percent);
      else if (event.data.type === "complete") finish(undefined, event.data.result);
      else finish(event.data.message);
    };
    worker.onerror = () => finish("No se pudo iniciar o ejecutar la preparación local del HTML.");
    worker.onmessageerror = () => finish("No se pudo leer el resultado de la preparación local.");
    try { worker.postMessage({ file }); }
    catch { finish("No se pudo leer el archivo seleccionado."); }
  });
}
