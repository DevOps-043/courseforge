'use server'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'

/**
 * loginAction - Autenticación Centralizada contra SofLIA
 * 
 * Este server action autentica al usuario contra la base de datos
 * maestra de SofLIA Learning y establece la sesión en CourseForge.
 * 
 * Flujo:
 * 1. Recibe credenciales (email/username + password)
 * 2. Llama a la Netlify Function auth-sync que valida contra SofLIA
 * 3. Usa supabase.auth.setSession() para establecer la sesión en CourseForge
 * 4. Guarda el contexto de organización activa en cookies
 * 5. Redirige al dashboard
 * 
 * IMPORTANTE: Ambos proyectos de Supabase (CourseForge y SofLIA) deben
 * compartir el mismo JWT_SECRET para que el token de SofLIA sea válido aquí.
 */
export async function loginAction(prevState: any, formData: FormData) {
  const identifier = formData.get('identifier') as string
  const password = formData.get('password') as string
  const rememberMe = formData.get('rememberMe') === 'true'

  if (!identifier || !password) {
    return { error: "Por favor completa todos los campos" }
  }

  try {
    const cookieStore = await cookies()

    // ──────────────────────────────────────────────────
    // PASO 1: Autenticar contra SofLIA (Master)
    // ──────────────────────────────────────────────────
    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL!
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY!

    if (!sofliaUrl || !sofliaKey) {
      console.error('Missing SofLIA env vars: SOFLIA_INBOX_SUPABASE_URL / SOFLIA_INBOX_SUPABASE_KEY')
      return { error: 'Error de configuración del servidor' }
    }

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey)

    // ──────────────────────────────────────────────────
    // PASO 2: Resolver identificador → email
    // ──────────────────────────────────────────────────
    let email = identifier

    if (!identifier.includes('@')) {
      // Buscar por username en SofLIA
      const { data: userRecord } = await sofliaAdmin
        .from('users')
        .select('email')
        .ilike('username', identifier)
        .single()

      if (!userRecord?.email) {
        return { error: 'Usuario no encontrado' }
      }

      email = userRecord.email
    }

    // ──────────────────────────────────────────────────
    // PASO 3: Autenticar con signInWithPassword en SofLIA
    // ──────────────────────────────────────────────────
    const { data: authData, error: authError } =
      await sofliaAdmin.auth.signInWithPassword({ email, password })

    if (authError || !authData.user) {
      return { error: authError?.message || 'Credenciales inválidas' }
    }

    // ──────────────────────────────────────────────────
    // PASO 4: Obtener organizaciones del usuario en SofLIA
    // ──────────────────────────────────────────────────
    const { data: orgUsers } = await sofliaAdmin
      .from('organization_users')
      .select(`
        role,
        organization_id,
        organizations (
          id,
          name,
          slug,
          logo_url
        )
      `)
      .eq('user_id', authData.user.id)
      .eq('status', 'active')

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || '',
      slug: ou.organizations?.slug || '',
      role: ou.role,
      logo_url: ou.organizations?.logo_url || null,
    }))

    const activeOrgId = organizations.length > 0 ? organizations[0].id : null

    // ──────────────────────────────────────────────────
    // PASO 5: Establecer sesión en CourseForge usando el token de SofLIA
    // (Requiere JWT_SECRET compartido entre ambos proyectos)
    // ──────────────────────────────────────────────────
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            try {
              if (rememberMe) {
                options.maxAge = 60 * 60 * 24 * 365 // 1 año
              } else {
                options.maxAge = options.maxAge || 60 * 60 * 24 * 7 // 7 días
              }
              cookieStore.set({ name, value, ...options })
            } catch (error) {
              // Server Component context
            }
          },
          remove(name: string, options: CookieOptions) {
            try {
              cookieStore.set({ name, value: '', ...options })
            } catch (error) {
              // Server Component context
            }
          },
        },
      }
    )

    // Usar el token de SofLIA para establecer la sesión en CourseForge
    if (authData.session) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      })

      if (setSessionError) {
        console.error('Error setting session in CourseForge:', setSessionError)
        // No fallar silenciosamente — esto indica que JWT_SECRET no está sincronizado
        return { error: 'Error al sincronizar la sesión. Contacta al administrador.' }
      }
    }

    // ──────────────────────────────────────────────────
    // PASO 6: Guardar contexto de organización en cookies
    // ──────────────────────────────────────────────────
    try {
      // Cookie con la organización activa
      if (activeOrgId) {
        cookieStore.set({
          name: 'cf_active_org',
          value: activeOrgId,
          maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax'
        })
      }

      // Cookie con la lista completa de organizaciones (para el selector UI futuro)
      cookieStore.set({
        name: 'cf_user_orgs',
        value: JSON.stringify(organizations.map((o: any) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          role: o.role,
        }))),
        maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
        path: '/',
        httpOnly: false, // El frontend necesita leer esto
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      })

      // Preferencia "Recuérdame"
      cookieStore.set({
        name: 'cf_remember_me',
        value: rememberMe ? 'true' : 'false',
        maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      })
    } catch (error) {
      console.error('Error setting organization cookies:', error)
    }

    // ──────────────────────────────────────────────────
    // PASO 7: Login history y sesiones (en CourseForge local)
    // ──────────────────────────────────────────────────
    if (authData.user) {
      try {
        const cfAdmin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const headersList = await headers()
        const ip = headersList.get('x-forwarded-for') || 'unknown'
        const userAgent = headersList.get('user-agent') || 'unknown'

        // Login history
        await cfAdmin.from('login_history').insert({
          user_id: authData.user.id,
          ip_address: ip,
          user_agent: userAgent,
        }).then(({ error }) => {
          if (error) console.error('Error login_history:', error)
        })

        // Active session
        if (authData.session) {
          const sessionExpiry = rememberMe
            ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

          await cfAdmin.from('user_sessions').insert({
            user_id: authData.user.id,
            token_hash: authData.session.access_token.substring(0, 50) + '...',
            device_info: userAgent,
            ip_address: ip,
            is_active: true,
            expires_at: sessionExpiry.toISOString(),
          }).then(({ error }) => {
            if (error) console.error('Error user_sessions:', error)
          })
        }
      } catch (logError) {
        // No bloquear el login por errores de logging
        console.error('Error logging session:', logError)
      }
    }

    // ──────────────────────────────────────────────────
    // PASO 8: Determinar destino de redirección
    // ──────────────────────────────────────────────────
    // Obtener perfil del usuario (puede venir de CourseForge local o de SofLIA)
    const cfAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile } = await cfAdmin
      .from('profiles')
      .select('platform_role')
      .eq('id', authData.user.id)
      .single()

    if (profile?.platform_role === 'ADMIN') {
      return { success: true, redirectTo: '/admin' }
    }

    return { success: true, redirectTo: '/dashboard' }

  } catch (err: any) {
    console.error('loginAction error:', err)
    return { error: 'Ocurrió un error inesperado' }
  }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  // Limpiar cookies de organización
  const cookieStore = await cookies()
  try {
    cookieStore.set({ name: 'cf_active_org', value: '', maxAge: 0, path: '/' })
    cookieStore.set({ name: 'cf_user_orgs', value: '', maxAge: 0, path: '/' })
    cookieStore.set({ name: 'cf_remember_me', value: '', maxAge: 0, path: '/' })
  } catch (error) {
    console.error('Error clearing cookies:', error)
  }

  redirect('/login')
}
