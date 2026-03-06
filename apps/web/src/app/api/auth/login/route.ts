import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'

/**
 * POST /api/auth/login
 * 
 * API Route alternativa para login (Option C).
 * Valida credenciales contra SofLIA (bcrypt) y firma un JWT
 * con el secret de CourseForge.
 */
export async function POST(request: Request) {
  try {
    const { identifier, password } = await request.json()

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    }

    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL!
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY!
    const courseforgeJwtSecret = process.env.COURSEFORGE_JWT_SECRET!

    if (!sofliaUrl || !sofliaKey || !courseforgeJwtSecret) {
      return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
    }

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey)

    // Buscar usuario en SofLIA
    const isEmail = identifier.includes('@')
    const column = isEmail ? 'email' : 'username'

    const { data: user, error: userError } = await sofliaAdmin
      .from('users')
      .select('id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash')
      .ilike(column, identifier)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (user.is_banned) {
      return NextResponse.json({ error: 'Cuenta suspendida' }, { status: 403 })
    }

    if (!user.password_hash) {
      return NextResponse.json({ error: 'Cuenta OAuth. Usa tu proveedor externo.' }, { status: 400 })
    }

    // Verificar contraseña (bcrypt)
    const passwordValid = await bcrypt.compare(password, user.password_hash)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }

    // Obtener organizaciones
    const { data: orgUsers } = await sofliaAdmin
      .from('organization_users')
      .select(`role, organization_id, organizations (id, name, slug, logo_url)`)
      .eq('user_id', user.id)
      .eq('status', 'active')

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || '',
      slug: ou.organizations?.slug || '',
      role: ou.role,
    }))

    const activeOrgId = organizations[0]?.id || null

    // Firmar JWT para CourseForge
    const secret = new TextEncoder().encode(courseforgeJwtSecret)
    const now = Math.floor(Date.now() / 1000)

    const accessToken = await new SignJWT({
      aud: 'authenticated',
      role: 'authenticated',
      sub: user.id,
      email: user.email,
      iss: 'courseforge-auth-bridge',
      app_metadata: {
        provider: 'soflia',
        organization_ids: organizations.map((o: any) => o.id),
        active_organization_id: activeOrgId,
      },
      user_metadata: {
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        display_name: user.display_name,
        avatar_url: user.profile_picture_url,
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(secret)

    const { password_hash: _, ...safeUser } = user

    return NextResponse.json({
      success: true,
      user: safeUser,
      access_token: accessToken,
      organizations,
      activeOrganizationId: activeOrgId,
    }, { status: 200 })

  } catch (error: any) {
    console.error('Login API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
