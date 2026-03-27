import { createClient } from "@/utils/supabase/server";
import {
  canReviewContent,
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
  getAuthorizedCurationRowAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

interface AuthenticatedUser {
  userId: string;
  email?: string | null;
}

interface AuthenticatedActionContext {
  supabase: ServerSupabaseClient;
  authUser: AuthenticatedUser;
}

export interface ArtifactAdminContext extends AuthenticatedActionContext {
  admin: ServiceRoleClient;
  artifact: {
    id: string;
    organization_id: string | null;
  };
  accessToken?: string;
}

export interface CurationRowAdminContext extends AuthenticatedActionContext {
  admin: ServiceRoleClient;
  row: {
    id: string;
    curation_id: string;
  };
  artifactId: string;
}

async function getAuthenticatedActionContext(): Promise<AuthenticatedActionContext> {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);

  if (!authUser) {
    throw new Error("Unauthorized");
  }

  return { supabase, authUser };
}

export async function getArtifactAdminContext(
  artifactId: string,
  options: {
    requireAccessToken?: boolean;
    requireReviewer?: boolean;
  } = {},
): Promise<ArtifactAdminContext> {
  const context = await getAuthenticatedActionContext();

  if (options.requireReviewer) {
    const hasPermission = await canReviewContent(context.authUser.userId);
    if (!hasPermission) {
      throw new Error("Forbidden: Requiere rol de Arquitecto o Admin");
    }
  }

  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) {
    throw new Error("Artifact not found or inaccessible");
  }

  const accessToken = options.requireAccessToken
    ? await getAccessToken(context.supabase)
    : null;

  if (options.requireAccessToken && !accessToken) {
    throw new Error("Unauthorized");
  }

  return {
    ...context,
    admin: authorized.admin,
    artifact: authorized.artifact,
    accessToken: accessToken || undefined,
  };
}

export async function getCurationRowAdminContext(
  rowId: string,
): Promise<CurationRowAdminContext> {
  const context = await getAuthenticatedActionContext();
  const authorized = await getAuthorizedCurationRowAdmin(rowId);

  if (!authorized) {
    throw new Error("Curation row not found or inaccessible");
  }

  return {
    ...context,
    admin: authorized.admin,
    row: authorized.row,
    artifactId: authorized.artifactId,
  };
}
