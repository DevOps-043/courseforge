'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { SystemPrompt, UpdateSystemPromptDTO } from '@/domains/prompts/types';
import { revalidatePath } from 'next/cache';
import { getActiveOrganizationId, getAuthBridgeUser } from '@/utils/auth/session';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';

interface ModelSettingsUpdateInput {
  fallback_model?: string | null;
  id: number;
  model_name: string;
  temperature?: number | null;
  thinking_level?: string | null;
}

export interface ModelSettingsRecord extends ModelSettingsUpdateInput {
  is_active: boolean;
  setting_type: string;
}

const SYSTEM_PROMPT_SELECT_FIELDS =
  'id, code, version, organization_id, content, description, is_active, created_at, updated_at';

// Helper for admin client that bypasses the RLS if the session token is not understood by PostgREST
function getAdminClient() {
  return createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
}

function getSystemPromptIdentity(prompt: Pick<SystemPrompt, 'code' | 'version'>) {
  return `${prompt.code}::${prompt.version}`;
}

function isPreferredSystemPrompt(candidate: SystemPrompt, current: SystemPrompt) {
  if (candidate.is_active !== current.is_active) {
    return candidate.is_active;
  }

  const candidateUpdatedAt = new Date(candidate.updated_at).getTime();
  const currentUpdatedAt = new Date(current.updated_at).getTime();

  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }

  return candidate.id.localeCompare(current.id) > 0;
}

function dedupeSystemPromptsByIdentity(prompts: SystemPrompt[]) {
  const promptsByIdentity = new Map<string, SystemPrompt>();

  for (const prompt of prompts) {
    const identity = getSystemPromptIdentity(prompt);
    const current = promptsByIdentity.get(identity);

    if (!current || isPreferredSystemPrompt(prompt, current)) {
      promptsByIdentity.set(identity, prompt);
    }
  }

  return Array.from(promptsByIdentity.values());
}

export async function getSystemPromptsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getActiveOrganizationId();
  const supabaseAdmin = getAdminClient();

  // Always fetch globals first
  const { data: globalData, error } = await supabaseAdmin
    .from('system_prompts')
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .is('organization_id', null)
    .order('code', { ascending: true })
    .order('version', { ascending: true })
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching prompts:', error);
    return { success: false, error: error.message };
  }

  const globalPrompts = dedupeSystemPromptsByIdentity((globalData || []) as SystemPrompt[]);

  // If no active org, return globals only
  if (!activeOrgId) {
    return { success: true, prompts: globalPrompts };
  }

  // Fetch org-specific prompts and overlay them over globals by code
  const { data: orgData, error: orgError } = await supabaseAdmin
    .from('system_prompts')
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .eq('organization_id', activeOrgId)
    .order('code', { ascending: true })
    .order('version', { ascending: true })
    .order('updated_at', { ascending: false });

  if (orgError) {
    console.error('Error fetching organization prompts:', orgError);
    return { success: false, error: orgError.message };
  }

  const orgPrompts = dedupeSystemPromptsByIdentity((orgData || []) as SystemPrompt[]);
  const orgByIdentity = new Map(orgPrompts.map((p) => [getSystemPromptIdentity(p), p]));

  // Merge: org-specific overrides global for the same code+version; globals fill in the rest
  const merged = globalPrompts.map((global) => {
    const override = orgByIdentity.get(getSystemPromptIdentity(global));
    return override ? { ...override, is_org_override: true } : global;
  });

  // Add any org-specific codes that don't exist as globals
  for (const orgPrompt of orgPrompts) {
    const existsInMerged = merged.some(
      (prompt) => getSystemPromptIdentity(prompt) === getSystemPromptIdentity(orgPrompt),
    );

    if (!existsInMerged) {
      merged.push({ ...orgPrompt, is_org_override: true });
    }
  }

  merged.sort((a, b) => {
    const codeComparison = a.code.localeCompare(b.code);
    return codeComparison || a.version.localeCompare(b.version);
  });

  return { success: true, prompts: merged };
}

