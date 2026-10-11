import { createHash } from "node:crypto";
import { compositionFontReferences } from "./composition-font-references";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";
import { readReadyCompositionFontRows } from "./composition-font-registry.server";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { assertDocumentConformanceFontBindings, conformanceFontManifestSchema, conformanceFontManifestHash, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { CONFORMANCE_MATERIALIZATION_LIMITS } from "./qa/composition-conformance-materialization";

/** Metadata-only refresh of READY uploaded authority; no second download. The
 * prepared local bytes stay checksum-bound. Commit still reauthorizes under SQL
 * locks: sequential reads do not constitute an atomic permission snapshot. */
export async function revalidateHtmlSnapshotFontAuthority(supabase: SupabaseClient, input: {
  organizationId: string; manifest: unknown; signal: AbortSignal;
}) {
  try {
    const organizationId = z.string().uuid().parse(input.organizationId), manifest = conformanceFontManifestSchema.parse(input.manifest);
    input.signal.throwIfAborted(); if (!manifest.length) return;
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)]);
    const rows = await readReadyCompositionFontRows(supabase, organizationId, manifest.map(font => font.fontAssetId).sort(), signal);
    const current = rows.map(font => ({fontAssetId: font.id, family: font.family, checksumSha256: font.checksum_sha256,
      fileSizeBytes: font.file_size_bytes, mimeType: font.mime_type, ...(font.google_face ? {googleFace: font.google_face} : {})}));
    if (conformanceFontManifestHash(current) !== conformanceFontManifestHash(manifest)) throw new Error();
  } catch {input.signal.throwIfAborted(); throw new Error("HTML_SNAPSHOT_FONTS_UNAVAILABLE_OR_FORBIDDEN");}
}

/** Trusted host configuration, never URL/credentials/bytes from a request.
 * Verifies tenant-owned READY uploaded font records before bounded Storage GET.
 * Hash/size/MIME are byte identity, not font decode or sandbox attestation. */
export function createHtmlSnapshotFontAcquirer(configuration:{supabase:SupabaseClient;supabaseUrl:string;
  serviceRoleKey:string;fetchImpl?:typeof fetch}) {
  let endpoint:URL;
  try {endpoint = new URL(configuration.supabaseUrl);} catch {throw new Error("HTML_SNAPSHOT_FONT_CONFIGURATION_INVALID");}
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== "/" || endpoint.port && endpoint.port !== "443"
    || !configuration.serviceRoleKey || /[\r\n]/.test(configuration.serviceRoleKey)) throw new Error("HTML_SNAPSHOT_FONT_CONFIGURATION_INVALID");
  const fetchImpl = configuration.fetchImpl ?? fetch;
  const headers = {apikey:configuration.serviceRoleKey,Authorization:`Bearer ${configuration.serviceRoleKey}`};
  return async (params:{document:CompositionEditorDocument;organizationId:string;signal?:AbortSignal}) => {
    const organizationId = z.string().uuid().parse(params.organizationId);
    params.signal?.throwIfAborted();
    const document = compositionEditorDocumentSchema.parse(params.document);
    const references = compositionFontReferences(document);
    if (references.size > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) throw new Error("HTML_SNAPSHOT_FONT_LIMIT");
    if (!references.size) return [];
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const signal = params.signal ? AbortSignal.any([params.signal,timeout]) : timeout;
    try {
      const ids = [...references.keys()].sort();
      const rows = await readReadyCompositionFontRows(configuration.supabase, organizationId, ids, signal);
      const manifest = assertDocumentConformanceFontBindings(document,rows.map(font => ({fontAssetId:font.id,family:font.family,
        checksumSha256:font.checksum_sha256,fileSizeBytes:font.file_size_bytes,mimeType:font.mime_type,
        ...(font.google_face ? {googleFace:font.google_face} : {})})));
      if (manifest.reduce((total,font) => total+font.fileSizeBytes,0) > CONFORMANCE_MATERIALIZATION_LIMITS.extractedBytes) throw new Error();
      const packaged = [];
      // Sequential bounded downloads avoid 32 simultaneous large byte buffers.
      for (const font of manifest) {
        signal.throwIfAborted();const record = rows.find(row => row.id === font.fontAssetId)!;
        const path = record.storage_path.split("/").map(encodeURIComponent).join("/");
        const response = await fetchImpl(new URL(`/storage/v1/object/authenticated/${ORGANIZATION_FONT_STORAGE_BUCKET}/${path}`,endpoint).href,
          {method:"GET",headers,signal,cache:"no-store",credentials:"omit",redirect:"error"});
        let reader:ReadableStreamDefaultReader<Uint8Array> | undefined;
        const cancel = () => {void reader?.cancel().catch(() => undefined);};
        try {
          signal.throwIfAborted();
          const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
          if (response.status !== 200 || !response.body || response.headers.has("content-range") || encoding && encoding !== "identity"
            || response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== font.mimeType
            || length !== null && (!/^\d+$/.test(length) || Number(length) !== font.fileSizeBytes)) throw new Error();
          reader = response.body.getReader();signal.addEventListener("abort",cancel,{once:true});
          const chunks:Uint8Array[] = [];let size = 0;const hash = createHash("sha256");
          while (true) {
            signal.throwIfAborted();const chunk = await reader.read();signal.throwIfAborted();if (chunk.done) break;
            size += chunk.value.byteLength;if (size > font.fileSizeBytes) throw new Error();
            hash.update(chunk.value);chunks.push(new Uint8Array(chunk.value));
          }
          if (size !== font.fileSizeBytes || hash.digest("hex") !== font.checksumSha256) throw new Error();
          const bytes = new Uint8Array(size);let offset = 0;
          for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
          packaged.push({binding:font,bytes});
        } finally {
          signal.removeEventListener("abort",cancel);
          if (reader) {await reader.cancel().catch(() => undefined);reader.releaseLock();}
          else await response.body?.cancel().catch(() => undefined);
        }
      }
      signal.throwIfAborted();return packaged;
    } catch {params.signal?.throwIfAborted();throw new Error("HTML_SNAPSHOT_FONTS_UNAVAILABLE_OR_FORBIDDEN");}
  };
}
