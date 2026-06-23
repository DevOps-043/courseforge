'use server';

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { SystemPrompt, UpdateSystemPromptDTO } from '@/domains/prompts/types';
import { revalidatePath } from 'next/cache';
import { getActiveOrganizationId, getAuthBridgeUser } from '@/utils/auth/session';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

interface ModelSettingsUpdateInput {
  fallback_model?: string | null;
  id: number;
  model_name: string;
  setting_type: string;
  temperature?: number | null;
  thinking_level?: string | null;
}

export interface ModelSettingsRecord extends ModelSettingsUpdateInput {
  is_active: boolean;
  setting_type: string;
}

const SYSTEM_PROMPT_SELECT_FIELDS =
  'id, code, version, organization_id, content, description, is_active, created_at, updated_at';
const MODEL_SETTINGS_SELECT_FIELDS =
  'id, model_name, fallback_model, temperature, thinking_level, setting_type, is_active';
const MODEL_SETTING_TYPES = [
  'ARTIFACT_BASE',
  'SYLLABUS',
  'INSTRUCTIONAL_PLAN',
  'CURATION',
  'MATERIALS',
] as const;
const DEFAULT_MODEL_SETTINGS_BY_TYPE: Record<(typeof MODEL_SETTING_TYPES)[number], Omit<ModelSettingsRecord, 'id'>> = {
  ARTIFACT_BASE: {
    model_name: 'gemini-2.5-flash',
    fallback_model: 'gemini-2.5-flash',
    temperature: 0.7,
    thinking_level: 'medium',
    setting_type: 'ARTIFACT_BASE',
    is_active: true,
  },
  SYLLABUS: {
    model_name: 'gemini-2.5-flash',
    fallback_model: 'gemini-2.5-flash',
    temperature: 0.7,
    thinking_level: 'medium',
    setting_type: 'SYLLABUS',
    is_active: true,
  },
  INSTRUCTIONAL_PLAN: {
    model_name: 'gemini-2.5-flash',
    fallback_model: 'gemini-2.5-flash',
    temperature: 0.7,
    thinking_level: 'medium',
    setting_type: 'INSTRUCTIONAL_PLAN',
    is_active: true,
  },
  CURATION: {
    model_name: 'gemini-2.5-pro',
    fallback_model: 'gemini-2.5-flash',
    temperature: 0.1,
    thinking_level: 'high',
    setting_type: 'CURATION',
    is_active: true,
  },
  MATERIALS: {
    model_name: 'gemini-2.5-pro',
    fallback_model: 'gemini-2.5-flash',
    temperature: 0.7,
    thinking_level: 'minimal',
    setting_type: 'MATERIALS',
    is_active: true,
  },
};

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

async function getResolvedActiveOrgId() {
  const tenant = await resolveActiveTenantContext();
  return tenant?.organizationId ?? (await getActiveOrganizationId());
}

async function revalidateSettingsPaths() {
  revalidatePath('/admin/settings');
  const tenant = await resolveActiveTenantContext();
  if (tenant?.organizationSlug) {
    revalidatePath(`/${tenant.organizationSlug}/admin/settings`);
  }
}

function getPreferredModelSetting(candidate: ModelSettingsRecord, current?: ModelSettingsRecord) {
  if (!current) return candidate;
  if (candidate.is_active !== current.is_active) {
    return candidate.is_active ? candidate : current;
  }
  return candidate.id > current.id ? candidate : current;
}

function mapSettingsByType(settings: ModelSettingsRecord[]) {
  const byType = new Map<string, ModelSettingsRecord>();
  settings.forEach((setting) => {
    byType.set(
      setting.setting_type,
      getPreferredModelSetting(setting, byType.get(setting.setting_type)),
    );
  });
  return byType;
}

export async function getSystemPromptsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getResolvedActiveOrgId();
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

    const activeOrgId = await getResolvedActiveOrgId();
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

      await revalidateSettingsPaths();
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

    await revalidateSettingsPaths();
    return { success: true, prompt: data as SystemPrompt };
}

export async function getModelSettingsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getResolvedActiveOrgId();
  const supabaseAdmin = getAdminClient();

  // Fetch globals as baseline
  const { data: globalData, error } = await supabaseAdmin
    .from('model_settings')
    .select(MODEL_SETTINGS_SELECT_FIELDS)
    .eq('is_active', true)
    .is('organization_id', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching model settings:', error);
    return { success: false, error: error.message };
  }

  const globalByType = mapSettingsByType((globalData || []) as ModelSettingsRecord[]);
  const baselineSettings = MODEL_SETTING_TYPES.map((settingType, index) => {
    const global = globalByType.get(settingType);
    return global ?? {
      id: -(index + 1),
      ...DEFAULT_MODEL_SETTINGS_BY_TYPE[settingType],
    };
  });

  if (!activeOrgId) {
    return { success: true, settings: baselineSettings };
  }

  // Fetch org-specific overrides
  const { data: orgData } = await supabaseAdmin
    .from('model_settings')
    .select(MODEL_SETTINGS_SELECT_FIELDS)
    .eq('is_active', true)
    .eq('organization_id', activeOrgId)
    .order('id', { ascending: true });

  const orgSettings = (orgData || []) as ModelSettingsRecord[];
  const orgByType = mapSettingsByType(orgSettings);
  const merged = baselineSettings.map((setting) => orgByType.get(setting.setting_type) ?? setting);

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

  const activeOrgId = await getResolvedActiveOrgId();

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

  await revalidateSettingsPaths();
  return { success: true };
}

// Actualiza un batch completo de configuraciones de modelo
export async function updateModelSettingsAction(settings: ModelSettingsUpdateInput[]) {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const activeOrgId = await getResolvedActiveOrgId();
  const supabaseAdmin = getAdminClient();
  
  const updates = settings.map(async (setting) => {
    const payload = {
      model_name: setting.model_name,
      fallback_model: setting.fallback_model,
      temperature: setting.temperature,
      thinking_level: setting.thinking_level,
      is_active: true,
      setting_type: setting.setting_type,
      organization_id: activeOrgId || null,
    };

    if (!activeOrgId && setting.id > 0) {
      return supabaseAdmin.from('model_settings').update(payload).eq('id', setting.id);
    }

    if (activeOrgId) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('model_settings')
        .select('id')
        .eq('organization_id', activeOrgId)
        .eq('setting_type', setting.setting_type)
        .eq('is_active', true)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        return { error: existingError };
      }

      if (existing?.id) {
        return supabaseAdmin.from('model_settings').update(payload).eq('id', existing.id);
      }
    }

    return supabaseAdmin.from('model_settings').insert(payload);
  });

  const results = await Promise.all(updates);
  const errors = results.filter((result) => result.error);

  if (errors.length > 0) {
    console.error('Model settings update errors:', errors);
    return { success: false, error: 'Algunas configuraciones fallaron al guardarse' };
  }

  await revalidateSettingsPaths();
  return { success: true };
}
