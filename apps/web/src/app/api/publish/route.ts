import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';
import { buildPublicationPayload } from '@/domains/publication/lib/publication-payload';
import { getSofliaInboxEnv } from '@/lib/server/env';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';

interface PublishRequestPayload {
    artifactId?: string;
}

export async function POST(request: Request) {
    try {
        const payload = (await request.json()) as PublishRequestPayload;
        const artifactId = payload.artifactId;

        if (!artifactId) {
            return NextResponse.json(
                { error: 'Falta artifactId' },
                { status: 400 },
            );
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);

        if (!authenticatedUser) {
            return NextResponse.json(
                { error: 'No autorizado.' },
                { status: 401 },
            );
        }

        const admin = getServiceRoleClient();
        const { data: profile } = await admin
            .from('profiles')
            .select('platform_role')
            .eq('id', authenticatedUser.userId)
            .maybeSingle();

        if (profile?.platform_role === 'CONSTRUCTOR') {
            return NextResponse.json(
                {
                    error: 'Falta de permisos. Solo Arquitectos y Admins pueden publicar.',
                },
                { status: 403 },
            );
        }

        const { request: publicationRequest, lessons, artifact, materialsPackage } =
            await getPublicationData(artifactId);

        if (!publicationRequest || publicationRequest.status !== 'READY') {
            return NextResponse.json(
                {
                    error:
                        "El curso no esta en estado 'READY' para publicar. Guarda el borrador primero.",
                },
                { status: 400 },
            );
        }

        const inboxEnv = getSofliaInboxEnv();
        const payloadToSend = buildPublicationPayload({
            artifactId,
            artifact,
            lessons,
            materialsPackage,
            request: publicationRequest,
        });

        const sofliaSupabase = createSupabaseClient(inboxEnv.url, inboxEnv.key);
        const { error: inboxError } = await sofliaSupabase
            .from('courseengine_inbox')
            .upsert(
                {
                    course_slug: publicationRequest.slug,
                    payload: payloadToSend,
                    status: 'pending',
                    error_message: null,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'course_slug' },
            );

        if (inboxError) {
            throw new Error(
                `Error depositando en buzon de Soflia: ${inboxError.message}`,
            );
        }

        const { error: updateError } = await admin
            .from('publication_requests')
            .update({
                status: 'SENT',
                updated_at: new Date().toISOString(),
            })
            .eq('id', publicationRequest.id);

        if (updateError) {
            console.error(
                '[API /publish] Error updating local status:',
                updateError,
            );
        }

        return NextResponse.json({
            success: true,
            message:
                'Curso depositado en buzon de Soflia. Sera procesado en los proximos 5 minutos.',
        });
    } catch (error: unknown) {
        console.error('[API /publish] Route Error:', error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : 'Error desconocido al publicar',
            },
            { status: 500 },
        );
    }
}
