import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareCompositionHtmlEditingSnapshotImages } from "./composition-html-editing-snapshot-images.service";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { readReferencedCompositionFonts } from "./composition-font-assets.service";
import { buildCompositionHtmlEditingPreviewInventory, HTML_EDITING_PREVIEW_RESOURCE_POLICY } from "./composition-html-editing-preview-inventory.server";
import { spoolCompositionHtmlEditingPreviewResource, HtmlEditingPreviewSpoolCleanupError } from "./composition-html-editing-preview-spool.server";
import { htmlPreviewDeliveryBudget } from "./composition-html-editing-preview-delivery-budget.server";
import { validateCompositionHtmlEditingPreviewImageBytes } from "./composition-html-editing-preview-images.server";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { compileCompositionPreview } from "./composition-preview-compiler.service";
import { CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { assertPublishedHtmlPreviewPortfolio, type PublishedHtmlPreviewBinding } from "./composition-html-editing-published-preview.server";

export class HtmlEditingPreviewResourcesError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_RESOURCES_UNAVAILABLE"); this.name = "HtmlEditingPreviewResourcesError"; }
}
type Input = Parameters<typeof prepareCompositionHtmlEditingSnapshotImages>[0] & {
  supabase: SupabaseClient; storageOrigin: string; fetchResource?: typeof fetch; previewGeneration?: number | null;
  /** Host-read publication identity, never accepted from an HTTP payload. */
  publishedBinding?: PublishedHtmlPreviewBinding;
};
type PrivateFile = Awaited<ReturnType<typeof spoolCompositionHtmlEditingPreviewResource>>;

export async function readCompositionHtmlEditingPreviewPortfolio(input: Input) {
  const snapshot = await prepareCompositionHtmlEditingSnapshotImages(input);
  const expectedPin = input.publishedBinding?.expectedFrozenBundleSha256;
  if (expectedPin !== undefined && (!/^[a-f0-9]{64}$/.test(expectedPin)
      || snapshot.bundle.sha256 !== expectedPin)) throw new HtmlEditingPreviewResourcesError();
  const native = await readHtmlSnapshotNativeMedia({ ...input, document: snapshot.document, draftId: input.documentId });
  const fontIds = new Set(snapshot.document.clips.flatMap(clip =>
    (clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") && clip.source.style.fontAssetId
      ? [clip.source.style.fontAssetId] : []));
  if (fontIds.size > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) throw new HtmlEditingPreviewResourcesError();
  const fonts = await readReferencedCompositionFonts({ ...input, document: snapshot.document });
  const inventory = buildCompositionHtmlEditingPreviewInventory({ document: snapshot.document, htmlImages: snapshot.imageAssets,
    nativeAssets: native.assets, nativeDeckPublicUrls: native.deckPublicUrls, fonts });
  if (input.publishedBinding) assertPublishedHtmlPreviewPortfolio(input.publishedBinding, inventory);
  input.signal?.throwIfAborted();
  return { snapshot, inventory };
}

function assertSamePortfolio(initial: Awaited<ReturnType<typeof readCompositionHtmlEditingPreviewPortfolio>>, current: Awaited<ReturnType<typeof readCompositionHtmlEditingPreviewPortfolio>>) {
  if (initial.snapshot.bundle.sha256 !== current.snapshot.bundle.sha256
    || initial.snapshot.bundle.encodedBundle !== current.snapshot.bundle.encodedBundle
    || initial.inventory.fingerprint !== current.inventory.fingerprint) throw new HtmlEditingPreviewResourcesError();
}

/** Complete host-only preparation, not an HTTP response or permission lease.
 * Compiled HTML intentionally has local aliases until browser delivery is wired.
 * Exact authorization precedes preflight; rechecks surround asynchronous compile.
 * No request-supplied source/grants, duplicate downloads, cache or renderer gate. */
export async function prepareCompositionHtmlEditingPreviewResources(input: Input) {
  const ownedFiles: PrivateFile[] = [];
  const resources = new Map<string, PrivateFile>();
  let releaseReservation: (() => void) | undefined;
  let uncertainCleanup = false;
  const dispose = async () => {
    const results = await Promise.allSettled(ownedFiles.map(resource => resource.dispose()));
    if (results.some(result => result.status === "rejected")) throw new HtmlEditingPreviewResourcesError();
    if (!uncertainCleanup) { releaseReservation?.(); releaseReservation = undefined; }
  };
  try {
    const timeout = AbortSignal.timeout(HTML_EDITING_PREVIEW_RESOURCE_POLICY.preparationTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const scoped = { ...input, signal };
    signal.throwIfAborted();
    const initial = await readCompositionHtmlEditingPreviewPortfolio(scoped);
    releaseReservation = htmlPreviewDeliveryBudget.reserve(initial.inventory.totalBytes);
    // The entire identity/count/disk budget is checked before the first signature.
    for (const resource of initial.inventory.entries) {
      const file = await spoolCompositionHtmlEditingPreviewResource({ ...scoped, identity: resource.identity });
      ownedFiles.push(file); resources.set(resource.localPath, file);
      if (resource.identity.mimeType.startsWith("image/")) {
        await validateCompositionHtmlEditingPreviewImageBytes({ bytes: await file.readSmallBytes(), signal,
          identity: htmlEditingImageIdentitySchema.parse({ ...resource.identity,
            productionAssetId: resource.localPath.slice("conformance-media/".length) }) });
      }
    }
    const refreshed = await readCompositionHtmlEditingPreviewPortfolio(scoped);
    assertSamePortfolio(initial, refreshed);
    const previewHtml = await compileCompositionPreview({ document: refreshed.snapshot.document, documentHash: input.documentHash,
      htmlEditingCompilation: refreshed.snapshot.context, assetUrls: refreshed.inventory.assetUrls,
      fontAssets: refreshed.inventory.fonts, deckAssetUrls: refreshed.inventory.deckAssetUrls, previewGeneration: input.previewGeneration });
    const final = await readCompositionHtmlEditingPreviewPortfolio(scoped);
    assertSamePortfolio(initial, final);
    signal.throwIfAborted();
    return { document: final.snapshot.document, context: final.snapshot.context, bundle: final.snapshot.bundle,
      inventory: final.inventory, previewHtml, resources, dispose,
      scope: "AUTHORIZED_COMPILED_LOCAL_PREVIEW_RESOURCES_NOT_BROWSER_DELIVERY_OR_RENDER_EVIDENCE" as const };
  } catch (error) {
    if (error instanceof HtmlEditingPreviewSpoolCleanupError) uncertainCleanup = true;
    await dispose();
    throw new HtmlEditingPreviewResourcesError();
  }
}
