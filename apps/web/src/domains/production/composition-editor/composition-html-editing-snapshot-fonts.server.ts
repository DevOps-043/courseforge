import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ORGANIZATION_FONT_TABLE, ORGANIZATION_FONT_STORAGE_BUCKET } from "../fonts/organization-font.types";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { assertDocumentConformanceFontBindings, conformanceFontManifestSchema, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { CONFORMANCE_MATERIALIZATION_LIMITS } from "./qa/composition-conformance-materialization";

const binding = conformanceFontManifestSchema.element;
const fontRow = z.object({id:z.string().uuid(),organization_id:z.string().uuid(),family:binding.shape.family,
  source:z.literal("uploaded"),status:z.literal("READY"),checksum_sha256:binding.shape.checksumSha256,
  file_size_bytes:binding.shape.fileSizeBytes,mime_type:binding.shape.mimeType,
  storage_bucket:z.literal(ORGANIZATION_FONT_STORAGE_BUCKET),
  storage_path:z.string().min(1).max(1024).refine(path => path.split("/").every(segment =>
    /^[a-zA-Z0-9_.-]+$/.test(segment) && segment !== "." && segment !== "..")),
}).strict();

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
    const references = new Map<string,string>();
    for (const clip of document.clips) if ((clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") && clip.source.style.fontAssetId) {
      const {fontAssetId,fontFamily} = clip.source.style;
      if (references.has(fontAssetId) && references.get(fontAssetId) !== fontFamily) throw new Error("HTML_SNAPSHOT_FONT_FAMILY_CONFLICT");
      references.set(fontAssetId,fontFamily);
    }
    if (references.size > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) throw new Error("HTML_SNAPSHOT_FONT_LIMIT");
    if (!references.size) return [];
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const signal = params.signal ? AbortSignal.any([params.signal,timeout]) : timeout;
    try {
      const ids = [...references.keys()].sort();
      const result = await configuration.supabase.from(ORGANIZATION_FONT_TABLE)
        .select("id,organization_id,family,source,status,checksum_sha256,file_size_bytes,mime_type,storage_bucket,storage_path")
        .eq("organization_id",organizationId).in("id",ids).limit(ids.length+1).abortSignal(signal);
      signal.throwIfAborted();
      if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
      const rows = z.array(fontRow).max(ids.length).parse(result.data);
      if (rows.length !== ids.length || new Set(rows.map(font => font.id)).size !== ids.length
        || rows.some(font => font.organization_id !== organizationId || !references.has(font.id))) throw new Error();
      const manifest = assertDocumentConformanceFontBindings(document,rows.map(font => ({fontAssetId:font.id,family:font.family,
        checksumSha256:font.checksum_sha256,fileSizeBytes:font.file_size_bytes,mimeType:font.mime_type})));
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
