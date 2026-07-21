import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/server/env";
import { createClient } from "@/utils/supabase/server";
import {
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import {
  authenticateDesktopWorker,
  DesktopWorkerControlPlane,
} from "@/lib/server/desktop-worker-control-plane";

export const WORKER_ROUTE_RUNTIME = "nodejs";

export function jsonError(error: string, status: number, code?: string) {
  return NextResponse.json({ error, code }, { status });
}

export function isUuid(value: string | undefined | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

export async function parseJsonBody(request: Request) {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

async function getUserFromBearerToken(request: Request) {
  const token = request.headers.get("authorization")?.split(" ")[1];
  if (!token) return null;

  const jwtSecret = process.env.COURSEFORGE_JWT_SECRET;
  if (jwtSecret) {
    try {
      const secretKey = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
      if (payload.sub) {
        const appMetadata = payload.app_metadata as Record<string, unknown> | undefined;
        const rawOrganizationIds = appMetadata?.organization_ids;
        return {
          user: { id: String(payload.sub), email: typeof payload.email === "string" ? payload.email : undefined },
          organizationIds: Array.isArray(rawOrganizationIds)
            ? rawOrganizationIds.filter((id): id is string => typeof id === "string")
            : [],
        };
      }
    } catch {
      // Fall through to Supabase token auth.
    }
  }

  const admin = createSupabaseAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return null;

  const organizationIds = new Set<string>();
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();
  if (typeof profile?.organization_id === "string") organizationIds.add(profile.organization_id);

  const { data: roleRows } = await admin
    .from("organization_user_roles")
    .select("organization_id")
    .eq("user_id", user.id);
  for (const row of roleRows || []) {
    if (typeof row.organization_id === "string") organizationIds.add(row.organization_id);
  }

  return {
    user: { id: user.id, email: user.email || undefined },
    organizationIds: Array.from(organizationIds),
  };
}

export async function authenticateWorkerUser(request: Request) {
  const bearerUser = await getUserFromBearerToken(request);
  if (bearerUser) {
    return {
      ...bearerUser,
      service: new DesktopWorkerControlPlane(getServiceRoleClient()),
    };
  }

  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return null;

  const admin = getServiceRoleClient();
  const organizationIds = new Set<string>();
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", authenticatedUser.userId)
    .maybeSingle();
  if (typeof profile?.organization_id === "string") organizationIds.add(profile.organization_id);

  const { data: roleRows } = await admin
    .from("organization_user_roles")
    .select("organization_id")
    .eq("user_id", authenticatedUser.userId);
  for (const row of roleRows || []) {
    if (typeof row.organization_id === "string") organizationIds.add(row.organization_id);
  }

  return {
    user: { id: authenticatedUser.userId, email: authenticatedUser.email || undefined },
    organizationIds: Array.from(organizationIds),
    service: new DesktopWorkerControlPlane(admin),
  };
}

export async function authenticateWorkerRoute(request: Request) {
  return authenticateDesktopWorker(request);
}

export function mapWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNAUTHORIZED")) return jsonError("Unauthorized", 401);
  if (message.includes("FORBIDDEN")) return jsonError(message, 403);
  if (message.includes("NOT_FOUND")) return jsonError(message, 404);
  if (
    message.includes("NOT_CLAIMABLE") ||
    message.includes("NOT_DESKTOP_WORKER") ||
    message.includes("ALREADY") ||
    message.includes("EXPIRED") ||
    message.includes("EXTERNAL_BUILD_NOT_READY") ||
    message.includes("EXTERNAL_RENDER_TARGET_INCOMPLETE") ||
    message.includes("EXTERNAL_COMPOSITION_ID_MISSING") ||
    message.includes("DESKTOP_WORKER_NETLIFY_REQUIRES") ||
    message.includes("DESKTOP_WORKER_REQUIRES_TEMPLATE_BUILD") ||
    message.includes("TEMPLATE_BUILD_NOT_CLAIMABLE") ||
    message.includes("TEMPLATE_PREVIEW_BUILD_NOT_READY") ||
    message.includes("TEMPLATE_PREVIEW_NOT_CLAIMABLE") ||
    message.includes("TEMPLATE_VERSION_NOT_APPROVED")
  ) {
    return jsonError(message, 409, message.split(":")[0]);
  }
  if (message.includes("INVALID")) return jsonError(message, 400, message.split(":")[0]);
  console.error("[DesktopWorkerRoutes] Unexpected error:", error);
  return jsonError("Internal server error", 500);
}
