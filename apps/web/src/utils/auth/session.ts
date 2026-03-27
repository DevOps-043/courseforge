import { cookies } from 'next/headers'
import { jwtVerify, type JWTPayload } from 'jose'

/**
 * Verifica la sesiÃ³n del usuario desde la cookie cf_access_token.
 *
 * Esta funciÃ³n reemplaza a supabase.auth.getUser() ya que usamos
 * JWT propios firmados por el Auth Bridge (Option C), no GoTrue.
 *
 * Retorna el payload del JWT decodificado si es vÃ¡lido, o null si no hay sesiÃ³n.
 */

export interface AuthBridgeUser {
  id: string
  email: string
  username?: string
  first_name?: string
  last_name?: string
  display_name?: string
  avatar_url?: string
  cargo_rol?: string
  organization_ids?: string[]
  active_organization_id?: string | null
}

interface AuthBridgeJwtAppMetadata {
  active_organization_id?: string | null
  organization_ids?: string[]
}

interface AuthBridgeJwtUserMetadata {
  avatar_url?: string
  cargo_rol?: string
  display_name?: string
  first_name?: string
  last_name?: string
  username?: string
}

interface AuthBridgeJwtPayload extends JWTPayload {
  app_metadata?: AuthBridgeJwtAppMetadata
  email?: string
  user_metadata?: AuthBridgeJwtUserMetadata
}

function getErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function getAuthBridgeUser(): Promise<AuthBridgeUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('cf_access_token')?.value
    console.log('[AuthBridge] Cookie cf_access_token:', token ? 'Present' : 'MISSING')

    if (!token) {
      return null
    }

    const secret = process.env.COURSEFORGE_JWT_SECRET
    if (!secret) {
      console.error('[AuthBridge] COURSEFORGE_JWT_SECRET not configured')
      return null
    }

    console.log('[AuthBridge] Verifying token with secret...')
    const secretKey = new TextEncoder().encode(secret)

    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    })
    const typedPayload = payload as AuthBridgeJwtPayload
    console.log('[AuthBridge] Token verified for sub:', typedPayload.sub)

    if (!typedPayload.sub || !typedPayload.email) {
      return null
    }

    const appMetadata = typedPayload.app_metadata || {}
    const userMetadata = typedPayload.user_metadata || {}

    return {
      id: typedPayload.sub,
      email: typedPayload.email,
      username: userMetadata.username,
      first_name: userMetadata.first_name,
      last_name: userMetadata.last_name,
      display_name: userMetadata.display_name,
      avatar_url: userMetadata.avatar_url,
      cargo_rol: userMetadata.cargo_rol,
      organization_ids: appMetadata.organization_ids || [],
      active_organization_id: appMetadata.active_organization_id || null,
    }
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ERR_JWT_EXPIRED') {
      console.log('Auth token expired')
    } else {
      console.error('Auth verification error:', getErrorMessage(error))
    }
    return null
  }
}

/**
 * Obtiene la organizaciÃ³n activa desde la cookie cf_active_org
 */
export async function getActiveOrganizationId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get('cf_active_org')?.value || null
}

/**
 * Obtiene la lista de organizaciones del usuario desde la cookie cf_user_orgs
 */
export async function getUserOrganizations(): Promise<Array<{
  id: string
  name: string
  slug: string
  role: string
}>> {
  try {
    const cookieStore = await cookies()
    const orgsRaw = cookieStore.get('cf_user_orgs')?.value
    if (!orgsRaw) return []
    return JSON.parse(orgsRaw) as Array<{
      id: string
      name: string
      slug: string
      role: string
    }>
  } catch {
    return []
  }
}