export async function updateSystemPromptAction(prompt: UpdateSystemPromptDTO) {
    const user = await getAuthBridgeUser();

    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }

    const activeOrgId = await getActiveOrganizationId();
    const supabaseAdmin = getAdminClient();

    // Check if this row belongs to the current org or is a global prompt
    const { data: existing } = await supabaseAdmin
      .from('system_prompts')
      .select('id, code, version, organization_id')
      .eq('id', prompt.id)
      .single();

    const isOwnedByOrg = existing?.organization_id === activeOrgId;
    const isGlobal = !existing?.organization_id;

    if (activeOrgId && (isGlobal || !isOwnedByOrg)) {
      // Editing a global prompt → create an org-specific override instead of mutating the global
      const { data, error } = await supabaseAdmin
        .from('system_prompts')
        .upsert(
          {
            code: existing!.code,
            version: existing!.version,
            organization_id: activeOrgId,
            content: prompt.content,
            description: prompt.description,
            is_active: prompt.is_active,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'code,version,organization_id' },
        )
        .select()
        .single();

      if (error) {
        console.error('Error upserting org prompt override:', error);
        return { success: false, error: error.message };
      }

      revalidatePath('/admin/settings');
      return { success: true, prompt: data as SystemPrompt };
    }

    // Editing an org-specific row that already belongs to this org → update in place
    const { data, error } = await supabaseAdmin
      .from('system_prompts')
      .update({
          content: prompt.content,
          description: prompt.description,
          is_active: prompt.is_active,
          updated_at: new Date().toISOString(),
      })
      .eq('id', prompt.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating prompt:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/settings');
    return { success: true, prompt: data as SystemPrompt };
}

export async function getModelSettingsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getActiveOrganizationId();
  const supabaseAdmin = getAdminClient();

  const SELECT_FIELDS = 'id, model_name, fallback_model, temperature, thinking_level, setting_type, is_active';

  // Fetch globals as baseline
  const { data: globalData, error } = await supabaseAdmin
    .from('model_settings')
    .select(SELECT_FIELDS)
    .eq('is_active', true)
    .is('organization_id', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching model settings:', error);
    return { success: false, error: error.message };
  }

  const globalSettings = (globalData || []) as ModelSettingsRecord[];

  if (!activeOrgId) {
    return { success: true, settings: globalSettings };
  }

  // Fetch org-specific overrides
  const { data: orgData } = await supabaseAdmin
    .from('model_settings')
    .select(SELECT_FIELDS)
    .eq('is_active', true)
    .eq('organization_id', activeOrgId)
    .order('id', { ascending: true });

  const orgSettings = (orgData || []) as ModelSettingsRecord[];
  const orgByType = new Map(orgSettings.map((s) => [s.setting_type, s]));

  // Merge: org-specific overrides global for the same setting_type; globals fill the rest
  const merged = globalSettings.map((global) => orgByType.get(global.setting_type) ?? global);

  // Add org-specific types that have no global counterpart
  for (const orgSetting of orgSettings) {
    if (!merged.find((s) => s.setting_type === orgSetting.setting_type)) {
      merged.push(orgSetting);
    }
  }

  return { success: true, settings: merged };
}

/**
 * Deletes the org-specific override for a prompt code, restoring the global default.
 * No-ops if the org has no override for that code.
 */
export async function resetPromptToDefaultAction(promptCode: string) {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const activeOrgId = await getActiveOrganizationId();

  if (!activeOrgId) {
    return { success: false, error: 'No hay organización activa' };
  }

  const supabaseAdmin = getAdminClient();

  const { error } = await supabaseAdmin
    .from('system_prompts')
    .delete()
    .eq('code', promptCode)
    .eq('organization_id', activeOrgId);

  if (error) {
    console.error('Error resetting prompt to default:', error);
    return { success: false, error: error.message };
  }

  revalidatePath('/admin/settings');
  return { success: true };
}

// Actualiza un batch completo de configuraciones de modelo
export async function updateModelSettingsAction(settings: ModelSettingsUpdateInput[]) {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const activeOrgId = await getActiveOrganizationId();
  const supabaseAdmin = getAdminClient();
  
  const updates = settings.map(setting => 
    supabaseAdmin.from('model_settings').update({
        model_name: setting.model_name,
        fallback_model: setting.fallback_model,
        temperature: setting.temperature,
        thinking_level: setting.thinking_level,
        ...(activeOrgId ? { organization_id: activeOrgId } : {})
    }).eq('id', setting.id)
  );

  const results = await Promise.all(updates);
  const errors = results.filter(r => r.error);

  if (errors.length > 0) {
    console.error('Model settings update errors:', errors);
    return { success: false, error: 'Algunas configuraciones fallaron al guardarse' };
  }

  revalidatePath('/admin/settings');
  return { success: true };
}
