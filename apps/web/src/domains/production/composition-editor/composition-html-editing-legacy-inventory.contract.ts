import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { compositionClipSchema } from "./composition-document.types";

export const HTML_LEGACY_INVENTORY_POLICY = Object.freeze({pageSize: 20, maximumClips: 500,
  responseBytes: 32 * 1024, maximumUrlBytes: 2048, timeoutMs: 15_000, windowSeconds: 60,
  organizationRequests: 60, actorRequests: 30, maximumRateResponseBytes: 4096});
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlLegacyInventoryQuerySchema = z.object({compositionId: uuid,
  afterOrdinal: z.coerce.number().pipe(z.number().int().min(1).max(HTML_LEGACY_INVENTORY_POLICY.maximumClips)).optional(),
  expectedDocumentHash: hash.optional(), expectedVersion: z.coerce.number().pipe(z.number().int().positive().max(2_147_483_647)).optional(),
}).strict().refine(query => (query.afterOrdinal !== undefined) === (query.expectedDocumentHash !== undefined)
  && (query.afterOrdinal !== undefined) === (query.expectedVersion !== undefined));
export const htmlLegacyInventoryRequestSchema = z.object({actorId: uuid, organizationId: uuid, draftId: uuid,
  query: htmlLegacyInventoryQuerySchema}).strict();
export const htmlLegacyInventoryEntrySchema = z.object({ordinal: z.number().int().min(1).max(HTML_LEGACY_INVENTORY_POLICY.maximumClips),
  clipId: compositionClipSchema.shape.id, sourceSha256: hash, sourceBytes: z.number().int().nonnegative().max(16 * 1024 * 1024),
  nativePointerPresent: z.boolean(), registeredTemplatePresent: z.boolean(),
  template: z.object({templateId: htmlEditingBindingSchema.shape.templateId, templateVersion: htmlEditingBindingSchema.shape.templateVersion,
    sourceSha256: hash, revoked: z.boolean()}).strict().nullable(),
}).strict().refine(entry => entry.registeredTemplatePresent === (entry.template !== null));
export const htmlLegacyInventoryPageSchema = z.object({scope: z.literal("CURRENT_HTML_LEGACY_INVENTORY_NOT_ADMISSION_APPROVAL_OR_GRANT"),
  organizationId: uuid, compositionId: uuid, draftId: uuid, documentHash: hash,
  nativeVersion: z.number().int().positive().max(2_147_483_647), issuanceRevisionId: uuid.nullable(),
  afterOrdinal: z.number().int().min(1).max(HTML_LEGACY_INVENTORY_POLICY.maximumClips).nullable(),
  entries: z.array(htmlLegacyInventoryEntrySchema).max(HTML_LEGACY_INVENTORY_POLICY.pageSize),
  nextOrdinal: z.number().int().min(1).max(HTML_LEGACY_INVENTORY_POLICY.maximumClips).nullable(),
}).strict().superRefine((page, context) => {
  let previous = page.afterOrdinal ?? 0; const ids = new Set<string>();
  for (const entry of page.entries) {
    if (entry.ordinal <= previous || ids.has(entry.clipId)) context.addIssue({code: "custom", message: "Invalid inventory ordering"});
    previous = entry.ordinal; ids.add(entry.clipId);
  }
  if (page.nextOrdinal !== null && (page.entries.length !== HTML_LEGACY_INVENTORY_POLICY.pageSize || page.nextOrdinal !== previous))
    context.addIssue({code: "custom", message: "Invalid inventory cursor"});
});
export type HtmlLegacyInventoryRequest = z.infer<typeof htmlLegacyInventoryRequestSchema>;
export type HtmlLegacyInventoryPage = z.infer<typeof htmlLegacyInventoryPageSchema>;
export function matchesHtmlLegacyInventoryPage(page: HtmlLegacyInventoryPage, request: HtmlLegacyInventoryRequest) {
  return page.organizationId === request.organizationId && page.compositionId === request.query.compositionId
    && page.draftId === request.draftId && page.afterOrdinal === (request.query.afterOrdinal ?? null)
    && (request.query.expectedDocumentHash === undefined || page.documentHash === request.query.expectedDocumentHash)
    && (request.query.expectedVersion === undefined || page.nativeVersion === request.query.expectedVersion);
}
export function htmlLegacyInventoryEnabled(environment: Record<string, string | undefined>) {
  return environment.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
    && environment.COMPOSITION_HTML_LEGACY_INVENTORY_ENABLED === "true";
}
