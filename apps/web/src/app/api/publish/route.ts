import { revalidatePath } from 'next/cache';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';
import { buildPublicationPayload } from '@/domains/publication/lib/publication-payload';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedArtifactAdminForTenant,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';
import { publishRequestSchema } from '@/domains/publication/publication.schemas';
import { hashPublicationPayload, PUBLICATION_OUTBOX_STEP } from '@/domains/publication/publication-outbox';
import { dispatchBackgroundFunctionJson } from '@/lib/server/background-function-client';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';

const MAX_PUBLISH_REQUEST_BYTES = 8 * 1024;

export async function POST(request: Request) {
    const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
    const logger = createOperationalLogger('publication.api', { correlationId });
    try {
        const parsedRequest = await parseJsonRequest(
            request,
            publishRequestSchema,
            MAX_PUBLISH_REQUEST_BYTES,
        );
        if (!parsedRequest.success) {
            return apiErrorResponse({
                code: parsedRequest.reason === 'too_large'
                    ? API_ERROR_CODE.payloadTooLarge
                    : API_ERROR_CODE.invalidRequest,
                message: parsedRequest.reason === 'too_large'
                    ? 'La solicitud de publicación excede el tamaño permitido.'
                    : 'Solicitud de publicación inválida.',
                requestId: correlationId,
                status: parsedRequest.reason === 'too_large' ? 413 : 400,
            });
        }
        const { artifactId } = parsedRequest.data;

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);

        if (!authenticatedUser) {
            return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId: correlationId, status: 401 });
        }

        const admin = getServiceRoleClient();
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'Empresa no válida o no autorizada.', requestId: correlationId, status: 403 });
        }

        const authorized = await getAuthorizedArtifactAdminForTenant(
            artifactId,
            tenant,
        );
        if (!authorized) {
            return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Artefacto no encontrado para esta empresa.', requestId: correlationId, status: 404 });
        }

        if (tenant.platformRole === 'CONSTRUCTOR') {
            return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: 'Falta de permisos. Solo Arquitectos y Admins pueden publicar.', requestId: correlationId, status: 403 });
        }

        const { request: publicationRequest, lessons, artifact, materialsPackage } =
            await getPublicationData(artifactId, tenant.organizationId);

        if (!publicationRequest || publicationRequest.status !== 'READY') {
            return apiErrorResponse({ code: API_ERROR_CODE.conflict, message: "El curso no está en estado 'READY' para publicar. Guarda el borrador primero.", requestId: correlationId, status: 409 });
        }

        // Slug is the idempotency key on SofLIA: a missing or empty slug causes SofLIA
        // to generate a timestamped slug on each import, creating a new course every time.
        if (!publicationRequest.slug?.trim()) {
            return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'El slug del curso es obligatorio para publicar. Define un slug estable en el formulario antes de continuar.', requestId: correlationId, status: 400 });
        }

        if (
            publicationRequest.publish_step === PUBLICATION_OUTBOX_STEP.queued
            || publicationRequest.publish_step === PUBLICATION_OUTBOX_STEP.running
        ) {
            return apiSuccessResponse({
                pending: true,
                message: 'La publicación ya está programada y continúa en segundo plano.',
            }, { requestId: correlationId, status: 202 });
        }

        const payloadToSend = buildPublicationPayload({
            artifactId,
            artifact,
            lessons,
            materialsPackage,
            request: publicationRequest,
        });

        const payloadHash = hashPublicationPayload(payloadToSend);
        const { data: queued, error: updateError } = await admin
            .from('publication_requests')
            .update({
                idempotency_key: publicationRequest.slug.trim(),
                correlation_id: correlationId,
                outbox_payload: payloadToSend,
                outbox_payload_hash: payloadHash,
                publish_heartbeat_at: null,
                publish_last_error: null,
                publish_lease_expires_at: null,
                publish_step: PUBLICATION_OUTBOX_STEP.queued,
                updated_at: new Date().toISOString(),
            })
            .eq('id', publicationRequest.id)
            .eq('status', 'READY')
            .or(`publish_step.is.null,publish_step.eq.${PUBLICATION_OUTBOX_STEP.sent}`)
            .select('id')
            .maybeSingle();

        if (updateError) {
            throw new Error(`PUBLICATION_OUTBOX_QUEUE_FAILED: ${updateError.message}`);
        }
        if (!queued) {
            return apiSuccessResponse({
                pending: true,
                message: 'La publicación ya fue programada por otra solicitud.',
            }, { requestId: correlationId, status: 202 });
        }

        try {
            await dispatchBackgroundFunctionJson(
                'publication-outbox-background',
                { correlationId, requestId: publicationRequest.id },
                {
                    fallbackError: 'No se pudo despachar la publicación.',
                    localHandlerLoader: () => import('../../../../netlify/functions/publication-outbox-background'),
                },
            );
        } catch (dispatchError) {
            // The durable QUEUED row remains available to the scheduled reconciler.
            logger.warn('publication.dispatch.deferred', {
                requestId: publicationRequest.id,
                error: dispatchError,
            });
        }

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        revalidatePath(`/${tenant.organizationSlug}/admin/artifacts/${artifactId}/publish`);

        return apiSuccessResponse({
            pending: true,
            message:
                'Publicación programada. El envío a Soflia continuará en segundo plano.',
        }, { requestId: correlationId, status: 202 });
    } catch (error: unknown) {
        logger.error('publication.request.failed', error);
        return apiErrorResponse({
            code: API_ERROR_CODE.internalError,
            message: 'No se pudo completar la publicación. Es seguro reintentar con el mismo slug.',
            requestId: correlationId,
            retryable: true,
            status: 500,
        });
    }
}
