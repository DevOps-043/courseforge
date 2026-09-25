import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify, SignJWT, type JWTPayload } from 'jose'
import { z } from 'zod'
import { getCourseforgeJwtSecret, isProductionEnvironment } from '@/lib/server/env'
import { API_ERROR_CODE, parseJsonRequest } from '@/lib/server/api-contract'
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response'
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger'
import { getRemainingSessionLifetime } from '@/utils/auth/session-expiration'

interface OrganizationSummary {
  id: string
  logo_url?: string
  name: string
  role: string
  slug: string
}

const MAX_SWITCH_ORGANIZATION_REQUEST_BYTES = 4 * 1024
const switchOrganizationRequestSchema = z.object({
  organizationId: z.string().uuid(),
}).strict()

interface SwitchOrgAppMetadata {
  active_organization_id?: string | null
  organization_ids?: string[]
}

interface SwitchOrgJwtPayload extends JWTPayload {
  app_metadata?: SwitchOrgAppMetadata
  email?: string
  user_metadata?: Record<string, unknown>
}

/**
 * POST /api/auth/switch-organization
 *
 * Regenera el JWT con un nuevo `active_organization_id`.
 * Esto permite que las RLS policies filtren correctamente por organizacion.
 */
export async function POST(request: NextRequest) {
  const requestId = resolveCorrelationId(request.headers.get('x-request-id'))
  const logger = createOperationalLogger('auth.switch_organization', { correlationId: requestId })
  try {
    const parsedRequest = await parseJsonRequest(request, switchOrganizationRequestSchema, MAX_SWITCH_ORGANIZATION_REQUEST_BYTES)
    if (!parsedRequest.success) {
      return apiErrorResponse({
        code: parsedRequest.reason === 'too_large' ? API_ERROR_CODE.payloadTooLarge : API_ERROR_CODE.invalidRequest,
        message: parsedRequest.reason === 'too_large' ? 'La solicitud excede el tamaño permitido.' : 'organizationId inválido.',
        requestId,
        status: parsedRequest.reason === 'too_large' ? 413 : 400,
      })
    }
    const { organizationId } = parsedRequest.data

    const cookieStore = await cookies()
    const token = cookieStore.get('cf_access_token')?.value

    if (!token) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'No autenticado.', requestId, status: 401 })
    }

    const secretKey = new TextEncoder().encode(getCourseforgeJwtSecret())

    let payload: SwitchOrgJwtPayload
    try {
      const verified = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
      })
      payload = verified.payload as SwitchOrgJwtPayload
    } catch {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'Token inválido o expirado.', requestId, status: 401 })
    }

    const appMetadata = payload.app_metadata || {}
    const organizationIds: string[] = appMetadata.organization_ids || []

    if (!organizationIds.includes(organizationId)) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: 'No tienes acceso a esta organización.', requestId, status: 403 })
    }

    const orgsRaw = cookieStore.get('cf_user_orgs')?.value
    let organizations: OrganizationSummary[] = []

    try {
      if (orgsRaw) {
        organizations = JSON.parse(orgsRaw) as OrganizationSummary[]
      }
    } catch {
      // Ignore malformed org cookie payload.
    }

    const targetOrg = organizations.find(
      (organization) => organization.id === organizationId,
    )

    if (!targetOrg) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: 'Organización no encontrada en tu lista.', requestId, status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const remainingSessionLifetime = getRemainingSessionLifetime(payload.exp, now)
    if (remainingSessionLifetime === null) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: 'Token inválido o expirado.', requestId, status: 401 })
    }
    const newAccessToken = await new SignJWT({
      aud: payload.aud,
      role: payload.role,
      sub: payload.sub,
      email: payload.email,
      iss: 'courseforge-auth-bridge',
      app_metadata: {
        ...appMetadata,
        active_organization_id: organizationId,
      },
      user_metadata: payload.user_metadata || {},
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + remainingSessionLifetime)
      .setNotBefore(now)
      .sign(secretKey)

    const rememberMe = cookieStore.get('cf_remember_me')?.value === 'true'
    const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7
    const isProduction = isProductionEnvironment()

    cookieStore.set({
      name: 'cf_access_token',
      value: newAccessToken,
      maxAge: remainingSessionLifetime,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    })

    cookieStore.set({
      name: 'cf_active_org',
      value: organizationId,
      maxAge,
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
    })

    return apiSuccessResponse({
      organization: {
        id: targetOrg.id,
        name: targetOrg.name,
        slug: targetOrg.slug,
        role: targetOrg.role,
        logo_url: targetOrg.logo_url,
      },
    }, { requestId })
  } catch (error: unknown) {
    logger.error('auth.switch_organization.failed', error)
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: 'No se pudo cambiar la organización.', requestId, retryable: true, status: 500 })
  }
}
