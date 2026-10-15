import { load } from "cheerio";
import type { CompositionEditorDocument } from "./composition-document.types";
import { PRODUCTION_QA_STATUSES } from "../types/production.types";

const alias = /^conformance-media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const availableStatuses = new Set<string>([PRODUCTION_QA_STATUSES.GENERATED, PRODUCTION_QA_STATUSES.READY_FOR_QA,
  PRODUCTION_QA_STATUSES.APPROVED, PRODUCTION_QA_STATUSES.EXPORTED, PRODUCTION_QA_STATUSES.PUBLISHED]);
export const isCompositionDeckImageAvailable = (mimeType: unknown, qaStatus: unknown) =>
  typeof mimeType === "string" && ["image/png", "image/jpeg", "image/webp"].includes(mimeType)
  && typeof qaStatus === "string" && availableStatuses.has(qaStatus);

/** Aliases declare dependencies, never grant access. Hosts must independently
 * verify current tenant, draft links and image status before resolving them. */
export function compositionDeckImageAssetIds(document: CompositionEditorDocument) {
  const ids = new Set<string>();
  for (const clip of document.clips) {
    if (clip.source.type !== "DECK_SLIDE" || !clip.source.html.includes("conformance-media/")) continue;
    const fragment = load(clip.source.html, {}, false);
    fragment("img[src]").each((_index, node) => {
      const source = fragment(node).attr("src")!;
      if (!source.startsWith("conformance-media/")) return;
      const match = alias.exec(source);
      if (!match) throw new Error("DECK_IMAGE_ALIAS_INVALID");
      ids.add(match[1]);
    });
  }
  return [...ids].sort();
}

export function resolveCompositionDeckImageAliases(sourceHtml: string, assetUrls: ReadonlyMap<string, string>) {
  if (!sourceHtml.includes("conformance-media/")) return sourceHtml;
  const fragment = load(sourceHtml, {}, false);
  fragment("img[src]").each((_index, node) => {
    const source = fragment(node).attr("src")!;
    if (!source.startsWith("conformance-media/")) return;
    const match = alias.exec(source);
    const resolved = match && assetUrls.get(match[1]);
    if (!resolved) throw new Error("DECK_IMAGE_ALIAS_UNAVAILABLE");
    fragment(node).attr("src", resolved);
  });
  return fragment.html();
}
