export interface SystemPrompt {
  id: string;
  code: string;
  version: string;
  organization_id?: string | null;
  content: string;
  description: string | null;
  is_active: boolean;
  parent_prompt_id?: string | null;
  source?: string | null;
  change_summary?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /** True when this row is an org-specific override (not the global default). */
  is_org_override?: boolean;
  /** True when this active org row is intentionally restored from global default content. */
  is_restored_default?: boolean;
}

export interface UpdateSystemPromptDTO {
  id: string;
  content: string;
  description?: string;
  is_active?: boolean;
  change_summary?: string;
}
