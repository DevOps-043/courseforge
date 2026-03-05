import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/auth/login
 * 
 * API Route alternativa para login. Autentica contra SofLIA (Master)
 * y retorna datos del usuario + organizaciones.
 * 
 * NOTA: El server action loginAction (en /app/login/actions.ts) es el
 * flujo principal ya que maneja directamente las cookies de sesión.
 * Este endpoint sirve como API alternativa para clientes que prefieran
 * un flujo REST.
 */
export async function POST(request: Request) {
  try {
    const { identifier, password } = await request.json()

    if (!identifier || !password) {
      return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })
    }

    // Conectar a SofLIA (Master)
    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL!
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY!

    if (!sofliaUrl || !sofliaKey) {
      return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
    }

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey)

    // Resolver identificador → email
    let email = identifier
    if (!identifier.includes('@')) {
      const { data: userRecord } = await sofliaAdmin
        .from('users')
        .select('email')
        .ilike('username', identifier)
        .single()

      if (!userRecord?.email) {
        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
      }
      email = userRecord.email
    }

    // Autenticar contra SofLIA
    const { data: authData, error: authError } =
      await sofliaAdmin.auth.signInWithPassword({ email, password })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 401 })
    }

    // Obtener organizaciones del usuario
    const { data: orgUsers } = await sofliaAdmin
      .from('organization_users')
      .select(`
        role,
        organization_id,
        organizations (id, name, slug, logo_url)
      `)
      .eq('user_id', authData.user.id)
      .eq('status', 'active')

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || '',
      slug: ou.organizations?.slug || '',
      role: ou.role,
    }))

    return NextResponse.json({
      success: true,
      user: authData.user,
      session: authData.session,
      organizations,
      activeOrganizationId: organizations[0]?.id || null,
    }, { status: 200 })

  } catch (error: any) {
    console.error('Login API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
