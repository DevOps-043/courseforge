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
import type { HandlerEvent } from '@netlify/functions';
import { getCourseforgeJwtSecret, getSofliaInboxEnv } from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';

interface AuthSyncRequest {
  identifier: string;
  password: string;
}

interface SofliaUserRecord {
  cargo_rol?: string | null;
  display_name?: string | null;
  email: string;
  first_name?: string | null;
  id: string;
  is_banned?: boolean | null;
  last_name?: string | null;
  password_hash?: string | null;
  profile_picture_url?: string | null;
  username?: string | null;
}

interface OrganizationRelation {
  id?: string | null;
  logo_url?: string | null;
  name?: string | null;
  slug?: string | null;
}

interface OrganizationUserRow {
  organization_id: string;
  organizations?: OrganizationRelation | null;
  role: string;
}

type AuthSyncEvent = Pick<HandlerEvent, 'body' | 'httpMethod'>;

export default async function handler(req: AuthSyncEvent) {
  if (req.httpMethod !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = JSON.parse(req.body || '{}') as AuthSyncRequest;
    const { identifier, password } = body;

    if (!identifier || !password) {
      return new Response(
        JSON.stringify({ error: 'Credenciales requeridas' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { url: sofliaUrl, key: sofliaKey } = getSofliaInboxEnv();
    const courseforgeJwtSecret = getCourseforgeJwtSecret();

    if (!sofliaUrl || !sofliaKey || !courseforgeJwtSecret) {
      console.error('Missing env vars: SOFLIA_INBOX_SUPABASE_URL, SOFLIA_INBOX_SUPABASE_KEY, or COURSEFORGE_JWT_SECRET');
      return new Response(
        JSON.stringify({ error: 'Configuración del servidor incompleta' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sofliaAdmin = createClient(sofliaUrl, sofliaKey);

    const isEmail = identifier.includes('@');
    const column = isEmail ? 'email' : 'username';

    const { data: user, error: userError } = await sofliaAdmin
      .from('users')
      .select('id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash')
      .ilike(column, identifier)
      .single();

    const typedUser = user as SofliaUserRecord | null;

    if (userError || !typedUser) {
      return new Response(
        JSON.stringify({ error: 'Usuario no encontrado' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typedUser.is_banned) {
      return new Response(
        JSON.stringify({ error: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!typedUser.password_hash) {
      return new Response(
        JSON.stringify({ error: 'Esta cuenta usa un método de autenticación externo (OAuth). Por favor, inicia sesión con tu proveedor.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordValid = await bcrypt.compare(password, typedUser.password_hash);

    if (!passwordValid) {
      return new Response(
        JSON.stringify({ error: 'Contraseña incorrecta' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
      .eq('user_id', typedUser.id)
      .eq('status', 'active');

    const organizations = ((orgUsers || []) as OrganizationUserRow[]).map((organizationUser) => ({
      id: organizationUser.organizations?.id || organizationUser.organization_id,
      name: organizationUser.organizations?.name || '',
      slug: organizationUser.organizations?.slug || '',
      role: organizationUser.role,
      logo_url: organizationUser.organizations?.logo_url || null,
    }));

    const activeOrganizationId = organizations.length > 0
      ? organizations[0].id
      : null;

    await sofliaAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', typedUser.id);

    const secret = new TextEncoder().encode(courseforgeJwtSecret);
    const now = Math.floor(Date.now() / 1000);

    const accessToken = await new SignJWT({
      aud: 'authenticated',
      role: 'authenticated',
      sub: typedUser.id,
      email: typedUser.email,
      iss: 'courseforge-auth-bridge',
      app_metadata: {
        provider: 'soflia',
        organization_ids: organizations.map((organization) => organization.id),
        active_organization_id: activeOrganizationId,
      },
      user_metadata: {
        username: typedUser.username,
        first_name: typedUser.first_name,
        last_name: typedUser.last_name,
        display_name: typedUser.display_name,
        avatar_url: typedUser.profile_picture_url,
        cargo_rol: typedUser.cargo_rol,
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setNotBefore(now)
      .sign(secret);

    const refreshToken = await new SignJWT({
      sub: typedUser.id,
      type: 'refresh',
      iss: 'courseforge-auth-bridge',
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 604800)
      .sign(secret);

    const { password_hash: _, ...safeUser } = typedUser;

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

  } catch (error: unknown) {
    console.error('auth-sync error:', getErrorMessage(error));
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
