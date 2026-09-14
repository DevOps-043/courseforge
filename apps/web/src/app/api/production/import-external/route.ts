import { PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS } from '@/domains/production/media-storage.config';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedMaterialComponentAdmin,
} from '@/lib/server/artifact-action-auth';
import { z } from 'zod';
import {
    assertSafeExternalMediaUrl,
    readResponseWithLimit,
} from '@/domains/production/external-media-import-policy';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { mapExternalImportError } from '@/lib/server/external-import-error';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';
import { readJsonResponseWithLimit } from '@/lib/server/outbound-http';

// Limit file sizes imported externally to 150MB to avoid server memory issues in serverless runtimes
const MAX_IMPORT_SIZE_BYTES = 150 * 1024 * 1024;

const IMPORT_TIMEOUT_MS = 60_000;
const MAX_EXTERNAL_IMPORT_REQUEST_BYTES = 16 * 1024;
const MAX_HEYGEN_STATUS_BYTES = 256 * 1024;
const importExternalSchema = z.object({
    provider: z.enum(['heygen', 'custom']),
    componentId: z.string().uuid(),
    videoId: z.string().trim().max(500).optional(),
    videoUrl: z.string().url().max(4_000).optional(),
}).strict();

export async function POST(request: Request) {
    const requestId = resolveCorrelationId(request.headers.get('x-request-id'));
    const logger = createOperationalLogger('production.external_media.import', { correlationId: requestId });
    try {
        const parsedRequest = await parseJsonRequest(request, importExternalSchema, MAX_EXTERNAL_IMPORT_REQUEST_BYTES);
        if (!parsedRequest.success) {
            return apiErrorResponse({
                code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
                message: parsedRequest.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'Solicitud de importación inválida.',
                requestId,
                status: parsedRequest.reason === 'too_large' ? 413 : 400,
            });
        }
        const { provider, componentId, videoId, videoUrl } = parsedRequest.data;

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

        // 1. Resolve source video URL (Heygen API or direct URL)
        let resolvedVideoUrl = videoUrl || '';

        // If videoId is a direct URL, treat it as videoUrl
        if (videoId && (videoId.startsWith('http://') || videoId.startsWith('https://'))) {
            resolvedVideoUrl = videoId;
        }

        if (provider === 'heygen' && videoId && resolvedVideoUrl !== videoId) {
            const heygenApiKey = process.env.HEYGEN_API_KEY;
            if (!heygenApiKey) {
                // If no API Key, we must rely on a direct videoUrl provided by frontend
                if (!resolvedVideoUrl) {
                    return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'Se requiere una URL directa para importar este video.', requestId, status: 400 });
                }
            } else {
                // Fetch direct download URL from Heygen API
                const heygenResponse = await fetch(`https://api.heygen.com/v2/video_status/${encodeURIComponent(videoId)}`, {
                    headers: {
                        'accept': 'application/json',
                        'X-Api-Key': heygenApiKey,
                    },
                    signal: AbortSignal.timeout(15_000),
                });

                if (!heygenResponse.ok) {
                    logger.warn('production.external_media.heygen_lookup_failed', { status: heygenResponse.status });
                    return apiErrorResponse({ code: API_ERROR_CODE.providerError, message: 'No se pudo consultar el video en HeyGen.', requestId, retryable: heygenResponse.status >= 500 || heygenResponse.status === 429, status: 502 });
                }

                const heygenData = await readJsonResponseWithLimit<unknown>(
                    heygenResponse,
                    MAX_HEYGEN_STATUS_BYTES,
                );
                const data = typeof heygenData === 'object' && heygenData !== null && 'data' in heygenData
                    && typeof heygenData.data === 'object' && heygenData.data !== null
                    ? heygenData.data as Record<string, unknown>
                    : null;
                const status = typeof data?.status === 'string' ? data.status : undefined;
                const url = typeof data?.video_url === 'string' ? data.video_url : undefined;

                if (status === 'failed') {
                    return apiErrorResponse({ code: API_ERROR_CODE.providerError, message: 'HeyGen informó que el video no pudo generarse.', requestId, status: 422 });
                }

                if (status !== 'completed' || !url) {
                    return apiSuccessResponse({ pending: true, message: 'El video de HeyGen aún no está listo.' }, { requestId, status: 202 });
                }

                resolvedVideoUrl = url;
            }
        }

        if (!resolvedVideoUrl) {
            return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'No se pudo resolver la URL del video a importar.', requestId, status: 400 });
        }

        // 2. Reject internal networks and redirects before reading a bounded body.
        const safeUrl = await assertSafeExternalMediaUrl(resolvedVideoUrl);
        const response = await fetch(safeUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
        });
        if (!response.ok) {
            return apiErrorResponse({ code: API_ERROR_CODE.providerError, message: 'No se pudo descargar el video desde el origen externo.', requestId, retryable: response.status >= 500 || response.status === 429, status: 502 });
        }

        const sourceContentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(sourceContentType)) {
            return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: 'El origen no devolvió un video compatible.', requestId, status: 415 });
        }

        let buffer: Buffer;
        try {
            buffer = await readResponseWithLimit(response, MAX_IMPORT_SIZE_BYTES);
        } catch (error) {
            if (error instanceof Error && error.message === 'EXTERNAL_MEDIA_TOO_LARGE') {
                return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El archivo excede el límite permitido para transferencia directa (150 MB).', requestId, status: 413 });
            }
            throw error;
        }

        // 3. Upload to Supabase Storage
        const fileExt = sourceContentType === 'video/webm' ? 'webm' : 'mp4';
        const storagePath = `avatars/${componentId}-avatar.${fileExt}`;

        const { error: uploadError } = await admin.storage
            .from('production-assets')
            .upload(storagePath, buffer, {
                cacheControl: String(PRODUCTION_MEDIA_CACHE_CONTROL_SECONDS),
                contentType: fileExt === 'webm' ? 'video/webm' : 'video/mp4',
                upsert: true,
            });

        if (uploadError) {
            logger.error('production.external_media.storage_failed', uploadError, { componentId });
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo almacenar el video importado.', requestId, retryable: true, status: 500 });
        }

        // Resolve public URL
        const { data: { publicUrl } } = admin.storage
            .from('production-assets')
            .getPublicUrl(storagePath);

        // 4. Update the material component database record
        const currentAssets = authorizedComponent.component.assets || {};
        const assetsPatch = {
            avatar_video: {
                provider,
                external_id: videoId || null,
                sync_status: 'COMPLETED',
                public_url: publicUrl,
                storage_path: `production-assets/${storagePath}`,
                file_name: videoId ? `${provider}-${videoId}.${fileExt}` : `${provider}-video.${fileExt}`,
                has_audio: true,
                duration: currentAssets.video_duration || undefined, // Maintain duration if known
            },
            // Fallback for retrocompatibility: also set the direct final video URL
            final_video_url: publicUrl,
            final_video_source: 'upload',
            final_video_file_name: videoId ? `${provider}-${videoId}.${fileExt}` : `${provider}-video.${fileExt}`,
            final_video_storage_path: `production-assets/${storagePath}`,
            updated_at: new Date().toISOString(),
        };

        const { data: updatedAssets, error: updateError } = await admin.rpc(
            'patch_material_component_assets',
            { p_component_id: componentId, p_assets_patch: assetsPatch },
        );

        if (updateError) {
            logger.error('production.external_media.persistence_failed', updateError, { componentId });
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo guardar la referencia del video.', requestId, retryable: true, status: 500 });
        }

        return apiSuccessResponse({
            publicUrl,
            storagePath,
            assets: updatedAssets,
        }, { requestId });

    } catch (error: unknown) {
        logger.error('production.external_media.import_failed', error);
        const mapped = mapExternalImportError(error, 'el origen externo');
        return apiErrorResponse({ ...mapped, requestId });
    }
}
