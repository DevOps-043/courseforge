import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';

// Only these buckets are allowed — prevents unauthorized access to other storage
const ALLOWED_BUCKETS = new Set(['thumbnails', 'production-videos']);

interface SignedUploadUrlRequestBody {
    bucket?: string;
    filePath?: string;
}

export async function POST(request: Request) {
    try {
        const { bucket, filePath } = (await request.json()) as SignedUploadUrlRequestBody;

        if (!bucket || !filePath) {
            return NextResponse.json(
                { error: 'Faltan parámetros: bucket y filePath son requeridos' },
                { status: 400 },
            );
        }

        if (!ALLOWED_BUCKETS.has(bucket)) {
            return NextResponse.json(
                { error: 'Bucket no permitido' },
                { status: 400 },
            );
        }

        // Prevent path traversal
        if (filePath.includes('..') || filePath.startsWith('/')) {
            return NextResponse.json(
                { error: 'Ruta de archivo inválida' },
                { status: 400 },
            );
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const admin = getServiceRoleClient();
        const { data, error } = await admin.storage
            .from(bucket)
            .createSignedUploadUrl(filePath);

        if (error || !data) {
            console.error('[API /storage/signed-upload-url] Error:', error);
            return NextResponse.json(
                { error: 'No se pudo generar la URL de subida' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            signedUrl: data.signedUrl,
            token: data.token,
            path: data.path,
        });
    } catch (error: unknown) {
        console.error('[API /storage/signed-upload-url] Unexpected error:', error);
        return NextResponse.json(
            { error: 'Error interno del servidor' },
            { status: 500 },
        );
    }
}
