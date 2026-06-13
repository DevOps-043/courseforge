import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getAuthenticatedUser, getServiceRoleClient } from '@/lib/server/artifact-action-auth';
import { ArtlistService } from '@/domains/production/providers/artlist.service';

interface ImportRequestBody {
    assetId?: string;
    type?: 'music' | 'video';
    componentId?: string;
}

export async function POST(request: Request) {
    try {
        const { assetId, type, componentId } = await request.json() as ImportRequestBody;

        if (!assetId || !type || !componentId) {
            return NextResponse.json(
                { error: 'Faltan parámetros: assetId, type y componentId son requeridos' },
                { status: 400 },
            );
        }

        if (type !== 'music' && type !== 'video') {
            return NextResponse.json(
                { error: 'El tipo debe ser "music" o "video"' },
                { status: 400 },
            );
        }

        // Authenticate User
        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const admin = getServiceRoleClient();

        // Call Artlist Service to download and upload file
        const artlistService = new ArtlistService();
        const result = await artlistService.importAsset(assetId, type, componentId);

        // Fetch current component assets
        const { data: component, error: fetchError } = await admin
            .from('material_components')
            .select('assets')
            .eq('id', componentId)
            .single();

        if (fetchError || !component) {
            return NextResponse.json(
                { error: 'Componente no encontrado' },
                { status: 404 },
            );
        }

        const currentAssets = component.assets || {};
        const updatedAssets = { ...currentAssets };

        if (type === 'music') {
            updatedAssets.background_music = {
                storage_path: result.storagePath,
                public_url: result.publicUrl,
                duration: result.duration,
                volume_multiplier: currentAssets.background_music?.volume_multiplier ?? 0.15,
            };
        } else {
            const currentClips = Array.isArray(currentAssets.b_roll_clips) ? currentAssets.b_roll_clips : [];
            const newClip = {
                id: assetId,
                storage_path: result.storagePath,
                public_url: result.publicUrl,
                duration: result.duration,
                order: currentClips.length + 1,
            };
            updatedAssets.b_roll_clips = [...currentClips, newClip];
        }

        updatedAssets.updated_at = new Date().toISOString();

        // Update component assets in DB
        const { error: updateError } = await admin
            .from('material_components')
            .update({ assets: updatedAssets })
            .eq('id', componentId);

        if (updateError) {
            console.error('[API /artlist/import] DB update error:', updateError);
            return NextResponse.json(
                { error: 'No se pudo actualizar el registro del componente en la base de datos' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            publicUrl: result.publicUrl,
            storagePath: result.storagePath,
            assets: updatedAssets,
        });

    } catch (error: unknown) {
        console.error('[API /artlist/import] Unexpected error:', error);
        return NextResponse.json(
            { error: getErrorMessage(error) },
            { status: 500 },
        );
    }
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'Error interno del servidor al importar el asset de Artlist';
}
