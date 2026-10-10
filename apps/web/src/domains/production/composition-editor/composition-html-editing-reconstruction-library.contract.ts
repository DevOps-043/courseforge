import { z } from "zod";
import { HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS } from "../hyperframes/hyperframes.types";
import { HTML_RECONSTRUCTION_OPENING_POLICY } from "./composition-html-editing-reconstruction-opening.contract";

const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.number().int().positive().max(2_147_483_647);
export const HTML_RECONSTRUCTION_LIBRARY_POLICY = Object.freeze({...HTML_RECONSTRUCTION_OPENING_POLICY,
  pageSize: 20, responseBytes: 32 * 1024, maximumLabelCharacters: 200, maximumAssets: HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS});
/** Discovery of CURRENT linked production resources, not a resource grant,
 * historical library, native document, attachment or publication command. */
export const htmlReconstructionLibraryQuerySchema = z.object({compositionId: uuid, afterAssetId: uuid.optional(),
  expectedDocumentHash: hash.optional(), expectedVersion: z.coerce.number().pipe(version).optional(),
}).strict().superRefine((query, context) => {
  const hasCursor = query.afterAssetId !== undefined;
  if (hasCursor !== (query.expectedDocumentHash !== undefined) || hasCursor !== (query.expectedVersion !== undefined))
    context.addIssue({code: "custom", message: "La página siguiente requiere identidad de la base."});
});
export const htmlReconstructionLibraryRequestSchema = z.object({actorId: uuid, organizationId: uuid, draftId: uuid,
  query: htmlReconstructionLibraryQuerySchema}).strict();
export type HtmlReconstructionLibraryRequest = z.infer<typeof htmlReconstructionLibraryRequestSchema>;
export const htmlReconstructionLibraryAssetSchema = z.object({productionAssetId: uuid, checksum: z.string().regex(/^[a-f0-9]{64}$/i),
  fileSizeBytes: z.number().int().positive().max(HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm"]),
  // PostgreSQL left() counts Unicode code points, not UTF-16 code units.
  label: z.string().min(1).max(HTML_RECONSTRUCTION_LIBRARY_POLICY.maximumLabelCharacters * 2)
    .refine(value => [...value].length <= HTML_RECONSTRUCTION_LIBRARY_POLICY.maximumLabelCharacters),
  durationSeconds: z.number().positive().finite().nullable(), hasAudio: z.boolean().nullable(),
  sourceWidth: z.number().int().positive().max(16_384).nullable(), sourceHeight: z.number().int().positive().max(16_384).nullable(),
  timelineRole: z.enum(["AUDIO", "AVATAR", "BROLL", "MEDIA", "VISUAL", "VOICE"]),
  timelineVariant: z.enum(["CLIP", "FULL"]).nullable(),
}).strict();
export type HtmlReconstructionLibraryAsset = z.infer<typeof htmlReconstructionLibraryAssetSchema>;
export const htmlReconstructionLibraryPageSchema = z.object({scope: z.literal("CURRENT_LINKED_RECONSTRUCTION_LIBRARY_NOT_RESOURCE_GRANT"),
  organizationId: uuid, compositionId: uuid, draftId: uuid, currentDocumentHash: hash, currentVersion: version,
  afterAssetId: uuid.nullable(), assets: z.array(htmlReconstructionLibraryAssetSchema).max(HTML_RECONSTRUCTION_LIBRARY_POLICY.pageSize),
  nextAssetId: uuid.nullable(),
}).strict().superRefine((page, context) => {
  const ids = page.assets.map(asset => asset.productionAssetId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => (index ? ids[index - 1]! : page.afterAssetId ?? "") >= id)
    || (page.nextAssetId !== null && (ids.length !== HTML_RECONSTRUCTION_LIBRARY_POLICY.pageSize || page.nextAssetId !== ids.at(-1))))
    context.addIssue({code: "custom", message: "Página de recursos incoherente."});
});
export type HtmlReconstructionLibraryPage = z.infer<typeof htmlReconstructionLibraryPageSchema>;
export function matchesHtmlReconstructionLibrary(page: HtmlReconstructionLibraryPage, request: HtmlReconstructionLibraryRequest) {
  return page.organizationId === request.organizationId && page.compositionId === request.query.compositionId
    && page.draftId === request.draftId && page.afterAssetId === (request.query.afterAssetId ?? null)
    && (request.query.expectedDocumentHash === undefined || page.currentDocumentHash === request.query.expectedDocumentHash)
    && (request.query.expectedVersion === undefined || page.currentVersion === request.query.expectedVersion);
}
