import { createClient } from '@/utils/supabase/server'
import { z } from 'zod'
import { getSofliaInboxEnv, getSupabaseUrl } from '@/lib/server/env'
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract'
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response'
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger'

const MAX_SIGN_UP_REQUEST_BYTES = 8 * 1024

const signUpRequestSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().max(100).optional(),
  lastNameFather: z.string().trim().max(100).optional(),
  lastNameMother: z.string().trim().max(100).optional(),
  password: z.string().min(10).max(128),
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/).optional(),
}).strict()

export async function POST(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get('x-request-id'))
  const logger = createOperationalLogger('auth.sign_up', { correlationId: requestId })
  try {
    const requestUrl = new URL(request.url)
    const parsed = await parseJsonRequest(request, signUpRequestSchema, MAX_SIGN_UP_REQUEST_BYTES)
    if (!parsed.success) {
      return apiErrorResponse({
        code: parsed.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsed.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'Datos de registro inválidos.',
        requestId,
        status: parsed.reason === 'too_large' ? 413 : 400,
      })
    }
    const { email, password, firstName, lastNameFather, lastNameMother, username } = parsed.data

    // Login is authoritative in Learning/SofLIA. Never create an identity in a
    // different Supabase project because that account could not log in here.
    const courseforgeHost = new URL(getSupabaseUrl()).host.toLowerCase()
    const sofliaHost = new URL(getSofliaInboxEnv().url).host.toLowerCase()
    if (courseforgeHost !== sofliaHost) {
      return apiErrorResponse({ code: API_ERROR_CODE.dependencyUnavailable, message: 'El registro directo no está disponible. Solicita una invitación a tu administrador.', requestId, status: 503 })
    }

    const supabase = await createClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${requestUrl.origin}/api/auth/callback`,
        data: {
          first_name: firstName,
          last_name_father: lastNameFather,
          last_name_mother: lastNameMother,
          username: username,
        },
      },
    })

    if (error) {
      logger.warn('auth.sign_up.rejected', { providerCode: error.code })
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: 'No se pudo completar el registro.', requestId, status: 400 })
    }

    return apiSuccessResponse({}, { requestId })
  } catch (error: unknown) {
    logger.error('auth.sign_up.failed', error)
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo completar el registro.', requestId, retryable: true, status: 500 })
  }
}
