/**
 * Netlify Function: auth-sync
 * 
 * Microservicio de autenticación que actúa como puente (Option C):
 * 1. Valida credenciales contra la tabla `public.users` de SofLIA (bcrypt)
 * 2. Obtiene las organizaciones del usuario
 * 3. Firma un JWT nuevo usando el JWT_SECRET de CourseForge
 * 4. Retorna el token compatible para que CourseForge lo use nativamente
 * 
 * SofLIA usa auth personalizado (NO Supabase Auth), por lo que
 * debemos verificar el password_hash (bcrypt) directamente.
 * 
 * Endpoint: POST /.netlify/functions/auth-sync
 * Body: { identifier: string, password: string }
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

interface AuthSyncRequest {
  identifier: string;
  password: string;
}

export default async function handler(req: any) {
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
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY;
    const courseforgeJwtSecret = process.env.COURSEFORGE_JWT_SECRET;

    if (!sofliaUrl || !sofliaKey || !courseforgeJwtSecret) {
      console.error('Missing env vars: SOFLIA_INBOX_SUPABASE_URL, SOFLIA_INBOX_SUPABASE_KEY, or COURSEFORGE_JWT_SECRET');
      return new Response(
        JSON.stringify({ error: 'Configuración del servidor incompleta' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sofliaAdmin = createClient(sofliaUrl, sofliaKey);

    // ---------- Buscar usuario en SofLIA ----------
    const isEmail = identifier.includes('@');
    const column = isEmail ? 'email' : 'username';

    const { data: user, error: userError } = await sofliaAdmin
      .from('users')
      .select('id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash')
      .ilike(column, identifier)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Usuario no encontrado' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ---------- Verificar estado del usuario ----------
    if (user.is_banned) {
      return new Response(
        JSON.stringify({ error: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!user.password_hash) {
      return new Response(
        JSON.stringify({ error: 'Esta cuenta usa un método de autenticación externo (OAuth). Por favor, inicia sesión con tu proveedor.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ---------- Verificar contraseña (bcrypt) ----------
    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      return new Response(
        JSON.stringify({ error: 'Contraseña incorrecta' }),
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
      .eq('user_id', user.id)
      .eq('status', 'active');

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || '',
      slug: ou.organizations?.slug || '',
      role: ou.role,
      logo_url: ou.organizations?.logo_url || null,
    }));

    const activeOrganizationId = organizations.length > 0
      ? organizations[0].id
      : null;

    // ---------- Actualizar last_login_at en SofLIA ----------
    await sofliaAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // ---------- Firmar JWT para CourseForge ----------
    const secret = new TextEncoder().encode(courseforgeJwtSecret);
    const now = Math.floor(Date.now() / 1000);

    const accessToken = await new SignJWT({
      // Claims estándar de Supabase para compatibilidad con RLS
      aud: 'authenticated',
      role: 'authenticated',
      sub: user.id,
      email: user.email,
      iss: 'courseforge-auth-bridge',
      // Custom claims con datos de SofLIA
      app_metadata: {
        provider: 'soflia',
        organization_ids: organizations.map(o => o.id),
        active_organization_id: activeOrganizationId,
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
      .sign(secret);

    // Refresh token (más largo, 7 días)
    const refreshToken = await new SignJWT({
      sub: user.id,
      type: 'refresh',
      iss: 'courseforge-auth-bridge',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 604800) // 7 días
      .sign(secret);

    // ---------- Respuesta ----------
    // Eliminar password_hash antes de enviar
    const { password_hash: _, ...safeUser } = user;

    return new Response(JSON.stringify({
      success: true,
      user: safeUser,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
      },
      organizations,
      activeOrganizationId,
    }), {
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
