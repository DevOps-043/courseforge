import { NextResponse } from 'next/server';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';
import { buildPublicationPreview } from '@/domains/publication/lib/publication-payload';
import type { PublicationPreviewPayload } from '@/domains/publication/types/publication.types';

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

        const { request: publicationRequest, lessons, artifact } =
            await getPublicationData(artifactId);

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
