'use server'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'

/**
 * loginAction - Autenticación Centralizada (Option C)
 * 
 * Flujo:
 * 1. Recibe credenciales (email/username + password)
 * 2. Valida contra la tabla `public.users` de SofLIA (bcrypt)
 * 3. Obtiene organizaciones del usuario desde SofLIA
 * 4. Firma un JWT NUEVO con el JWT_SECRET de CourseForge (jose)
 * 5. Establece la sesión en CourseForge con setSession()
 * 6. Guarda el contexto de organización en cookies
 * 
 * SofLIA usa auth personalizado (NO Supabase Auth), así que
 * validamos bcrypt directamente y generamos un token que
 * CourseForge entiende nativamente.
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
    // PASO 1: Conectar a SofLIA (Master)
    // ──────────────────────────────────────────────────
    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL!
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY!
    const courseforgeJwtSecret = process.env.COURSEFORGE_JWT_SECRET!

    if (!sofliaUrl || !sofliaKey || !courseforgeJwtSecret) {
      console.error('Missing env vars for auth bridge')
      return { error: 'Error de configuración del servidor' }
    }

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey)

    // ──────────────────────────────────────────────────
    // PASO 2: Buscar usuario en SofLIA
    // ──────────────────────────────────────────────────
    const isEmail = identifier.includes('@')
    const column = isEmail ? 'email' : 'username'

    const { data: user, error: userError } = await sofliaAdmin
      .from('users')
      .select('id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash')
      .ilike(column, identifier)
      .single()

    if (userError || !user) {
      return { error: 'Usuario no encontrado' }
    }

    if (user.is_banned) {
      return { error: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }
    }

    if (!user.password_hash) {
      return { error: 'Esta cuenta usa autenticación externa (OAuth). Inicia sesión con tu proveedor.' }
    }

    // ──────────────────────────────────────────────────
    // PASO 3: Verificar contraseña (bcrypt)
    // ──────────────────────────────────────────────────
    const passwordValid = await bcrypt.compare(password, user.password_hash)

    if (!passwordValid) {
      return { error: 'Contraseña incorrecta' }
    }

    // ──────────────────────────────────────────────────
    // PASO 4: Obtener organizaciones del usuario
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
      .eq('user_id', user.id)
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
    // PASO 4.5: Sincronizar organizaciones localmente
    // ──────────────────────────────────────────────────
    if (organizations.length > 0) {
      // Must use service_role to bypass RLS and insert the organizations
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey
      );
      
      const orgsToUpsert = organizations.map((org: any) => ({
        id: org.id,
        name: org.name || 'Organización',
        slug: org.slug || org.id,
        logo_url: org.logo_url
      }));

      const { error: syncError } = await supabaseAdmin
        .from('organizations')
        .upsert(orgsToUpsert, { onConflict: 'id' });

      if (syncError) {
        console.error('Error sincronizando organizaciones localmente:', syncError);
      }
    }

    // ──────────────────────────────────────────────────
    // PASO 5: Firmar JWT para CourseForge
    // ──────────────────────────────────────────────────
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
        cargo_rol: user.cargo_rol,
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600) // 1 hora
      .setNotBefore(now)
      .sign(secret)

    const refreshToken = await new SignJWT({
      sub: user.id,
      type: 'refresh',
      iss: 'courseforge-auth-bridge',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 604800) // 7 días
      .sign(secret)

    // ──────────────────────────────────────────────────
    // PASO 6: Establecer sesión en CourseForge
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
                options.maxAge = 60 * 60 * 24 * 365
              } else {
                options.maxAge = options.maxAge || 60 * 60 * 24 * 7
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

    // Establecer sesión con el JWT que firmamos para CourseForge
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    if (setSessionError) {
      console.error('Error setting session:', setSessionError)
      // Si setSession falla, aún podemos trabajar solo con cookies
      // Esto puede pasar si CourseForge tiene un JWT_SECRET diferente al COURSEFORGE_JWT_SECRET
      console.warn('Falling back to cookie-only auth')
    }

    // ──────────────────────────────────────────────────
    // PASO 7: Guardar contexto de organización en cookies
    // ──────────────────────────────────────────────────
    try {
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
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      })

      // Token directo para el frontend (fallback si setSession no funciona)
      cookieStore.set({
        name: 'cf_access_token',
        value: accessToken,
        maxAge: 3600,
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      })

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
      console.error('Error setting cookies:', error)
    }

    // ──────────────────────────────────────────────────
    // PASO 8: Actualizar last_login_at en SofLIA
    // ──────────────────────────────────────────────────
    await sofliaAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id)

    // ──────────────────────────────────────────────────
    // PASO 9: Login history en CourseForge (opcional)
    // ──────────────────────────────────────────────────
    try {
      const cfAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const headersList = await headers()
      const ip = headersList.get('x-forwarded-for') || 'unknown'
      const userAgent = headersList.get('user-agent') || 'unknown'

      await cfAdmin.from('login_history').insert({
        user_id: user.id,
        ip_address: ip,
        user_agent: userAgent,
      }).then(({ error }) => {
        if (error) console.error('Error login_history:', error)
      })
    } catch (logError) {
      console.error('Error logging session:', logError)
    }

    // ──────────────────────────────────────────────────
    // ──────────────────────────────────────────────────
    // PASO 10: Determinar destino de redirección y sincronizar a profiles
    // ──────────────────────────────────────────────────

    try {
      const cfAdmin = createAdminClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      // --- CONCILIACIÓN DE CUENTAS (Legacy vs SofLIA) ---
      // Si el usuario ya existía en CourseForge con un ID antiguo (legacy),
      // debemos migrar ese perfil al nuevo ID de SofLIA antes del upsert.
      const { data: legacyProfile } = await cfAdmin
          .from('profiles')
          .select('id, platform_role')
          .eq('email', user.email)
          .neq('id', user.id) // Buscar un ID diferente al actual
          .single()

      if (legacyProfile) {
        console.log(`Conciliando cuenta legacy para ${user.email}. Migrando ID ${legacyProfile.id} -> ${user.id}`);
        // Actualizamos el ID del perfil antiguo al nuevo ID de SofLIA
        // Esto preserva el platform_role y cualquier otra data histórica.
        const { error: migrationError } = await cfAdmin
          .from('profiles')
          .update({ id: user.id })
          .eq('id', legacyProfile.id);

        if (migrationError) {
          console.error('Error migrando perfil legacy:', migrationError);
        }
      }

      // Upsert profile in CourseForge database (ahora con el ID correcto garantizado)
      const { data: profile } = await cfAdmin
          .from('profiles')
          .upsert({
              id: user.id,
              username: user.username,
              email: user.email,
              first_name: user.first_name,
              last_name_father: user.last_name,
              avatar_url: user.profile_picture_url,
              // platform_role NO se sobreescribe si ya existe (gracias a ignoreDuplicates: false y onConflict: 'id')
              // pero realmente upsert con Supabase JS suele sobreescribir todo si no se tiene cuidado.
              // Usamos ignoreDuplicates: false para que actualice los campos de arriba, pero platform_role 
              // por defecto en la DB es CONSTRUCTOR.
          }, { onConflict: 'id' })
          .select('platform_role')
          .single()

      // Redirigir según rol de plataforma
      if (profile?.platform_role === 'ADMIN') {
        return { success: true, redirectTo: '/admin' }
      } else if (profile?.platform_role === 'ARQUITECTO') {
        return { success: true, redirectTo: '/architect' }
      } else if (profile?.platform_role === 'CONSTRUCTOR') {
        return { success: true, redirectTo: '/builder' }
      }
    } catch (err) {
      console.error('Error sincronizando el perfil o verificando roles:', err)
    }

    // Constructor por defecto o si hay fallo en la lectura de profiles
    return { success: true, redirectTo: '/builder' }

  } catch (err: any) {
    console.error('loginAction error:', err)
    return { error: 'Ocurrió un error inesperado' }
  }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const cookieStore = await cookies()
  try {
    cookieStore.set({ name: 'cf_active_org', value: '', maxAge: 0, path: '/' })
    cookieStore.set({ name: 'cf_user_orgs', value: '', maxAge: 0, path: '/' })
    cookieStore.set({ name: 'cf_access_token', value: '', maxAge: 0, path: '/' })
    cookieStore.set({ name: 'cf_remember_me', value: '', maxAge: 0, path: '/' })
  } catch (error) {
    console.error('Error clearing cookies:', error)
  }

  redirect('/login')
}
