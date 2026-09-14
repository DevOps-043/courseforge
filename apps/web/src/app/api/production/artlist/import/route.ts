import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedMaterialComponentAdmin,
} from '@/lib/server/artifact-action-auth';
import { ArtlistService } from '@/domains/production/providers/artlist.service';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { mapExternalImportError } from '@/lib/server/external-import-error';
import { withExternalImportCapacity } from '@/lib/server/external-import-concurrency';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

const MAX_ARTLIST_IMPORT_REQUEST_BYTES = 16 * 1024;
const artlistImportSchema = z.object({
    assetId: z.string().trim().min(1).max(500),
    componentId: z.string().uuid(),
    type: z.enum(['music', 'video']),
}).strict();

export async function POST(request: Request) {
    const requestId = resolveCorrelationId(request.headers.get('x-request-id'));
    const logger = createOperationalLogger('production.artlist.import', { correlationId: requestId });
    try {
        const parsedRequest = await parseJsonRequest(request, artlistImportSchema, MAX_ARTLIST_IMPORT_REQUEST_BYTES);
        if (!parsedRequest.success) {
            return apiErrorResponse({
                code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
                message: parsedRequest.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'Solicitud de importación inválida.',
                requestId,
                status: parsedRequest.reason === 'too_large' ? 413 : 400,
            });
        }
        const { assetId, type, componentId } = parsedRequest.data;

        // Authenticate User
        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId, status: 401 });
        }

        const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
        if (!authorizedComponent) {
            return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Componente no encontrado para esta empresa.', requestId, status: 404 });
        }

        const admin = authorizedComponent.admin;

        // Call Artlist Service to download and upload file
        const artlistService = new ArtlistService();
        const result = await withExternalImportCapacity(
            'artlist',
            () => artlistService.importAsset(assetId, type, componentId),
            request.signal,
        );

        const currentAssets = authorizedComponent.component.assets || {};
        const assetsPatch: Record<string, unknown> = {};

        if (type === 'music') {
            assetsPatch.background_music = {
                storage_path: result.storagePath,
                public_url: result.publicUrl,
                file_name: result.fileName,
                duration: result.duration,
                volume_multiplier: currentAssets.background_music?.volume_multiplier ?? 0.15,
            };
        } else {
            const currentClips = Array.isArray(currentAssets.b_roll_clips) ? currentAssets.b_roll_clips : [];
            const newClip = {
                id: assetId,
                storage_path: result.storagePath,
                public_url: result.publicUrl,
                file_name: result.fileName,
                duration: result.duration,
                order: currentClips.length + 1,
            };
            assetsPatch.b_roll_clips = [...currentClips, newClip];
        }

        assetsPatch.updated_at = new Date().toISOString();

        const { data: updatedAssets, error: updateError } = await admin.rpc(
            'patch_material_component_assets',
            { p_component_id: componentId, p_assets_patch: assetsPatch },
        );

        if (updateError) {
            logger.error('production.artlist.import.persistence_failed', updateError, { componentId });
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo guardar el recurso importado.', requestId, retryable: true, status: 500 });
        }

        return apiSuccessResponse({
            publicUrl: result.publicUrl,
            storagePath: result.storagePath,
            assets: updatedAssets,
        }, { requestId });

    } catch (error: unknown) {
        logger.error('production.artlist.import.failed', error);
        const mapped = mapExternalImportError(error, 'Artlist');
        return apiErrorResponse({
            ...mapped,
            headers: mapped.retryAfterSeconds ? { 'Retry-After': String(mapped.retryAfterSeconds) } : undefined,
            requestId,
        });
    }
}
