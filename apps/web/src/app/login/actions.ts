'use server'

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { headers, cookies } from 'next/headers'

export async function loginAction(prevState: any, formData: FormData) {
  const identifier = formData.get('identifier') as string
  const password = formData.get('password') as string
  const rememberMe = formData.get('rememberMe') === 'true'

  if (!identifier || !password) {
    return { error: "Por favor completa todos los campos" }
  }

  try {
    // Use custom client for key Login step to handle Remember Me
    const cookieStore = await cookies()

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
              // If Remember Me is checked, extend cookie life to 1 year
              // Otherwise, use session-based cookies (no maxAge = deleted on browser close)
              if (rememberMe) {
                options.maxAge = 60 * 60 * 24 * 365; // 1 year in seconds
              } else {
                // For non-remember-me, keep default session behavior (1 week max)
                options.maxAge = options.maxAge || 60 * 60 * 24 * 7; // 7 days default
              }
              cookieStore.set({ name, value, ...options })
            } catch (error) {
              // The `set` method was called from a Server Component.
            }
          },
          remove(name: string, options: CookieOptions) {
            try {
              cookieStore.set({ name, value: '', ...options })
            } catch (error) {
              // The `delete` method was called from a Server Component.
            }
          },
        },
      }
    )

    let email = identifier

    // Username logic
    if (!identifier.includes('@')) {
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .ilike('username', identifier)
        .single()

      if (!profile || !profile.email) {
        return { error: 'Usuario no encontrado' }
      }

      email = profile.email
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return { error: error.message }
    }

    if (data.user) {
      // Usar cliente Admin para asegurar permisos de escritura en logs
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      const headersList = await headers();
      const ip = headersList.get('x-forwarded-for') || 'unknown';
      const userAgent = headersList.get('user-agent') || 'unknown';

      const { error: historyError } = await supabaseAdmin.from('login_history').insert({
        user_id: data.user.id,
        ip_address: ip,
        user_agent: userAgent
      });

      if (historyError) {
        console.error('Error insertando login_history:', historyError);
      }

      // Guardar preferencia "Recuérdame" en un cookie separado para persistir
      try {
        cookieStore.set({
          name: 'cf_remember_me',
          value: rememberMe ? 'true' : 'false',
          maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7, // 1 year or 7 days
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax'
        });
      } catch (error) {
        console.error('Error setting remember_me cookie:', error);
      }

      // Registrar sesión activa con tiempo de expiración correcto
      if (data.session) {
        // Si "Recuérdame" está activado, la sesión expira en 1 año; si no, en 7 días
        const sessionExpiry = rememberMe
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 año
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);   // 7 días

        const { error: sessionError } = await supabaseAdmin.from('user_sessions').insert({
          user_id: data.user.id,
          token_hash: data.session.access_token.substring(0, 50) + '...',
          device_info: userAgent,
          ip_address: ip,
          is_active: true,
          expires_at: sessionExpiry.toISOString()
        });

        if (sessionError) {
          console.error('Error insertando user_sessions:', sessionError);
        }
      }

      // Verificar Rol
      const { data: profile } = await supabase
        .from('profiles')
        .select('platform_role')
        .eq('id', data.user.id)
        .single()

      if (profile?.platform_role === 'ADMIN') {
        return { success: true, redirectTo: '/admin' }
      }
    }

    // Default redirect for non-admins
    return { success: true, redirectTo: '/dashboard' }

  } catch (err: any) {
    console.error(err);
    return { error: 'Ocurrió un error inesperado' }
  }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
