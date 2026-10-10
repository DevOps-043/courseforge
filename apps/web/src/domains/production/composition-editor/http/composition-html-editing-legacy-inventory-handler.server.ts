import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { HTML_LEGACY_INVENTORY_POLICY as policy, htmlLegacyInventoryQuerySchema, htmlLegacyInventoryRequestSchema,
  htmlLegacyInventoryPageSchema, matchesHtmlLegacyInventoryPage } from "../composition-html-editing-legacy-inventory.contract";
import { HtmlLegacyInventoryError, readAuthorizedHtmlLegacyInventory } from "../composition-html-editing-legacy-inventory.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createHtmlLegacyInventoryHandler(dependencies: {enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>;
  serviceClient: () => SupabaseClient; logFailure?: (requestId: string) => void}) {
  return createHtmlAuthenticatedReadHandler({...dependencies, policy, ratePrefix: "html-legacy-inventory", maximumResponseBytes: policy.responseBytes,
    paramsSchema: z.object({draftId: z.string().uuid()}).strict(), querySchema: htmlLegacyInventoryQuerySchema, resultSchema: htmlLegacyInventoryPageSchema,
    command: (params, query, owner) => htmlLegacyInventoryRequestSchema.parse({...owner, draftId: params.draftId, query}),
    read: (supabase, request, signal) => readAuthorizedHtmlLegacyInventory({supabase, request, signal}),
    matches: matchesHtmlLegacyInventoryPage, isConflict: error => error instanceof HtmlLegacyInventoryError && error.baseChanged});
}
