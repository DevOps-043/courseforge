import type { LucideIcon } from "lucide-react";

export interface Artifact {
  id: string;
  idea_central: string;
  descripcion: any;
  state: string;
  created_at: string;
  created_by: string;
  syllabus_state?: string;
  plan_state?: string;
  profiles?: {
    username: string;
    email: string;
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
