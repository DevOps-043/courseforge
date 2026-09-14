import { NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { randomUUID } from 'crypto';
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from '@/lib/server/artifact-action-auth';
import { dispatchBackgroundFunctionJson } from '@/lib/server/background-function-client';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';
import { SCORM_IMPORT_STATUS, SCORM_PROCESSING_STEP } from '@/domains/scorm/scorm-job-contracts';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';
import { API_ERROR_CODE } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';

const MAX_SCORM_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_SCORM_MULTIPART_BYTES = MAX_SCORM_UPLOAD_BYTES + 1024 * 1024;

export async function POST(req: NextRequest) {
    const correlationId = resolveCorrelationId(req.headers.get('x-request-id'));
    const logger = createOperationalLogger('scorm.upload', { correlationId });
    try {
        const supabase = await createClient();

        // 1. Auth + tenant check
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId: correlationId, status: 401 });
        }
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'Empresa no válida o no autorizada.', requestId: correlationId, status: 403 });
        }
        if (!await canReviewContent(authenticatedUser.userId, tenant)) {
            return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: 'Falta de permisos.', requestId: correlationId, status: 403 });
        }
        const admin = getServiceRoleClient();

        // 2. Parse FormData
        const contentType = req.headers.get('content-type') || '';
        if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
            return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: 'Se requiere una solicitud multipart/form-data.', requestId: correlationId, status: 415 });
        }
        const declaredBytes = Number(req.headers.get('content-length'));
        if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SCORM_MULTIPART_BYTES) {
            return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El paquete SCORM debe pesar menos de 100 MB.', requestId: correlationId, status: 413 });
        }

        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'Formulario de carga inválido.', requestId: correlationId, status: 400 });
        }
        const file = formData.get('file');

        if (!(file instanceof File)) {
            return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'No se recibió un archivo.', requestId: correlationId, status: 400 });
        }

        if (!file.name.endsWith('.zip')) {
            return apiErrorResponse({ code: API_ERROR_CODE.unsupportedMediaType, message: 'Tipo de archivo inválido. Solo se admite .zip.', requestId: correlationId, status: 415 });
        }
        if (file.size <= 0 || file.size > MAX_SCORM_UPLOAD_BYTES) {
            return apiErrorResponse({ code: API_ERROR_CODE.payloadTooLarge, message: 'El paquete SCORM debe pesar menos de 100 MB.', requestId: correlationId, status: 413 });
        }

        // 3. Upload to Storage
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-160);
        const storagePath = `organizations/${tenant.organizationId}/uploads/${authenticatedUser.userId}/${randomUUID()}-${safeFileName}`;
        const { error: uploadError } = await admin.storage
            .from('scorm-packages')
            .upload(storagePath, file, {
                contentType: 'application/zip',
                upsert: false
            });

        if (uploadError) {
            logger.error('scorm.storage_upload.failed', uploadError);
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo almacenar el paquete SCORM.', requestId: correlationId, retryable: true, status: 500 });
        }

        // 4. Create DB Record (Initial)
        const { data: importRecord, error: dbError } = await admin
            .from('scorm_imports')
            .insert({
                original_filename: file.name,
                storage_path: storagePath,
                status: SCORM_IMPORT_STATUS.parsing,
                processing_step: SCORM_PROCESSING_STEP.parseQueued,
                created_by: authenticatedUser.userId,
                correlation_id: correlationId,
                organization_id: tenant.organizationId,
                updated_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        if (dbError) {
            logger.error('scorm.import_record.create_failed', dbError);
            const { error: cleanupError } = await admin.storage
                .from('scorm-packages')
                .remove([storagePath]);
            if (cleanupError) {
                logger.error('scorm.storage_cleanup.failed', cleanupError);
            }
            return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo registrar la importación.', requestId: correlationId, retryable: true, status: 500 });
        }

        try {
            await dispatchBackgroundFunctionJson(
                'scorm-parsing-background',
                { correlationId, importId: importRecord.id, organizationId: tenant.organizationId },
                {
                    fallbackError: 'No se pudo despachar el análisis SCORM.',
                    localHandlerLoader: () => import('../../../../../../netlify/functions/scorm-parsing-background'),
                },
            );
        } catch (dispatchError) {
            logger.error('scorm.parsing.dispatch_failed', dispatchError, { importId: importRecord.id });
            const { error: rollbackError } = await admin
                .from('scorm_imports')
                .update({
                    processing_step: null,
                    status: SCORM_IMPORT_STATUS.uploaded,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', importRecord.id)
                .eq('organization_id', tenant.organizationId)
                .eq('processing_step', SCORM_PROCESSING_STEP.parseQueued);
            if (rollbackError) {
                logger.error('scorm.parsing.reservation_release_failed', rollbackError, {
                    importId: importRecord.id,
                });
            }
            return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: 'No se pudo iniciar el análisis SCORM.', requestId: correlationId, retryable: true, status: 503 });
        }

        return apiSuccessResponse({
            importId: importRecord.id,
            status: SCORM_IMPORT_STATUS.parsing,
        }, { requestId: correlationId, status: 202 });

    } catch (error: unknown) {
        logger.error('scorm.upload.failed', error);
        return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo procesar la carga SCORM.', requestId: correlationId, retryable: true, status: 500 });
    }
}
