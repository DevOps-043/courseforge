import { NextRequest, NextResponse } from 'next/server';
import { completeAuthBridgeSsoLogin } from '@/app/login/auth-bridge';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { createClient } from '@supabase/supabase-js';
import { getSofliaInboxEnv, getSofliaAuthSupabaseAnonKey } from '@/lib/server/env';
import { allowHubSessionConnection } from '@/lib/server/hub-session-rate-limit';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const fail = (status: number) => NextResponse.json({ success: false }, { status, headers });

function hasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  // Netlify puede reconstruir la URL interna con HTTP. Host conserva el
  // destino público; solo admitimos su origen HTTPS, sin confiar en Forwarded.
  return !origin || origin === request.nextUrl.origin ||
    origin === `https://${request.headers.get('host') || request.nextUrl.host}`;
}

async function connectionInput(request: NextRequest): Promise<{ replace: boolean } | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    let raw = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128) { void reader.cancel(); return null; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    const input = JSON.parse(raw + decoder.decode()) as { replace?: unknown } | null;
    return typeof input?.replace === 'boolean' ? { replace: input.replace } : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request) || request.headers.get('x-pulsehub-session') !== '1') return fail(403);
  const match = /^Bearer ([^\s]{40,8192})$/.exec(request.headers.get('authorization') || '');
  if (!match) return fail(401);
  try {
    const input = await connectionInput(request);
    if (!input) return fail(400);
    const native = createClient(getSofliaInboxEnv().url, getSofliaAuthSupabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const verified = await native.auth.getUser(match[1]);
    if (verified.error || !verified.data.user) return fail(401);
    if (!allowHubSessionConnection(verified.data.user.id)) return fail(429);
    // Conservar una sesión elegida en la web; la reconexión explícita la reemplaza.
    const existing = await getAuthBridgeUser();
    if (existing && !input.replace) return NextResponse.json({ success: true, userId: existing.id, preserved: true }, { headers });
    const result = await completeAuthBridgeSsoLogin(match[1]);
    if ('error' in result) return fail(401);
    const user = await getAuthBridgeUser();
    if (!user || user.id !== verified.data.user.id) return fail(503);
    return NextResponse.json({ success: true, userId: user.id }, { headers });
  } catch { return fail(503); }
}
