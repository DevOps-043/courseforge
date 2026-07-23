import { NextResponse } from 'next/server';
import {
    getAuthenticatedUser,
    getAuthorizedArtifactAdmin,
    getAuthorizedMaterialComponentAdmin,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';
import {
    getActiveOrganizationId,
    getAuthBridgeUser,
    getUserOrganizations,
} from '@/utils/auth/session';
import { createClient } from '@/utils/supabase/server';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

const ALLOWED_BUCKETS = new Set(['thumbnails', 'production-videos', 'production-assets', 'template-bundles', 'curation-sources']);
const TEMPLATE_BUNDLE_MAX_BYTES = 10 * 1024 * 1024;
const BUNDLE_AGENT_REFERENCE_MAX_BYTES = 75 * 1024 * 1024;
const CURATION_SOURCE_PDF_MAX_BYTES = 25 * 1024 * 1024;
const GENERAL_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

type UploadPurpose = 'template-bundle' | 'production-asset' | 'thumbnail' | 'production-video' | 'bundle-agent-reference' | 'curation-source-pdf';

interface SignedUploadUrlRequestBody {
    bucket?: string;
    artifactId?: string;
    componentId?: string;
    filePath?: string;
    purpose?: UploadPurpose;
    contentType?: string;
    fileSizeBytes?: number;
    upsert?: boolean;
}

function hasUnsafePathSegment(filePath: string) {
    return (
        filePath.includes('..') ||
        filePath.includes('\\') ||
        filePath.startsWith('/') ||
        /^[a-zA-Z]:/.test(filePath) ||
        filePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment.startsWith('.'))
    );
}

function isZipContentType(contentType: string | undefined) {
    if (!contentType) return true;
    return ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(contentType);
}

function isBundleAgentReferenceContentType(contentType: string | undefined) {
    if (!contentType) return false;
    return contentType.startsWith('image/') || contentType.startsWith('video/');
}

async function ensureTemplateBundlesBucket(admin: ReturnType<typeof getServiceRoleClient>) {
    const { data: existingBucket, error: getBucketError } = await admin.storage.getBucket('template-bundles');
    if (existingBucket && !getBucketError) {
        return;
    }

    const { error: createBucketError } = await admin.storage.createBucket('template-bundles', {
        public: false,
        fileSizeLimit: TEMPLATE_BUNDLE_MAX_BYTES,
        allowedMimeTypes: [
            'application/zip',
            'application/x-zip-compressed',
            'application/octet-stream',
        ],
    });

    if (createBucketError) {
        throw new Error(`No se pudo asegurar el bucket privado template-bundles: ${createBucketError.message}`);
    }
}

async function ensureCurationSourcesBucket(admin: ReturnType<typeof getServiceRoleClient>) {
    const { data: existingBucket, error: getBucketError } = await admin.storage.getBucket('curation-sources');
    if (existingBucket && !getBucketError) {
        const { error } = await admin.storage.updateBucket('curation-sources', {
            public: false,
            fileSizeLimit: CURATION_SOURCE_PDF_MAX_BYTES,
            allowedMimeTypes: ['application/pdf'],
        });
        if (error) throw new Error(error.message);
        return;
    }

    const { error } = await admin.storage.createBucket('curation-sources', {
        public: false,
        fileSizeLimit: CURATION_SOURCE_PDF_MAX_BYTES,
        allowedMimeTypes: ['application/pdf'],
    });
    if (error) {
        throw new Error(`No se pudo asegurar el bucket privado curation-sources: ${error.message}`);
    }
}

async function resolveActiveUploadOrganizationId() {
    const tenant = await resolveActiveTenantContext();
    if (tenant?.organizationId) return tenant.organizationId;

    const activeOrgId = await getActiveOrganizationId();
    if (activeOrgId) return activeOrgId;

    const bridgeUser = await getAuthBridgeUser();
    if (bridgeUser?.active_organization_id) {
        return bridgeUser.active_organization_id;
    }

    if (Array.isArray(bridgeUser?.organization_ids) && bridgeUser.organization_ids.length > 0) {
        return bridgeUser.organization_ids[0];
    }

    const organizations = await getUserOrganizations();
    return organizations[0]?.id || null;
}

