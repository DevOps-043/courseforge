export async function sourceJsonRequest(url: string, body?: object) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "No se pudo completar la operación documental.");
  return result;
}

export function uploadSourceBytes(url: string, file: File, mimeType: string,
  progress: (percent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open("PUT", url); xhr.setRequestHeader("Content-Type", mimeType);
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded * 100 / event.total)); };
    const complete = (error?: Error) => { signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
    xhr.onload = () => complete(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("Carga interrumpida. Reutiliza el mismo archivo para recuperar su reserva."));
    xhr.onerror = () => complete(new Error("Conexión interrumpida. Consulta el estado antes de repetir la carga."));
    xhr.onabort = () => complete(new Error("Transferencia cancelada; se conserva la reserva para recuperación o conciliación."));
    xhr.timeout = 120_000; xhr.ontimeout = () => complete(new Error("La transferencia agotó el tiempo. Reintenta con el mismo archivo."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { complete(new Error("Transferencia cancelada.")); return; }
    xhr.send(file);
  });
}
