import { projectAuthSessionUser, type AuthSessionUser } from "./session.contract";

type SessionIdentity = Parameters<typeof projectAuthSessionUser>[0];
export interface AuthSessionDependencies {
  readBridgeUser: () => Promise<SessionIdentity | null>;
  readSupabaseUser: () => Promise<SessionIdentity | null>;
}

/** Match production's Auth Bridge identity before considering legacy GoTrue. */
export async function resolveAuthSessionUser(dependencies: AuthSessionDependencies): Promise<AuthSessionUser | null> {
  const identity = await dependencies.readBridgeUser() ?? await dependencies.readSupabaseUser();
  return identity ? projectAuthSessionUser(identity) : null;
}
