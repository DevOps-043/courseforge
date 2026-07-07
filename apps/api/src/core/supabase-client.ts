import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';

const supabaseRealtimeTransport = WebSocket as unknown as WebSocketLikeConstructor;

export function createNodeSupabaseClient(
  supabaseUrl: string,
  supabaseKey: string,
  options?: SupabaseClientOptions<string>,
) {
  return createClient(supabaseUrl, supabaseKey, {
    ...options,
    realtime: {
      ...options?.realtime,
      transport: options?.realtime?.transport || supabaseRealtimeTransport,
    },
  });
}
