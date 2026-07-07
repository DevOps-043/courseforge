import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { WebSocketLikeConstructor } from '@supabase/realtime-js'
import { cookies } from 'next/headers'
import WebSocket from 'ws'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/server/env'

const supabaseRealtimeTransport = WebSocket as unknown as WebSocketLikeConstructor

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      realtime: {
        transport: supabaseRealtimeTransport,
      },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
