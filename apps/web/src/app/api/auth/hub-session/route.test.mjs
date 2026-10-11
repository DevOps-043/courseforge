import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), bridge: vi.fn(), login: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/server/env', () => ({ getSofliaInboxEnv: () => ({ url: 'https://auth.test' }), getSofliaAuthSupabaseAnonKey: () => 'anon' }));
vi.mock('@/utils/auth/session', () => ({ getAuthBridgeUser: mocks.bridge }));
vi.mock('@/app/login/auth-bridge', () => ({ completeAuthBridgeSsoLogin: mocks.login }));
import { POST } from './route';
function request(replace = false, origin) {
  return new NextRequest('https://engine.test/api/auth/hub-session', { method: 'POST', headers: { 'X-PulseHub-Session': '1', Authorization: `Bearer ${'t'.repeat(48)}`, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ replace }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ data: { user: { id: 'hub-user' } }, error: null });
  mocks.bridge.mockResolvedValue({ id: 'hub-user' }); mocks.login.mockResolvedValue({ success: true, redirectTo: '/builder' });
});
describe('Conexión de Engine desde PulseHub', () => {
  it('valida el bearer antes de conservar una cuenta existente', async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, userId: 'hub-user', preserved: true });
    expect(mocks.getUser).toHaveBeenCalledOnce(); expect(mocks.login).not.toHaveBeenCalled();
  });
  it('rechaza orígenes cruzados y bearer inválido sin emitir sesión', async () => {
    expect((await POST(request(false, 'https://evil.test'))).status).toBe(403); expect(mocks.getUser).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: {} });
    expect((await POST(request())).status).toBe(401); expect(mocks.login).not.toHaveBeenCalled();
  });
  it('reconecta explícitamente sin responder con credenciales', async () => {
    const response = await POST(request(true)); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, userId: 'hub-user' }); expect(mocks.login).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('sin cuenta en la web crea una sesión y propaga el rechazo del bridge', async () => {
    mocks.bridge.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(200);
    mocks.login.mockResolvedValueOnce({ error: 'Membresía inactiva' }); expect((await POST(request(true))).status).toBe(401);
  });
  it('rechaza un resultado del bridge con otra identidad', async () => {
    mocks.bridge.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'otra-cuenta' });
    expect((await POST(request())).status).toBe(503);
  });
});
