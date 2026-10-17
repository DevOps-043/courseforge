import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_LEGACY_INVENTORY_POLICY as policy, htmlLegacyInventoryRequestSchema, htmlLegacyInventoryPageSchema,
  matchesHtmlLegacyInventoryPage, type HtmlLegacyInventoryRequest } from "./composition-html-editing-legacy-inventory.contract";

export class HtmlLegacyInventoryError extends Error {
  constructor(readonly baseChanged = false) {super(baseChanged ? "HTML_LEGACY_INVENTORY_BASE_CHANGED" : "HTML_LEGACY_INVENTORY_UNAVAILABLE");}
}
/** One current-authority RPC. Metadata inventory does not parse/render source,
 * install templates, grant assets or certify provenance/compatibility. */
export async function readAuthorizedHtmlLegacyInventory(input: {supabase: SupabaseClient; request: HtmlLegacyInventoryRequest; signal: AbortSignal}) {
  const request = htmlLegacyInventoryRequestSchema.parse(input.request);
  try {
    input.signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_editing_legacy_inventory", {p_org: request.organizationId, p_actor: request.actorId,
      p_composition: request.query.compositionId, p_draft: request.draftId, p_after_ordinal: request.query.afterOrdinal ?? null,
      p_expected_hash: request.query.expectedDocumentHash ?? null, p_expected_version: request.query.expectedVersion ?? null}).abortSignal(input.signal);
    input.signal.throwIfAborted();
    if (result.error?.message === "HTML_LEGACY_INVENTORY_BASE_CHANGED") throw new HtmlLegacyInventoryError(true);
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > policy.responseBytes) throw new Error();
    const page = htmlLegacyInventoryPageSchema.parse(result.data);
    if (!matchesHtmlLegacyInventoryPage(page, request)) throw new Error();
    return page;
  } catch (error) {
    input.signal.throwIfAborted(); if (error instanceof HtmlLegacyInventoryError) throw error;
    throw new HtmlLegacyInventoryError();
  }
}
