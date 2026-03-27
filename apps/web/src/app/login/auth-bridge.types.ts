export type LoginResult =
  | { success: true; redirectTo: string }
  | { error: string };

export interface SofliaUserRecord {
  id: string;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  cargo_rol: string | null;
  is_banned: boolean;
  password_hash: string | null;
}

export interface OrganizationRecord {
  id: string | null;
  name: string | null;
  slug: string | null;
  logo_url: string | null;
}

export interface OrganizationUserRecord {
  role: string | null;
  organization_id: string | null;
  organizations?: OrganizationRecord | null;
}

export interface AuthBridgeOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  logo_url: string | null;
}

export interface AuthBridgeProfileRecord {
  platform_role?: string | null;
}

export interface ProfileUpsertRecord {
  id: string;
  username: string | null;
  email: string;
  first_name: string | null;
  last_name_father: string | null;
  avatar_url: string | null;
}
