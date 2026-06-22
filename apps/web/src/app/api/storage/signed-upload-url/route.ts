import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServiceRoleClient } from '@/lib/server/artifact-action-auth';
import {
    getActiveOrganizationId,
    getAuthBridgeUser,
    getUserOrganizations,
} from '@/utils/auth/session';
import { createClient } from '@/utils/supabase/server';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

const ALLOWED_BUCKETS = new Set(['thumbnails', 'production-videos', 'production-assets', 'template-bundles']);
const TEMPLATE_BUNDLE_MAX_BYTES = 10 * 1024 * 1024;
const GENERAL_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

type UploadPurpose = 'template-bundle' | 'production-asset' | 'thumbnail' | 'production-video';

interface SignedUploadUrlRequestBody {
    bucket?: string;
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
        } else if (bucket === 'template-bundles') {
            return NextResponse.json(
                { error: 'El bucket template-bundles solo acepta uploads con purpose template-bundle' },
                { status: 400 },
            );
        }

        const admin = getServiceRoleClient();
        if (purpose === 'template-bundle') {
            await ensureTemplateBundlesBucket(admin);
        }

        const { data, error } = await admin.storage
            .from(bucket)
            .createSignedUploadUrl(filePath, { upsert: purpose === 'template-bundle' ? false : upsert ?? true });

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
