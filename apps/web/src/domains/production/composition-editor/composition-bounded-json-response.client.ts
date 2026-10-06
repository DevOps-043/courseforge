/** Shared streaming JSON reader. Bounds actual UTF-8 bytes, cancels on overflow/
 * abort and never accepts redirects/error HTML as a successful API response. */
export async function readBoundedCompositionJson(response: Response, maximumBytes: number, signal: AbortSignal): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  try {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || !response.ok || response.redirected || !response.body
      || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error();
    reader = response.body.getReader(); signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
      total += chunk.value.byteLength; if (total > maximumBytes) throw new Error(); chunks.push(new Uint8Array(chunk.value));
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    signal.removeEventListener("abort", cancel);
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    else await response.body?.cancel().catch(() => undefined);
  }
}
