import {compositionEditorDocumentSchema} from "../composition-document.types";
import {borrowProducerCdpChannel, type ProducerCdpChannel} from "./composition-borrowed-producer-cdp";
import type {CompositionQaCdpClient} from "./composition-qa-browser";

/** Reads the shared compiler's runtime on the existing page, never a second
 * renderer. Verified materialization remains the authority for page bytes.
 * This check is not pixel parity or a CPU/process containment guarantee. */
export async function assertHtmlLayoutBeforeCapture(client: Pick<CompositionQaCdpClient, "send">, required: boolean): Promise<void> {
  if (!required) return;
  try {
    const response = await client.send("Runtime.evaluate", {
      expression: `(async () => {
        const layout = window.__courseforgeHtmlLayout;
        if (!layout || typeof layout.assert !== "function" || typeof layout.getState !== "function"
          || !layout.ready || typeof layout.ready.then !== "function") throw new Error("HTML_LAYOUT_MISSING");
        await layout.ready;
        if (layout.getState() !== "READY") throw new Error("HTML_LAYOUT_NOT_READY");
        layout.assert();
        return true;
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    const result = response.result as {value?: unknown} | undefined;
    if (response.exceptionDetails || result?.value !== true) throw new Error();
  } catch { throw new Error("CONFORMANCE_HTML_LAYOUT_UNAVAILABLE"); }
}

/** Owns only a borrowed reader until the host closes it, independently of
 * checkpoint readers which can finish before the SDK's final frame. */
export function createOriginalSessionHtmlLayoutCapture(input: {
  cdp: ProducerCdpChannel; document: unknown; signal: AbortSignal;
}) {
  const document = compositionEditorDocumentSchema.parse(input.document);
  const required = Boolean(document.htmlEditing?.items.length);
  const client = required ? borrowProducerCdpChannel(input.cdp, input.signal) : undefined;
  let closed = false, busy = false, failure: Error | undefined;
  const active = () => {
    if (failure) throw failure;
    input.signal.throwIfAborted();
    if (closed) throw new Error("CONFORMANCE_HTML_LAYOUT_CLOSED");
  };
  return {required, close() { closed = true; client?.close(); }, async assert() {
    try {
      active();
      if (busy) throw new Error();
      busy = true;
      if (client) await assertHtmlLayoutBeforeCapture(client, true);
      active();
    } catch { failure ??= new Error("CONFORMANCE_HTML_LAYOUT_UNAVAILABLE"); throw failure; }
    finally { busy = false; }
  }};
}
