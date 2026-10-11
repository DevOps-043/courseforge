import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
    canReviewContent,
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
import { validateHyperframesMediaAsset } from '@/domains/production/hyperframes/hyperframes-media-constraints';
import {
    HYPERFRAMES_ASSET_DELIVERY_MODES,
    HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES,
} from '@/domains/production/hyperframes/hyperframes.types';
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from '@/domains/production/media-storage.config';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

const ALLOWED_BUCKETS = new Set(['thumbnails', 'production-videos', 'production-assets', HYPERFRAMES_PRIVATE_SOURCE_BUCKET, 'curation-sources']);
const BUNDLE_AGENT_REFERENCE_MAX_BYTES = 75 * 1024 * 1024;
const CURATION_SOURCE_PDF_MAX_BYTES = 25 * 1024 * 1024;
const GENERAL_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const ASSEMBLY_BRANDING_MAX_BYTES = 100 * 1024 * 1024;

const MAX_SIGNED_UPLOAD_REQUEST_BYTES = 16 * 1024;
const signedUploadUrlSchema = z.object({
    artifactId: z.string().uuid().optional(),
    bucket: z.string().trim().min(1).max(100),
    componentId: z.string().uuid().optional(),
    contentType: z.string().trim().min(1).max(200).optional(),
    filePath: z.string().trim().min(1).max(2_000).optional(),
    fileSizeBytes: z.number().int().nonnegative().max(1024 * 1024 * 1024).optional(),
    purpose: z.enum(['production-asset', 'thumbnail', 'production-video', 'bundle-agent-reference', 'curation-source-pdf', 'assembly-branding']).optional(),
    assetKind: z.enum(['INTRO', 'OUTRO']).optional(),
    upsert: z.boolean().optional(),
}).strict();

function hasUnsafePathSegment(filePath: string) {
    return (
        filePath.includes('..') ||
        filePath.includes('\\') ||
        filePath.startsWith('/') ||
        /^[a-zA-Z]:/.test(filePath) ||
        filePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment.startsWith('.'))
    );
}

function isBundleAgentReferenceContentType(contentType: string | undefined) {
    if (!contentType) return false;
    return contentType.startsWith('image/') || contentType.startsWith('video/');
}

