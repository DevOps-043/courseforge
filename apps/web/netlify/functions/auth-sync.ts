/**
 * Netlify Function: auth-sync
 * 
 * Microservicio de autenticación centralizado que valida credenciales
 * contra la base de datos maestra de SofLIA Learning y retorna
 * la información del usuario + sus organizaciones.
 * 
 * Este endpoint NO firma JWTs directamente — delega eso a SofLIA's
 * signInWithPassword que ya produce un JWT válido. CourseForge
 * usará ese JWT si ambos proyectos comparten el mismo JWT_SECRET.
 * 
 * Endpoint: POST /.netlify/functions/auth-sync
 * Body: { identifier: string, password: string }
 * Returns: { user, session, organizations, activeOrganizationId }
 */

import { createClient } from '@supabase/supabase-js';

interface AuthSyncRequest {
  identifier: string;
  password: string;
}

interface AuthSyncResponse {
  success: boolean;
  user?: any;
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
  };
  organizations?: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    logo_url?: string;
  }>;
  activeOrganizationId?: string;
  profile?: any;
  error?: string;
}

export default async function handler(req: any) {
  // Solo aceptar POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: AuthSyncRequest = JSON.parse(req.body);
    const { identifier, password } = body;

    if (!identifier || !password) {
      return new Response(
        JSON.stringify({ error: 'Credenciales requeridas' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ---------- Conexión a SofLIA (Master) ----------
    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL;
    const sofliaServiceKey = process.env.SOFLIA_INBOX_SUPABASE_KEY;

    if (!sofliaUrl || !sofliaServiceKey) {
      console.error('Missing SOFLIA_INBOX_SUPABASE_URL or SOFLIA_INBOX_SUPABASE_KEY');
      return new Response(
        JSON.stringify({ error: 'Configuración del servidor incompleta' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sofliaAdmin = createClient(sofliaUrl, sofliaServiceKey);

    // ---------- Resolver identificador → email ----------
    let email = identifier;

    if (!identifier.includes('@')) {
      // Buscar por username en la tabla users de SofLIA
      const { data: userRecord } = await sofliaAdmin
        .from('users')
        .select('email')
        .ilike('username', identifier)
        .single();

      if (!userRecord?.email) {
        return new Response(
          JSON.stringify({ error: 'Usuario no encontrado' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      email = userRecord.email;
    }

    // ---------- Autenticar contra SofLIA ----------
    const { data: authData, error: authError } =
      await sofliaAdmin.auth.signInWithPassword({
        email,
        password,
      });

    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ error: authError?.message || 'Credenciales inválidas' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ---------- Obtener organizaciones del usuario ----------
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
      .eq('status', 'active');

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || '',
      slug: ou.organizations?.slug || '',
      role: ou.role,
      logo_url: ou.organizations?.logo_url || null,
    }));

    // Seleccionar la primera organización como activa por defecto
    const activeOrganizationId = organizations.length > 0
      ? organizations[0].id
      : null;

    // ---------- Obtener perfil del usuario ----------
    const { data: userProfile } = await sofliaAdmin
      .from('users')
      .select('id, email, username, first_name, last_name, avatar_url, role, is_active')
      .eq('id', authData.user.id)
      .single();

    // ---------- Respuesta ----------
    const response: AuthSyncResponse = {
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        ...userProfile,
      },
      session: authData.session ? {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_in: authData.session.expires_in,
        expires_at: authData.session.expires_at,
      } : undefined,
      organizations,
      activeOrganizationId,
      profile: userProfile,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });

  } catch (error: any) {
    console.error('auth-sync error:', error);
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
