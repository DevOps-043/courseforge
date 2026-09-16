import { createClient as createAdminClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { getSofliaInboxEnv, getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

const MAX_ADMIN_USER_REQUEST_BYTES = 16 * 1024;
const adminUserRequestSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().max(100).optional(),
  id: z.string().uuid(),
  isEdit: z.boolean().optional(),
  lastNameFather: z.string().trim().max(100).optional(),
  lastNameMother: z.string().trim().max(100).optional(),
  role: z.enum(['ADMIN', 'ARQUITECTO', 'CONSTRUCTOR']),
  username: z.string().trim().max(60).regex(/^[a-zA-Z0-9._-]*$/).optional(),
}).strict();

export async function POST(req: Request) {
  const requestId = resolveCorrelationId(req.headers.get('x-request-id'));
  const logger = createOperationalLogger('admin.users', { correlationId: requestId });
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autorizado.', requestId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'Empresa no válida o no autorizada.', requestId, status: 403 });
    }

    if (tenant.platformRole !== 'ADMIN' && tenant.platformRole !== 'SUPERADMIN') {
        return apiErrorResponse({ code: API_ERROR_CODE.roleForbidden, message: 'Se requiere acceso de administrador.', requestId, status: 403 });
    }

    const parsedRequest = await parseJsonRequest(req, adminUserRequestSchema, MAX_ADMIN_USER_REQUEST_BYTES);
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'Datos de usuario inválidos.',
        requestId,
        status: parsedRequest.reason === 'too_large' ? 413 : 400,
      });
    }
    const { id, firstName, lastNameFather, lastNameMother, email, role, username } = parsedRequest.data;

    const sofliaEnv = getSofliaInboxEnv();
    const sofliaAdmin = createAdminClient(sofliaEnv.url, sofliaEnv.key);
    const { data: membership, error: membershipError } = await sofliaAdmin
      .from('organization_users')
      .select('id')
      .eq('organization_id', tenant.organizationId)
      .eq('user_id', id)
      .in('status', ['active', 'invited'])
      .maybeSingle();

    if (membershipError || !membership) {
      if (membershipError) logger.error('admin.users.membership_lookup_failed', membershipError, { userId: id });
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'El usuario no pertenece a la empresa activa.', requestId, status: 403 });
    }

    // Use Service Role only after tenant membership has been verified.
    const cfAdmin = createAdminClient(
      getSupabaseUrl(),
      getSupabaseServiceRoleKey(),
    );

    const { data: profile, error } = await cfAdmin
      .from('profiles')
      .upsert({
        id: id,
        first_name: firstName,
        last_name_father: lastNameFather,
        last_name_mother: lastNameMother,
        email: email,
        username: username,
        organization_id: tenant.organizationId,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      logger.error('admin.users.profile_update_failed', error, { userId: id });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo actualizar el perfil del usuario.', requestId, retryable: true, status: 500 });
    }

    const { error: roleError } = await cfAdmin
      .from('organization_user_roles')
      .upsert(
        {
          organization_id: tenant.organizationId,
          user_id: id,
          platform_role: role,
          source: 'courseforge',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,user_id' },
      );

    if (roleError) {
      logger.error('admin.users.role_update_failed', roleError, { userId: id });
      return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo actualizar el rol del usuario.', requestId, retryable: true, status: 500 });
    }

    return apiSuccessResponse({ user: { ...profile, platform_role: role } }, { requestId });

  } catch (error: unknown) {
    logger.error('admin.users.failed', error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo actualizar el usuario.', requestId, retryable: true, status: 500 });
  }
}
