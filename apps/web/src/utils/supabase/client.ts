import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/server/env'

let client: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  if (client) return client

  client = createBrowserClient(
    getSupabaseUrl(),
    getSupabaseAnonKey()
  )

  return client
}
