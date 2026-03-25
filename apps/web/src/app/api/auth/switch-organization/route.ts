import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { jwtVerify, SignJWT } from 'jose'

/**
 * POST /api/auth/switch-organization
 *
 * Regenera el JWT con un nuevo `active_organization_id`.
 * Esto es necesario porque las RLS policies de Supabase validan
 * el claim `active_organization_id` del JWT para filtrar datos.
 *
 * Flujo:
 * 1. Verificar JWT actual (cf_access_token)
 * 2. Validar que el usuario pertenece a la org destino
 * 3. Firmar nuevo JWT con active_organization_id actualizado
 * 4. Actualizar cookies: cf_access_token, cf_active_org
 * 5. Retornar la organización activa
 */
export async function POST(request: NextRequest) {
  try {
    const { organizationId } = await request.json()

    if (!organizationId) {
      return NextResponse.json(
        { error: 'organizationId es requerido' },
        { status: 400 }
      )
    }

    // ── Verificar JWT actual ──
    const cookieStore = await cookies()
    const token = cookieStore.get('cf_access_token')?.value

    if (!token) {
      return NextResponse.json(
        { error: 'No autenticado' },
        { status: 401 }
      )
    }

    const courseforgeJwtSecret = process.env.COURSEFORGE_JWT_SECRET
    if (!courseforgeJwtSecret) {
      console.error('[switch-org] COURSEFORGE_JWT_SECRET not configured')
      return NextResponse.json(
        { error: 'Error de configuración del servidor' },
        { status: 500 }
      )
    }

    const secretKey = new TextEncoder().encode(courseforgeJwtSecret)

    let payload: any
    try {
      const verified = await jwtVerify(token, secretKey, { algorithms: ['HS256'] })
      payload = verified.payload
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Token inválido o expirado' },
        { status: 401 }
      )
    }

    // ── Validar membresía ──
    const appMetadata = payload.app_metadata || {}
    const organizationIds: string[] = appMetadata.organization_ids || []

    if (!organizationIds.includes(organizationId)) {
      return NextResponse.json(
        { error: 'No tienes acceso a esta organización' },
        { status: 403 }
      )
    }

    // ── Obtener datos de la org desde la cookie cf_user_orgs ──
    const orgsRaw = cookieStore.get('cf_user_orgs')?.value
    let organizations: Array<{ id: string; name: string; slug: string; role: string }> = []
    try {
      if (orgsRaw) organizations = JSON.parse(orgsRaw)
    } catch { /* ignore */ }

    const targetOrg = organizations.find(o => o.id === organizationId)
    if (!targetOrg) {
      return NextResponse.json(
        { error: 'Organización no encontrada en tu lista' },
        { status: 404 }
      )
    }

    // ── Firmar nuevo JWT con org actualizada ──
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
      .setExpirationTime(now + 3600) // 1 hora
      .setNotBefore(now)
      .sign(secretKey)

    // ── Actualizar cookies ──
    const rememberMe = cookieStore.get('cf_remember_me')?.value === 'true'
    const maxAge = rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7
    const isProduction = process.env.NODE_ENV === 'production'

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
      },
    })
  } catch (error: any) {
    console.error('[switch-org] Error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}