export async function POST(request: Request) {
    try {
        const {
            bucket,
            artifactId,
            componentId,
            filePath,
            purpose = 'production-asset',
            contentType,
            fileSizeBytes,
            upsert,
        } = (await request.json()) as SignedUploadUrlRequestBody;

        if (!bucket || !filePath) {
            return NextResponse.json(
                { error: 'Faltan parametros: bucket y filePath son requeridos' },
                { status: 400 },
            );
        }

        if (!ALLOWED_BUCKETS.has(bucket)) {
            return NextResponse.json({ error: 'Bucket no permitido' }, { status: 400 });
        }

        if (hasUnsafePathSegment(filePath)) {
            return NextResponse.json({ error: 'Ruta de archivo invalida' }, { status: 400 });
        }

        if (typeof fileSizeBytes === 'number' && fileSizeBytes > GENERAL_UPLOAD_MAX_BYTES) {
            return NextResponse.json(
                { error: 'El archivo supera el tamano maximo permitido' },
                { status: 400 },
            );
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const activeOrgId = await resolveActiveUploadOrganizationId();

        let authorizedFilePath = filePath;

        if (purpose === 'template-bundle') {
            if (bucket !== 'template-bundles') {
                return NextResponse.json(
                    { error: 'Los bundles de plantilla deben subirse al bucket privado template-bundles' },
                    { status: 400 },
                );
            }

            if (!activeOrgId) {
                return NextResponse.json(
                    { error: 'No se encontro organizacion activa para el upload del bundle' },
                    { status: 400 },
                );
            }

            const expectedPrefix = `organizations/${activeOrgId}/templates/`;
            if (!filePath.startsWith(expectedPrefix)) {
                return NextResponse.json(
                    { error: 'Ruta de bundle fuera del prefijo autorizado para la organizacion' },
                    { status: 400 },
                );
            }

            if (!filePath.toLowerCase().endsWith('.zip') || !isZipContentType(contentType)) {
                return NextResponse.json(
                    { error: 'El bundle debe ser un archivo .zip valido' },
                    { status: 400 },
                );
            }

            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > TEMPLATE_BUNDLE_MAX_BYTES) {
                return NextResponse.json(
                    { error: 'El bundle debe pesar entre 1 byte y 10 MB' },
                    { status: 400 },
                );
            }
        } else if (purpose === 'bundle-agent-reference') {
            if (bucket !== 'production-assets') {
                return NextResponse.json(
                    { error: 'Las referencias visuales del Bundle Agent deben subirse a production-assets' },
                    { status: 400 },
                );
            }

            if (!activeOrgId) {
                return NextResponse.json(
                    { error: 'No se encontro organizacion activa para subir la referencia visual' },
                    { status: 400 },
                );
            }

            if (!isBundleAgentReferenceContentType(contentType)) {
                return NextResponse.json(
                    { error: 'La referencia visual debe ser una imagen o video valido' },
                    { status: 400 },
                );
            }

            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > BUNDLE_AGENT_REFERENCE_MAX_BYTES) {
                return NextResponse.json(
                    { error: 'La referencia visual debe pesar entre 1 byte y 75 MB' },
                    { status: 400 },
                );
            }

            const safeRelativePath = filePath
                .replace(/^organizations\/[^/]+\/bundle-agent-references\//, '')
                .replace(/^bundle-agent-references\//, '');
            authorizedFilePath = `organizations/${activeOrgId}/bundle-agent-references/${safeRelativePath}`;
        } else if (purpose === 'curation-source-pdf') {
            if (bucket !== 'curation-sources') {
                return NextResponse.json(
                    { error: 'Las fuentes PDF deben subirse al bucket privado curation-sources' },
                    { status: 400 },
                );
            }
            if (!artifactId) {
                return NextResponse.json({ error: 'artifactId es requerido para subir una fuente PDF' }, { status: 400 });
            }
            const authorizedArtifact = await getAuthorizedArtifactAdmin(artifactId);
            if (!authorizedArtifact) {
                return NextResponse.json({ error: 'Artefacto no encontrado para esta empresa' }, { status: 404 });
            }
            if (!activeOrgId || authorizedArtifact.artifact.organization_id !== activeOrgId) {
                return NextResponse.json({ error: 'El artefacto no pertenece a la organizacion activa' }, { status: 403 });
            }
            if (contentType !== 'application/pdf' || !filePath.toLowerCase().endsWith('.pdf')) {
                return NextResponse.json({ error: 'La fuente debe ser un archivo PDF valido' }, { status: 400 });
            }
            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > CURATION_SOURCE_PDF_MAX_BYTES) {
                return NextResponse.json({ error: 'El PDF debe pesar entre 1 byte y 25 MB' }, { status: 400 });
            }
            const safeRelativePath = filePath
                .replace(/^organizations\/[^/]+\/curation-sources\/[^/]+\//, '')
                .replace(/^curation-sources\/[^/]+\//, '');
            authorizedFilePath = `organizations/${activeOrgId}/curation-sources/${artifactId}/${safeRelativePath}`;
        } else if (bucket === 'template-bundles') {
            return NextResponse.json(
                { error: 'El bucket template-bundles solo acepta uploads con purpose template-bundle' },
                { status: 400 },
            );
        } else if (bucket === 'curation-sources') {
            return NextResponse.json(
                { error: 'El bucket curation-sources solo acepta uploads con purpose curation-source-pdf' },
                { status: 400 },
            );
        }

        if (bucket === 'production-assets' && purpose !== 'bundle-agent-reference') {
            if (!componentId) {
                return NextResponse.json(
                    { error: 'componentId es requerido para subir activos de produccion' },
                    { status: 400 },
                );
            }

            const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
            if (!authorizedComponent) {
                return NextResponse.json(
                    { error: 'Componente no encontrado para esta empresa' },
                    { status: 404 },
                );
            }

            const expectedPathFragment = `${componentId}`;
            if (!filePath.includes(expectedPathFragment)) {
                return NextResponse.json(
                    { error: 'La ruta del activo no corresponde al componente autorizado' },
                    { status: 400 },
                );
            }
        }

        const admin = getServiceRoleClient();
        if (purpose === 'template-bundle') {
            await ensureTemplateBundlesBucket(admin);
        } else if (purpose === 'curation-source-pdf') {
            await ensureCurationSourcesBucket(admin);
        }

        const { data, error } = await admin.storage
            .from(bucket)
            .createSignedUploadUrl(authorizedFilePath, {
                upsert: purpose === 'template-bundle' || purpose === 'curation-source-pdf' ? false : upsert ?? true,
            });

        if (error || !data) {
            console.error('[API /storage/signed-upload-url] Error:', error);
            return NextResponse.json(
                { error: error?.message || 'No se pudo generar la URL de subida' },
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
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
