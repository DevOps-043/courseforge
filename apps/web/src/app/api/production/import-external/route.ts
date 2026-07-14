import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedMaterialComponentAdmin,
} from '@/lib/server/artifact-action-auth';

// Limit file sizes imported externally to 150MB to avoid server memory issues in serverless runtimes
const MAX_IMPORT_SIZE_BYTES = 150 * 1024 * 1024;

interface ImportExternalRequestBody {
    provider: 'heygen' | 'custom';
    componentId?: string;
    videoId?: string;      // Used for Heygen API status query
    videoUrl?: string;     // Direct URL if provided
}

export async function POST(request: Request) {
    try {
        const { provider, componentId, videoId, videoUrl } = (await request.json()) as ImportExternalRequestBody;

        if (!provider || !componentId) {
            return NextResponse.json(
                { error: 'Faltan parámetros: provider y componentId son requeridos' },
                { status: 400 },
            );
        }

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
                const heygenResponse = await fetch(`https://api.heygen.com/v2/video_status/${videoId}`, {
                    headers: {
                        'accept': 'application/json',
                        'X-Api-Key': heygenApiKey,
                    },
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

        // 2. Fetch the video from CDN in chunk/stream or ArrayBuffer
        const response = await fetch(resolvedVideoUrl);
        if (!response.ok) {
            return NextResponse.json(
                { error: 'No se pudo descargar el video desde el origen externo' },
                { status: 502 },
            );
        }

        const contentLengthHeader = response.headers.get('content-length');
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

        if (contentLength > MAX_IMPORT_SIZE_BYTES) {
            return NextResponse.json(
                { error: 'El archivo excede el límite permitido para transferencia directa (150MB)' },
                { status: 413 },
            );
        }

        // Read into buffer (Memory safe up to 150MB limit)
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 3. Upload to Supabase Storage
        const fileExt = 'mp4';
        const storagePath = `avatars/${componentId}-avatar.${fileExt}`;

        const { error: uploadError } = await admin.storage
            .from('production-assets')
            .upload(storagePath, buffer, {
                contentType: 'video/mp4',
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
        const updatedAssets = {
            ...currentAssets,
            avatar_video: {
                provider,
                external_id: videoId || null,
                sync_status: 'COMPLETED',
                public_url: publicUrl,
                storage_path: `production-assets/${storagePath}`,
                duration: currentAssets.video_duration || undefined, // Maintain duration if known
            },
            // Fallback for retrocompatibility: also set the direct final video URL
            final_video_url: publicUrl,
            final_video_source: 'upload',
            updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await admin
            .from('material_components')
            .update({ assets: updatedAssets })
            .eq('id', componentId);

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
