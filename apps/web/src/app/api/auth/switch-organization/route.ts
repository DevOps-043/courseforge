import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify, SignJWT, type JWTPayload } from 'jose'
import { getErrorMessage } from '@/lib/errors'
import { getCourseforgeJwtSecret, isProductionEnvironment } from '@/lib/server/env'

interface OrganizationSummary {
  id: string
  logo_url?: string
  name: string
  role: string
  slug: string
}

interface SwitchOrganizationRequestBody {
  organizationId?: string
}

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
  try {
    const { organizationId } =
      (await request.json()) as SwitchOrganizationRequestBody

    if (!organizationId) {
      return NextResponse.json(
        { error: 'organizationId es requerido' },
        { status: 400 },
      )
    }

    const cookieStore = await cookies()
    const token = cookieStore.get('cf_access_token')?.value

    if (!token) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const secretKey = new TextEncoder().encode(getCourseforgeJwtSecret())

    let payload: SwitchOrgJwtPayload
    try {
      const verified = await jwtVerify(token, secretKey, {
        algorithms: ['HS256'],
      })
      payload = verified.payload as SwitchOrgJwtPayload
    } catch {
      return NextResponse.json(
        { error: 'Token invalido o expirado' },
        { status: 401 },
      )
    }

    const appMetadata = payload.app_metadata || {}
    const organizationIds: string[] = appMetadata.organization_ids || []

    if (!organizationIds.includes(organizationId)) {
      return NextResponse.json(
        { error: 'No tienes acceso a esta organizacion' },
        { status: 403 },
      )
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
      return NextResponse.json(
        { error: 'Organizacion no encontrada en tu lista' },
        { status: 404 },
      )
    }

    const now = Math.floor(Date.now() / 1000)
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
      .setExpirationTime(now + 3600)
      .setNotBefore(now)
      .sign(secretKey)

    const rememberMe = cookieStore.get('cf_remember_me')?.value === 'true'
    const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7
    const isProduction = isProductionEnvironment()

    cookieStore.set({
      name: 'cf_access_token',
      value: newAccessToken,
      maxAge: 3600,
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

    return NextResponse.json({
      success: true,
      organization: {
        id: targetOrg.id,
        name: targetOrg.name,
        slug: targetOrg.slug,
        role: targetOrg.role,
        logo_url: targetOrg.logo_url,
      },
    })
  } catch (error: unknown) {
    console.error('[switch-org] Error:', getErrorMessage(error))
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    )
  }
}
