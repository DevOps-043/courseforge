import { z } from "zod";

/** Display/context identity only. Never include tokens, grants or credentials. */
export const authSessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name_father: z.string().optional(),
  last_name_mother: z.string().optional(),
  avatar_url: z.string().optional(),
  platform_role: z.string().optional(),
}).strict();
export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;
export const authSessionResponseSchema = z.object({ success: z.literal(true), user: authSessionUserSchema });

/** Explicit projection prevents accidentally serializing a provider session. */
export function projectAuthSessionUser(identity: {
  id: string;
  email?: string;
  username?: unknown;
  first_name?: unknown;
  last_name_father?: unknown;
  last_name_mother?: unknown;
  avatar_url?: unknown;
  platform_role?: unknown;
}): AuthSessionUser {
  const optionalString = (value: unknown) => typeof value === "string" ? value : undefined;
  return authSessionUserSchema.parse({
    id: identity.id,
    email: identity.email ?? "",
    username: optionalString(identity.username),
    first_name: optionalString(identity.first_name),
    last_name_father: optionalString(identity.last_name_father),
    last_name_mother: optionalString(identity.last_name_mother),
    avatar_url: optionalString(identity.avatar_url),
    platform_role: optionalString(identity.platform_role),
  });
}
