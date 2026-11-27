import { z } from 'zod';
import { engineSessionTemplateSchema } from '../../course-delivery/types/engine-preparation.contract';
import { ENGINE_PREPARATION_MAX_BYTES } from '../../course-delivery/types/engine-session-documents.contract';
import {
  HYBRID_PUBLICATION_LIMITS,
  hybridPublicationRouteFields,
  validateHybridPublicationRoute,
} from './hybrid-publication-route';

export const HYBRID_ASSET_MAX_BYTES = 25 * 1024 * 1024;
const MAX_PACKAGE_ASSET_BYTES = 250 * 1024 * 1024;
const MAX_ASSETS = 256;
const uuid = z.string().uuid();
export const HYBRID_ASSET_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
] as const;
export const hybridPublicationAssetSchema = z.object({
  id: uuid.refine(value => value === value.toLowerCase(), 'El ID del archivo debe estar en minúsculas.'),
  mime: z.enum(HYBRID_ASSET_MIME_TYPES),
  bytes: z.number().int().min(1).max(HYBRID_ASSET_MAX_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HybridPublicationAsset = z.infer<typeof hybridPublicationAssetSchema>;

export const hybridPublicationPreparationFields = hybridPublicationRouteFields.extend({
  session_preparations: z.array(z.object({
    session_id: uuid,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    template: engineSessionTemplateSchema,
  }).strict()).min(1).max(HYBRID_PUBLICATION_LIMITS.sessions),
  assets: z.array(hybridPublicationAssetSchema).max(MAX_ASSETS),
});

type PreparationFields = z.infer<typeof hybridPublicationPreparationFields>;

export function validateHybridPublicationPreparation(
  publication: PreparationFields,
  context: z.RefinementCtx,
  additionalAssetIds: readonly string[],
) {
  validateHybridPublicationRoute(publication, context);
  const { delivery, session_preparations, assets } = publication;

  const sessions = new Map(delivery.sessions.map(session => [session.session_id, session]));
  const missing = new Set(sessions.keys());
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const remainingAssets = new Set(assetsById.keys());
  if (assetsById.size !== assets.length || assets.reduce((sum, asset) => sum + asset.bytes, 0) > MAX_PACKAGE_ASSET_BYTES) {
    context.addIssue({ code: 'custom', path: ['assets'], message: 'Los archivos repiten identidad o superan la cuota del paquete.' });
  }
  const encoder = new TextEncoder();
  for (const [index, { session_id, revision, template }] of session_preparations.entries()) {
    const session = sessions.get(session_id);
    if (!missing.delete(session_id) || session?.preparation_revision !== revision || session.minutes !== template.preparation.minutes) {
      context.addIssue({ code: 'custom', path: ['session_preparations', index], message: 'La plantilla debe corresponder a la sesión, revisión y duración del recorrido.' });
    }
    if (encoder.encode(JSON.stringify(template)).byteLength > ENGINE_PREPARATION_MAX_BYTES) {
      context.addIssue({ code: 'custom', path: ['session_preparations', index], message: 'La plantilla supera el límite de preparación.' });
    }
    const references = [...template.scenes.map(scene => scene.asset_id), ...template.materials.map(material => material.asset_id)];
    for (const assetId of references) {
      if (!assetId) continue;
      if (!assetsById.has(assetId)) {
        context.addIssue({ code: 'custom', path: ['session_preparations', index], message: 'La plantilla refiere un archivo ajeno al paquete.' });
      }
      remainingAssets.delete(assetId);
    }
    for (const scene of template.scenes) {
      if ((scene.kind === 'image' || scene.kind === 'video') &&
        (!scene.asset_id || !assetsById.get(scene.asset_id)?.mime.startsWith(scene.kind + '/'))) {
        context.addIssue({ code: 'custom', path: ['session_preparations', index, 'template', 'scenes'], message: 'La escena requiere un archivo del tipo indicado.' });
      }
    }
  }
  if (missing.size) context.addIssue({ code: 'custom', path: ['session_preparations'], message: 'Cada sesión requiere una plantilla aprobada.' });
  if (additionalAssetIds.some(assetId => !assetsById.has(assetId))) {
    context.addIssue({ code: 'custom', path: ['lessons'], message: 'La lección refiere un archivo ajeno al paquete.' });
  }
  for (const assetId of additionalAssetIds) remainingAssets.delete(assetId);
  if (remainingAssets.size) context.addIssue({ code: 'custom', path: ['assets'], message: 'Todos los archivos deben estar referenciados en el paquete.' });
}
