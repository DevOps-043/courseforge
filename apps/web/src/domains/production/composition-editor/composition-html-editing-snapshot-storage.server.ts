import { createHash } from "node:crypto";
import { z } from "zod";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { HTML_EDITING_SNAPSHOT_STORAGE_BUCKET, type HtmlEditingSnapshotPublicationPorts } from "./composition-html-editing-snapshot-publication.server";

const requestSchema = z.object({organizationId: z.string().uuid(), compositionId: z.string().uuid(),
  projectHash: z.string().regex(/^[a-f0-9]{64}$/), contentType: z.literal("application/zip")}).strict();

/** Privileged host configuration only. Endpoint/key must come from trusted
 * server settings, never a request/archive. No live route installs this port.
 * Create-only is an application policy, NOT bucket-wide write-once protection:
 * other privileged writers can still replace objects. Worker hash checks remain
 * mandatory. Successful upload is followed by bounded full-byte readback. */
export function createHtmlEditingSnapshotArchiveStore(configuration: {
  supabaseUrl: string; serviceRoleKey: string; fetchImpl?: typeof fetch;
}): HtmlEditingSnapshotPublicationPorts["storeImmutableArchive"] {
  let endpoint: URL;
  try {endpoint = new URL(configuration.supabaseUrl);} catch {throw new Error("HTML_EDITING_STORAGE_CONFIGURATION_INVALID");}
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== "/" || (endpoint.port && endpoint.port !== "443")
    || !configuration.serviceRoleKey || /[\r\n]/.test(configuration.serviceRoleKey)) {
    throw new Error("HTML_EDITING_STORAGE_CONFIGURATION_INVALID");
  }
  const fetchImpl = configuration.fetchImpl ?? fetch;
  const headers = {apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}`};
  return async input => {
    const request = requestSchema.parse({organizationId: input.organizationId, compositionId: input.compositionId,
      projectHash: input.projectHash, contentType: input.contentType});
    input.signal.throwIfAborted();
    if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES
      || createHash("sha256").update(input.bytes).digest("hex") !== request.projectHash) {
      throw new Error("HTML_EDITING_STORAGE_INPUT_INVALID");
    }
    const storagePath = `composition-snapshots/${request.organizationId}/${request.compositionId}/${request.projectHash}.zip`;
    const url = new URL(`/storage/v1/object/${HTML_EDITING_SNAPSHOT_STORAGE_BUCKET}/${storagePath}`, endpoint).href;
    let readback: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelRead = () => {void reader?.cancel().catch(() => undefined);};
    try {
      // Explicit false: never PUT, upsert, delete, or retry an uncertain write.
      const uploaded = await fetchImpl(url, {method: "POST", headers: {...headers,
        "Content-Type": request.contentType, "x-upsert": "false"}, body: input.bytes as BodyInit,
        signal: input.signal, redirect: "error", credentials: "omit", cache: "no-store"});
      await uploaded.body?.cancel();
      input.signal.throwIfAborted();
      if (![200, 201, 409].includes(uploaded.status)) throw new Error();
      // A conflict only permits a read, not a successful receipt. Unknown 400s
      // are deliberately rejected rather than inferred from provider messages.
      readback = await fetchImpl(url, {method: "GET", headers, signal: input.signal,
        redirect: "error", credentials: "omit", cache: "no-store"});
      input.signal.throwIfAborted();
      const sizeHeader = readback.headers.get("content-length");
      const encoding = readback.headers.get("content-encoding");
      if (readback.status !== 200 || !readback.body || readback.headers.has("content-range")
        || (encoding && encoding !== "identity")
        || readback.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/zip"
        || (sizeHeader !== null && (!/^\d+$/.test(sizeHeader) || Number(sizeHeader) !== input.bytes.length))) throw new Error();
      reader = readback.body.getReader();
      input.signal.addEventListener("abort", cancelRead, {once: true});
      const hash = createHash("sha256"); let sizeBytes = 0;
      while (true) {
        input.signal.throwIfAborted();
        const chunk = await reader.read();
        input.signal.throwIfAborted();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw new Error();
        sizeBytes += chunk.value.byteLength;
        if (sizeBytes > input.bytes.length) throw new Error();
        hash.update(chunk.value);
      }
      if (sizeBytes !== input.bytes.length || hash.digest("hex") !== request.projectHash) throw new Error();
      return {projectHash: request.projectHash, sizeBytes, storageBucket: HTML_EDITING_SNAPSHOT_STORAGE_BUCKET, storagePath};
    } catch {throw new Error("HTML_EDITING_STORAGE_VERIFICATION_UNAVAILABLE");}
    finally {
      input.signal.removeEventListener("abort", cancelRead);
      if (reader) {await reader.cancel().catch(() => undefined); reader.releaseLock();}
      else await readback?.body?.cancel().catch(() => undefined);
    }
  };
}
