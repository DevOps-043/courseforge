import { NextResponse } from 'next/server';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';
import { buildPublicationPreview } from '@/domains/publication/lib/publication-payload';
import type { PublicationPreviewPayload } from '@/domains/publication/types/publication.types';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedArtifactAdminForTenant,
} from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

interface TestPublishRequestPayload {
    artifactId?: string;
}

export async function POST(request: Request) {
    try {
        const payload = (await request.json()) as TestPublishRequestPayload;
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
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return NextResponse.json(
                { error: 'Empresa no valida o no autorizada.' },
                { status: 403 },
            );
        }

        const authorized = await getAuthorizedArtifactAdminForTenant(
            artifactId,
            tenant,
        );
        if (!authorized) {
            return NextResponse.json(
                { error: 'Artefacto no encontrado para esta empresa.' },
                { status: 404 },
            );
        }

        const { request: publicationRequest, lessons, artifact } =
            await getPublicationData(artifactId, tenant.organizationId);

        if (!publicationRequest) {
            return NextResponse.json(
                { error: 'El borrador de publicacion no existe.' },
                { status: 400 },
            );
        }

        const previewModules = buildPublicationPreview(
            lessons,
            publicationRequest,
        );

        const previewPayload: PublicationPreviewPayload = {
            course: {
                title: artifact.title,
                slug: publicationRequest.slug,
            },
            modules: previewModules,
        };

        return NextResponse.json({
            success: true,
            message:
                'Test de envio completado. Revisa la terminal del servidor.',
            payload_preview: {
                modulesCount: previewPayload.modules.length,
                modules: previewPayload.modules,
            },
        });
    } catch (error: unknown) {
        console.error('[TEST PUBLISH] Error:', error);
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : 'Error desconocido',
            },
            { status: 500 },
        );
    }
}
