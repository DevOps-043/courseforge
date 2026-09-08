import { NextResponse } from 'next/server';
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

// Limit file sizes imported externally to 150MB to avoid server memory issues in serverless runtimes
const MAX_IMPORT_SIZE_BYTES = 150 * 1024 * 1024;

const IMPORT_TIMEOUT_MS = 60_000;
const importExternalSchema = z.object({
    provider: z.enum(['heygen', 'custom']),
    componentId: z.string().uuid(),
    videoId: z.string().trim().max(500).optional(),
    videoUrl: z.string().url().max(4_000).optional(),
}).strict();

export async function POST(request: Request) {
    try {
        const parsedRequest = importExternalSchema.safeParse(await request.json());
        if (!parsedRequest.success) {
            return NextResponse.json(
                { error: 'Solicitud de importación inválida' },
                { status: 400 },
            );
        }
        const { provider, componentId, videoId, videoUrl } = parsedRequest.data;

        // Authenticate User
        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
        if (!authorizedComponent) {
            return NextResponse.json(
                { error: 'Componente no encontrado para esta empresa' },
                { status: 404 },
            );
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
                    return NextResponse.json(
                        { error: 'HEYGEN_API_KEY no está configurada y no se proporcionó una URL directa del video' },
                        { status: 400 },
                    );
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
                    const errorDetails = await heygenResponse.text();
                    console.error('[API /production/import-external] Heygen API error:', errorDetails);
                    return NextResponse.json(
                        { error: 'Error al consultar la API de Heygen' },
                        { status: 500 },
                    );
                }

                const heygenData = await heygenResponse.json();
                const status = heygenData.data?.status;
                const url = heygenData.data?.video_url;

                if (status === 'failed') {
                    return NextResponse.json(
                        { error: `El video de Heygen falló al generarse: ${heygenData.data?.error?.message || 'Error desconocido'}` },
                        { status: 422 },
                    );
                }

                if (status !== 'completed' || !url) {
                    return NextResponse.json(
                        { error: 'El video de Heygen aún no está listo' },
                        { status: 202, statusText: 'Processing' },
                    );
                }

                resolvedVideoUrl = url;
            }
        }

        if (!resolvedVideoUrl) {
            return NextResponse.json(
                { error: 'No se pudo resolver la URL del video a importar' },
                { status: 400 },
            );
        }

        // 2. Reject internal networks and redirects before reading a bounded body.
        const safeUrl = await assertSafeExternalMediaUrl(resolvedVideoUrl);
        const response = await fetch(safeUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
        });
        if (!response.ok) {
            return NextResponse.json(
                { error: 'No se pudo descargar el video desde el origen externo' },
                { status: 502 },
            );
        }

        const sourceContentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['video/mp4', 'video/webm', 'application/octet-stream'].includes(sourceContentType)) {
            return NextResponse.json({ error: 'El origen no devolvió un video compatible' }, { status: 415 });
        }

        let buffer: Buffer;
        try {
            buffer = await readResponseWithLimit(response, MAX_IMPORT_SIZE_BYTES);
        } catch (error) {
            if (error instanceof Error && error.message === 'EXTERNAL_MEDIA_TOO_LARGE') {
                return NextResponse.json(
                    { error: 'El archivo excede el límite permitido para transferencia directa (150MB)' },
                    { status: 413 },
                );
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
            console.error('[API /production/import-external] Storage upload error:', uploadError);
            return NextResponse.json(
                { error: 'No se pudo subir el archivo al almacenamiento de SofLIA - Engine' },
                { status: 500 },
            );
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
            console.error('[API /production/import-external] DB update error:', updateError);
            return NextResponse.json(
                { error: 'No se pudo guardar la referencia del video en la base de datos' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            publicUrl,
            storagePath,
            assets: updatedAssets,
        });

    } catch (error: unknown) {
        console.error('[API /production/import-external] Unexpected error:', error);
        return NextResponse.json(
            { error: 'Error interno del servidor durante la importación' },
            { status: 500 },
        );
    }
}