function isHyperframesProductionMediaPath(filePath: string, contentType: string | undefined) {
    if (/^(audio|image|video)\//i.test(contentType || '')) return true;
    return /^(avatars|broll|music|voices)\//i.test(filePath);
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
    const requestId = resolveCorrelationId(request.headers.get('x-request-id'));
    const logger = createOperationalLogger('storage.signed_upload_url', { correlationId: requestId });
    const invalid = (message: string) => apiErrorResponse({
        code: API_ERROR_CODE.invalidRequest,
        message,
        requestId,
        status: 400,
    });
    try {
        const parsedRequest = await parseJsonRequest(request, signedUploadUrlSchema, MAX_SIGNED_UPLOAD_REQUEST_BYTES);
        if (!parsedRequest.success) {
            return apiErrorResponse({
                code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
                message: parsedRequest.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'Solicitud de subida inválida.',
                requestId,
                status: parsedRequest.reason === 'too_large' ? 413 : 400,
            });
        }
        const {
            bucket,
            artifactId,
            componentId,
            filePath,
            purpose = 'production-asset',
            contentType,
            fileSizeBytes,
            upsert,
            assetKind,
        } = parsedRequest.data;

        if (!ALLOWED_BUCKETS.has(bucket)) {
            return invalid('Bucket no permitido.');
        }

        if (!filePath && purpose !== 'assembly-branding') {
            return invalid('Ruta de archivo requerida.');
        }

        if (filePath && hasUnsafePathSegment(filePath)) {
            return invalid('Ruta de archivo inválida.');
        }

        const uploadLimit = bucket === 'production-assets'
            || bucket === 'production-videos'
            || bucket === HYPERFRAMES_PRIVATE_SOURCE_BUCKET
            ? HYPERFRAMES_REMOTE_VIDEO_LIMIT_BYTES
            : GENERAL_UPLOAD_MAX_BYTES;
        if (typeof fileSizeBytes === 'number' && fileSizeBytes > uploadLimit) {
            return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El archivo supera el tamaño máximo permitido.', requestId, status: 413 });
        }

        if (
            (bucket === 'production-assets' || bucket === HYPERFRAMES_PRIVATE_SOURCE_BUCKET)
            && purpose === 'production-asset'
            && isHyperframesProductionMediaPath(filePath!, contentType)
        ) {
            const mediaValidation = validateHyperframesMediaAsset({
                deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
                fileName: filePath,
                fileSizeBytes,
                mimeType: contentType,
            });
            if (!mediaValidation.valid) {
                return invalid(mediaValidation.errors.join(' '));
            }
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId, status: 401 });
        }

        const activeOrgId = await resolveActiveUploadOrganizationId();

        let authorizedFilePath = filePath || '';

        if (purpose === 'assembly-branding') {
            const tenant = await resolveActiveTenantContext();
            if (!tenant || tenant.organizationId !== activeOrgId) {
                return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'No se encontró una organización activa válida.', requestId, status: 403 });
            }
            if (!(await canReviewContent(authenticatedUser.userId, tenant))) {
                return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: 'No tienes permisos para configurar identidad de ensamble.', requestId, status: 403 });
            }
            if (bucket !== 'production-assets' || !assetKind) {
                return invalid('La identidad de ensamble requiere bucket y tipo válidos.');
            }
            if (!new Set(['video/mp4', 'video/webm']).has(contentType || '')) {
                return invalid('La identidad de ensamble debe ser un video MP4 o WebM.');
            }
            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > ASSEMBLY_BRANDING_MAX_BYTES) {
                return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El video debe pesar entre 1 byte y 100 MB.', requestId, status: 413 });
            }
            const extension = contentType === 'video/webm' ? 'webm' : 'mp4';
            authorizedFilePath = `assembly-branding/${tenant.organizationId}/${assetKind.toLowerCase()}/${randomUUID()}.${extension}`;
        } else if (purpose === 'bundle-agent-reference') {
            if (bucket !== 'production-assets') {
                return invalid('Las referencias visuales del Bundle Agent deben subirse a production-assets.');
            }

            if (!activeOrgId) {
                return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'No se encontró una organización activa para subir la referencia visual.', requestId, status: 403 });
            }

            if (!isBundleAgentReferenceContentType(contentType)) {
                return invalid('La referencia visual debe ser una imagen o video válido.');
            }

            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > BUNDLE_AGENT_REFERENCE_MAX_BYTES) {
                return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'La referencia visual debe pesar entre 1 byte y 75 MB.', requestId, status: 413 });
            }

            const safeRelativePath = authorizedFilePath
                .replace(/^organizations\/[^/]+\/bundle-agent-references\//, '')
                .replace(/^bundle-agent-references\//, '');
            authorizedFilePath = `organizations/${activeOrgId}/bundle-agent-references/${safeRelativePath}`;
        } else if (purpose === 'curation-source-pdf') {
            if (bucket !== 'curation-sources') {
                return invalid('Las fuentes PDF deben subirse al bucket privado curation-sources.');
            }
            if (!artifactId) {
                return invalid('artifactId es requerido para subir una fuente PDF.');
            }
            const authorizedArtifact = await getAuthorizedArtifactAdmin(artifactId);
            if (!authorizedArtifact) {
                return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Artefacto no encontrado para esta empresa.', requestId, status: 404 });
            }
            if (!activeOrgId || authorizedArtifact.artifact.organization_id !== activeOrgId) {
                return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'El artefacto no pertenece a la organización activa.', requestId, status: 403 });
            }
            if (contentType !== 'application/pdf' || !authorizedFilePath.toLowerCase().endsWith('.pdf')) {
                return invalid('La fuente debe ser un archivo PDF válido.');
            }
            if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0 || fileSizeBytes > CURATION_SOURCE_PDF_MAX_BYTES) {
                return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El PDF debe pesar entre 1 byte y 25 MB.', requestId, status: 413 });
            }
            const safeRelativePath = authorizedFilePath
                .replace(/^organizations\/[^/]+\/curation-sources\/[^/]+\//, '')
                .replace(/^curation-sources\/[^/]+\//, '');
            authorizedFilePath = `organizations/${activeOrgId}/curation-sources/${artifactId}/${safeRelativePath}`;
        } else if (bucket === 'template-bundles') {
            return invalid('El bucket template-bundles solo acepta cargas con purpose template-bundle.');
        } else if (bucket === 'curation-sources') {
            return invalid('El bucket curation-sources solo acepta cargas con purpose curation-source-pdf.');
        }

        if (
            (bucket === 'production-assets' || bucket === HYPERFRAMES_PRIVATE_SOURCE_BUCKET)
            && purpose !== 'bundle-agent-reference'
            && purpose !== 'assembly-branding'
        ) {
            if (!componentId) {
                return invalid('componentId es requerido para subir activos de producción.');
            }

            const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
            if (!authorizedComponent) {
                return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Componente no encontrado para esta empresa.', requestId, status: 404 });
            }

            const belongsToComponent = bucket === HYPERFRAMES_PRIVATE_SOURCE_BUCKET
                ? isPrivateRenderSourcePath(authorizedFilePath, componentId)
                : authorizedFilePath.includes(componentId);
            if (!belongsToComponent) {
                return invalid('La ruta del activo no corresponde al componente autorizado.');
            }
        }

        const admin = getServiceRoleClient();
        if (purpose === 'curation-source-pdf') {
            await ensureCurationSourcesBucket(admin);
        }

        const { data, error } = await admin.storage
            .from(bucket)
            .createSignedUploadUrl(authorizedFilePath, {
                upsert: authorizedFilePath.startsWith('media/') || purpose === 'curation-source-pdf' || purpose === 'assembly-branding'
                    ? false
                    : upsert ?? true,
            });

        if (error || !data) {
            logger.error('storage.signed_upload_url.create_failed', error, { bucket });
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo generar la URL de subida.', requestId, retryable: true, status: 500 });
        }

        return apiSuccessResponse({
            signedUrl: data.signedUrl,
            token: data.token,
            path: data.path,
        }, { requestId });
    } catch (error: unknown) {
        logger.error('storage.signed_upload_url.failed', error);
        return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo preparar la subida.', requestId, retryable: true, status: 500 });
    }
}

function isPrivateRenderSourcePath(filePath: string, componentId: string) {
    const [folder, fileName, ...extra] = filePath.split('/');
    return extra.length === 0
        && new Set(['avatars', 'broll', 'music', 'voices', 'media']).has(folder || '')
        && Boolean(fileName?.startsWith(`${componentId}-`));
}
