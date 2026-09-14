import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { savePublicationDraftRequestSchema } from '@/domains/publication/publication.schemas';
import {
    getAuthenticatedUser,
    getAuthorizedArtifactAdminForTenant,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

const MAX_SAVE_DRAFT_REQUEST_BYTES = 1024 * 1024;

export async function POST(request: Request) {
    const requestId = resolveCorrelationId(request.headers.get('x-request-id'));
    const logger = createOperationalLogger('publication.draft.api', { correlationId: requestId });
    try {
        const parsedRequest = await parseJsonRequest(request, savePublicationDraftRequestSchema, MAX_SAVE_DRAFT_REQUEST_BYTES);
        if (!parsedRequest.success) {
            return apiErrorResponse({
                code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
                message: parsedRequest.reason === 'too_large' ? 'El borrador excede el tamaño permitido.' : 'Borrador de publicación inválido.',
                requestId,
                status: parsedRequest.reason === 'too_large' ? 413 : 400,
            });
        }
        const { artifactId, data } = parsedRequest.data;

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId, status: 401 });
        }

        const admin = getServiceRoleClient();
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'Empresa no válida o no autorizada.', requestId, status: 403 });
        }

        const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, tenant);
        if (!authorized) {
            return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Artefacto no encontrado para esta empresa.', requestId, status: 404 });
        }

        if (tenant.platformRole === 'CONSTRUCTOR') {
            return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: 'Falta de permisos. Solo Arquitectos y Admins pueden guardar para publicación.', requestId, status: 403 });
        }

        const { data: existingRequest, error: existingRequestError } = await admin
            .from('publication_requests')
            .select('publish_step, status')
            .eq('artifact_id', artifactId)
            .maybeSingle();
        if (existingRequestError) throw existingRequestError;
        if (
            existingRequest?.status === 'READY'
            && (existingRequest.publish_step === 'QUEUED' || existingRequest.publish_step === 'RUNNING')
        ) {
            return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: 'La publicación está en curso; espera a que termine antes de modificar el borrador.', requestId, status: 409 });
        }

        const { error } = await admin
            .from('publication_requests')
            .upsert({
                artifact_id: artifactId,
                category: data.category,
                level: data.level,
                instructor_email: data.instructor_email,
                slug: data.slug,
                price: data.price,
                thumbnail_url: data.thumbnail_url || null,
                lesson_videos: data.lesson_videos,
                selected_lessons: data.selected_lessons || null,
                status: data.status,
                updated_at: new Date().toISOString()
            }, { onConflict: 'artifact_id' });
        if (error) throw error;

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        revalidatePath(`/${tenant.organizationSlug}/admin/artifacts/${artifactId}/publish`);
        return apiSuccessResponse({}, { requestId });
    } catch (error: unknown) {
        logger.error('publication.draft.failed', error);
        return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo guardar el borrador.', requestId, retryable: true, status: 500 });
    }
}
