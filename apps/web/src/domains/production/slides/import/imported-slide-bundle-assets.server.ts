import { createHash } from "node:crypto";
import JSZip from "jszip";
import { Readable } from "node:stream";
import { importedAssetExtension } from "./imported-slide-assets.contract";
import { importedAssetManifest } from "./imported-slide-assets.server";
import { normalizeImportedSlideDesign } from "./imported-slide-design.service";
import { HtmlSlideImportError, type ImportedSlideDesign } from "./imported-slide-design.contract";

interface BundleStorage {
  storage: { from(bucket: string): { download(path: string): Promise<{ data: { size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null; error: unknown }> } };
}
interface BundleRunQuery {
  eq(key: string, value: string): BundleRunQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}
interface BundleRunDatabase extends BundleStorage {
  from(table: string): { select(columns: string): BundleRunQuery };
}
const maximumBundleBytes = 8_000_000;

export function detachedImportedDesign(design: ImportedSlideDesign): ImportedSlideDesign {
  return { ...design, ...(design.assets ? { assets: importedAssetManifest(design.assets) } : {}) };
}

async function readBoundedEntry(entry: JSZip.JSZipObject, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const stream = new Readable().wrap(entry.nodeStream("nodebuffer"));
    stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maximum) stream.destroy(new HtmlSlideImportError("El recurso del paquete supera su tamaño declarado."));
      else chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** El llamador autoriza el run por organización antes de entregar su ruta y hash. */
export async function hydrateImportedDesignBundle(design: ImportedSlideDesign, input: {
  admin: BundleStorage; organizationId: string; storagePath: string; outputHash: string;
}): Promise<ImportedSlideDesign> {
  const normalized = normalizeImportedSlideDesign(design);
  if (!normalized.assets?.some(asset => asset.base64 === undefined)) return normalized;
  const prefix = `template-bundles/organizations/${input.organizationId}/slide-templates/imports/`;
  if (!input.storagePath.startsWith(prefix) || !/^[a-f0-9-]+\/[a-f0-9]{64}\.slide-template\.zip$/.test(input.storagePath.slice(prefix.length))
    || !/^[a-f0-9]{64}$/.test(input.outputHash)) throw new HtmlSlideImportError("El paquete de recursos no corresponde a esta organización.");
  const { data, error } = await input.admin.storage.from("template-bundles").download(input.storagePath.slice("template-bundles/".length));
  if (error || !data || data.size && data.size > maximumBundleBytes) throw new HtmlSlideImportError("No se pudo recuperar el paquete de recursos de la plantilla.");
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length > maximumBundleBytes || createHash("sha256").update(buffer).digest("hex") !== input.outputHash) throw new HtmlSlideImportError("El paquete de recursos no supera la comprobación de integridad.");
  const endRecord = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endRecord < 0 || endRecord + 22 > buffer.length || buffer.readUInt16LE(endRecord + 10) > 128) throw new HtmlSlideImportError("El paquete de recursos excede la complejidad admitida.");
  const zip = await JSZip.loadAsync(buffer);
  const assets = [];
  for (const asset of normalized.assets) {
    const entry = zip.file(`assets/${asset.id}.${importedAssetExtension(asset.mimeType)}`);
    if (!entry || entry.dir) throw new HtmlSlideImportError("Falta un recurso declarado en la plantilla.");
    const bytes = await readBoundedEntry(entry, asset.byteLength!);
    assets.push({ ...asset, base64: bytes.toString("base64") });
  }
  return normalizeImportedSlideDesign({ ...normalized, assets });
}

export async function hydrateImportedDesignForOrganization(design: ImportedSlideDesign, input: {
  admin: unknown; organizationId: string;
}): Promise<ImportedSlideDesign> {
  if (!design.assets?.some(asset => asset.base64 === undefined)) return normalizeImportedSlideDesign(design);
  if (!design.resourceBundleRunId) throw new HtmlSlideImportError("La plantilla no declara un paquete de recursos recuperable.");
  // Acota el SDK inyectado por servidor sin propagar sus tipos recursivos de query.
  const admin = input.admin as Partial<BundleRunDatabase> | null;
  if (typeof admin?.from !== "function" || typeof admin.storage?.from !== "function") throw new Error("No está disponible el lector privado de recursos.");
  const { data, error } = await admin.from("soflia_bundle_generation_runs")
    .select("bundle_storage_path,output_hash").eq("id", design.resourceBundleRunId)
    .eq("organization_id", input.organizationId).eq("status", "PACKAGED").maybeSingle();
  const run = data as { bundle_storage_path?: unknown; output_hash?: unknown } | null;
  if (error || !run || typeof run.bundle_storage_path !== "string" || typeof run.output_hash !== "string") throw new HtmlSlideImportError("La plantilla no tiene recursos disponibles para esta organización.");
  return hydrateImportedDesignBundle(design, { admin: { storage: admin.storage }, organizationId: input.organizationId,
    storagePath: run.bundle_storage_path, outputHash: run.output_hash });
}
