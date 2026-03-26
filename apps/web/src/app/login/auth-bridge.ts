import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { headers, cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

type LoginResult = { success: true; redirectTo: string } | { error: string };

export async function completeAuthBridgeLogin(
  identifier: string,
  password: string,
  rememberMe: boolean,
): Promise<LoginResult> {
  if (!identifier || !password) {
    return { error: "Por favor completa todos los campos" };
  }

  try {
    const cookieStore = await cookies();

    const sofliaUrl = process.env.SOFLIA_INBOX_SUPABASE_URL!;
    const sofliaKey = process.env.SOFLIA_INBOX_SUPABASE_KEY!;
    const courseforgeJwtSecret = process.env.COURSEFORGE_JWT_SECRET!;

    if (!sofliaUrl || !sofliaKey || !courseforgeJwtSecret) {
      console.error("Missing env vars for auth bridge");
      return { error: "Error de configuracion del servidor" };
    }

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey);
    const isEmail = identifier.includes("@");
    const column = isEmail ? "email" : "username";

    const { data: user, error: userError } = await sofliaAdmin
      .from("users")
      .select(
        "id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash",
      )
      .ilike(column, identifier)
      .single();

    if (userError || !user) {
      return { error: "Usuario no encontrado" };
    }

    if (user.is_banned) {
      return {
        error: "Tu cuenta ha sido suspendida. Contacta al administrador.",
      };
    }

    if (!user.password_hash) {
      return {
        error:
          "Esta cuenta usa autenticacion externa (OAuth). Inicia sesion con tu proveedor.",
      };
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return { error: "Contrasena incorrecta" };
    }

    const { data: orgUsers } = await sofliaAdmin
      .from("organization_users")
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
      .eq("user_id", user.id)
      .eq("status", "active");

    const organizations = (orgUsers || []).map((ou: any) => ({
      id: ou.organizations?.id || ou.organization_id,
      name: ou.organizations?.name || "",
      slug: ou.organizations?.slug || "",
      role: ou.role,
      logo_url: ou.organizations?.logo_url || null,
    }));

    const activeOrgId = organizations.length > 0 ? organizations[0].id : null;

    if (organizations.length > 0) {
      const serviceRoleKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
      );

      const orgsToUpsert = organizations.map((org: any) => ({
        id: org.id,
        name: org.name || "Organizacion",
        slug: org.slug || org.id,
        logo_url: org.logo_url,
      }));

      const { error: syncError } = await supabaseAdmin
        .from("organizations")
        .upsert(orgsToUpsert, { onConflict: "id" });

      if (syncError) {
        console.error(
          "Error sincronizando organizaciones localmente:",
          syncError,
        );
      }
    }

    const secret = new TextEncoder().encode(courseforgeJwtSecret);
    const now = Math.floor(Date.now() / 1000);

    const accessToken = await new SignJWT({
      aud: "authenticated",
      role: "authenticated",
      sub: user.id,
      email: user.email,
      iss: "courseforge-auth-bridge",
      app_metadata: {
        provider: "soflia",
        organization_ids: organizations.map((o: any) => o.id),
        active_organization_id: activeOrgId,
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
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setNotBefore(now)
      .sign(secret);

    const refreshToken = await new SignJWT({
      sub: user.id,
      type: "refresh",
      iss: "courseforge-auth-bridge",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now)
      .setExpirationTime(now + 604800)
      .sign(secret);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            try {
              if (rememberMe) {
                options.maxAge = 60 * 60 * 24 * 365;
              } else {
                options.maxAge = options.maxAge || 60 * 60 * 24 * 7;
              }
              cookieStore.set({ name, value, ...options });
            } catch (_error) {
              // No-op in non-mutable contexts
            }
          },
          remove(name: string, options: CookieOptions) {
            try {
              cookieStore.set({ name, value: "", ...options });
            } catch (_error) {
              // No-op in non-mutable contexts
            }
          },
        },
      },
    );

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (setSessionError) {
      console.error("Error setting session:", setSessionError);
      console.warn("Falling back to cookie-only auth");
    }

    try {
      if (activeOrgId) {
        cookieStore.set({
          name: "cf_active_org",
          value: activeOrgId,
          maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
          path: "/",
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
        });
      }

      cookieStore.set({
        name: "cf_user_orgs",
        value: JSON.stringify(
          organizations.map((o: any) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
            role: o.role,
            logo_url: o.logo_url,
          })),
        ),
        maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
        path: "/",
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      cookieStore.set({
        name: "cf_access_token",
        value: accessToken,
        maxAge: 3600,
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });

      cookieStore.set({
        name: "cf_remember_me",
        value: rememberMe ? "true" : "false",
        maxAge: rememberMe ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 7,
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
    } catch (error) {
      console.error("Error setting cookies:", error);
    }

    await sofliaAdmin
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    try {
      const cfAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      const headersList = await headers();
      const ip = headersList.get("x-forwarded-for") || "unknown";
      const userAgent = headersList.get("user-agent") || "unknown";

      await cfAdmin.from("login_history").insert({
        user_id: user.id,
        ip_address: ip,
        user_agent: userAgent,
      });
    } catch (logError) {
      console.error("Error logging session:", logError);
    }

    try {
      const cfAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );

      const { data: legacyProfile } = await cfAdmin
        .from("profiles")
        .select("id, platform_role")
        .eq("email", user.email)
        .neq("id", user.id)
        .single();

      if (legacyProfile) {
        const { error: migrationError } = await cfAdmin
          .from("profiles")
          .update({ id: user.id })
          .eq("id", legacyProfile.id);

        if (migrationError) {
          console.error("Error migrando perfil legacy:", migrationError);
        }
      }

      const { data: profile } = await cfAdmin
        .from("profiles")
        .upsert(
          {
            id: user.id,
            username: user.username,
            email: user.email,
            first_name: user.first_name,
            last_name_father: user.last_name,
            avatar_url: user.profile_picture_url,
          },
          { onConflict: "id" },
        )
        .select("platform_role")
        .single();

      if (
        profile?.platform_role === "ADMIN" ||
        profile?.platform_role === "SUPERADMIN"
      ) {
        return { success: true, redirectTo: "/admin" };
      }

      if (profile?.platform_role === "ARQUITECTO") {
        return { success: true, redirectTo: "/architect" };
      }

      if (profile?.platform_role === "CONSTRUCTOR") {
        return { success: true, redirectTo: "/builder" };
      }
    } catch (err) {
      console.error("Error sincronizando el perfil o verificando roles:", err);
    }

    return { success: true, redirectTo: "/builder" };
  } catch (err: any) {
    console.error("completeAuthBridgeLogin error:", err);
    return { error: "Ocurrio un error inesperado" };
  }
}
