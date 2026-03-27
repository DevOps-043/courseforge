export type PlatformRole = "ADMIN" | "ARQUITECTO" | "CONSTRUCTOR";

export interface PlatformUser {
  created_at?: string | null;
  email?: string | null;
  first_name?: string | null;
  id: string;
  last_name_father?: string | null;
  last_name_mother?: string | null;
  platform_role?: PlatformRole | null;
  status?: string | null;
  username?: string | null;
}

export interface UserModalFormData {
  email: string;
  firstName: string;
  id?: string;
  lastNameFather: string;
  lastNameMother: string;
  password: string;
  role: PlatformRole;
  username: string;
}
