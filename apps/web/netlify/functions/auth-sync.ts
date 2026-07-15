/**
 * Netlify Function: auth-sync
 *
 * Auth Bridge for Engine:
 * 1. Resolves the Learning profile from public.users.
 * 2. Validates credentials against Learning Supabase Auth.
 * 3. Loads active Learning organizations.
 * 4. Signs CourseForge-compatible bridge tokens.
 *
 * Endpoint: POST /.netlify/functions/auth-sync
 * Body: { identifier: string, password: string }
 */

import type { HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import {
  getCourseforgeJwtSecret,
  getSofliaAuthSupabaseAnonKey,
  getSofliaInboxEnv,
} from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';

interface AuthSyncRequest {
  identifier: string;
  password: string;
}

interface SofliaUserRecord {
  display_name?: string | null;
  email: string;
  first_name?: string | null;
  id: string;
  is_banned?: boolean | null;
  last_name?: string | null;
  platform_role?: string | null;
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

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mapSofliaAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid_credentials')
  ) {
    return { error: 'Credenciales invalidas', status: 401 };
  }

  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('over_request_rate_limit')
  ) {
    return {
      error:
        'Demasiados intentos de inicio de sesion. Espera unos minutos e intenta de nuevo.',
      status: 429,
    };
  }

  if (normalized.includes('email not confirmed')) {
    return {
      error:
        'Tu correo aun no esta confirmado. Revisa tu bandeja de entrada para activarlo.',
      status: 403,
    };
  }

  return {
    error:
      'No se pudo iniciar sesion en este momento. Por favor, intenta de nuevo en unos minutos.',
    status: 503,
  };
}

export default async function handler(req: AuthSyncEvent) {
  if (req.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(req.body || '{}') as AuthSyncRequest;
    const { identifier, password } = body;

    if (!identifier || !password) {
      return jsonResponse(400, { error: 'Credenciales requeridas' });
    }

    const { url: sofliaUrl, key: sofliaKey } = getSofliaInboxEnv();
    const courseforgeJwtSecret = getCourseforgeJwtSecret();
    const sofliaAuthAnonKey = getSofliaAuthSupabaseAnonKey();

    const sofliaAdmin = createClient(sofliaUrl, sofliaKey);
    const sofliaAuth = createClient(sofliaUrl, sofliaAuthAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const column = identifier.includes('@') ? 'email' : 'username';
    const { data: user, error: userError } = await sofliaAdmin
      .from('users')
      .select(
        'id, email, username, first_name, last_name, display_name, profile_picture_url, platform_role, is_banned',
      )
      .ilike(column, identifier)
      .single();

    const typedUser = user as SofliaUserRecord | null;

    if (userError || !typedUser) {
      return jsonResponse(404, { error: 'Usuario no encontrado' });
    }

    if (typedUser.is_banned) {
      return jsonResponse(403, {
        error: 'Tu cuenta ha sido suspendida. Contacta al administrador.',
      });
    }

    const authResult = await sofliaAuth.auth.signInWithPassword({
      email: typedUser.email,
      password,
    });

    if (authResult.error || !authResult.data.user) {
      const mapped = mapSofliaAuthError(
        authResult.error?.message || 'AUTH_SIGNIN_FAILED',
      );
      return jsonResponse(mapped.status, { error: mapped.error });
    }

    if (authResult.data.user.id !== typedUser.id) {
      return jsonResponse(403, {
        error:
          'Error en la configuracion de la cuenta. Por favor, contacta al soporte.',
      });
    }

    const { data: orgUsers } = await sofliaAdmin
      .from('organization_users')
      .select(
        `
        role,
        organization_id,
        organizations (
          id,
          name,
          slug,
          logo_url
        )
      `,
      )
      .eq('user_id', typedUser.id)
      .eq('status', 'active');

    const organizations = ((orgUsers || []) as OrganizationUserRow[]).map(
      (organizationUser) => ({
        id: organizationUser.organizations?.id || organizationUser.organization_id,
        name: organizationUser.organizations?.name || '',
        slug: organizationUser.organizations?.slug || '',
        role: organizationUser.role,
        logo_url: organizationUser.organizations?.logo_url || null,
      }),
    );

    const activeOrganizationId =
      organizations.length > 0 ? organizations[0].id : null;

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
        platform_role: typedUser.platform_role,
        cargo_rol: typedUser.platform_role,
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

    return jsonResponse(200, {
      success: true,
      user: typedUser,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
      },
      organizations,
      activeOrganizationId,
    });
  } catch (error: unknown) {
    console.error('auth-sync error:', getErrorMessage(error));
    if (getErrorMessage(error).includes('SOFLIA_AUTH_SUPABASE_ANON_KEY')) {
      return jsonResponse(500, {
        error: 'Configuracion incompleta: falta SOFLIA_AUTH_SUPABASE_ANON_KEY',
      });
    }

    return jsonResponse(500, { error: 'Error interno del servidor' });
  }
}
