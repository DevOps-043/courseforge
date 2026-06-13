import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import { ArtlistService } from '@/domains/production/providers/artlist.service';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q') || '';
        const type = searchParams.get('type') as 'music' | 'video';

        if (!type || (type !== 'music' && type !== 'video')) {
            return NextResponse.json(
                { error: 'El parámetro "type" es requerido y debe ser "music" o "video"' },
                { status: 400 },
            );
        }

        // Authenticate User
        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const artlistService = new ArtlistService();
        const results = await artlistService.search(query, type);

        return NextResponse.json({
            success: true,
            results,
        });

    } catch (error: unknown) {
        console.error('[API /artlist/search] Unexpected error:', error);
        return NextResponse.json(
            { error: 'Error interno del servidor al buscar en Artlist' },
            { status: 500 },
        );
    }
}
