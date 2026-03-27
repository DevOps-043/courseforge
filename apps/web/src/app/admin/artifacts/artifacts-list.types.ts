import type { LucideIcon } from "lucide-react";

export interface Artifact {
  id: string;
  idea_central: string;
  descripcion: unknown;
  state: string;
  created_at: string;
  created_by: string;
  syllabus_state?: string;
  plan_state?: string;
  profiles?: {
    username: string | null;
    email: string | null;
  } | null;
  production_status?: {
    total: number;
    completed: number;
  };
  production_complete?: boolean;
}

export type ArtifactViewMode = "grid" | "list";

export interface ArtifactStatusConfig {
  label: string;
  color: string;
  icon?: LucideIcon;
}
