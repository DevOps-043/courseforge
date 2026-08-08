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
  scope?: string | null;
  setting_type: string;
  temperature?: number | null;
  thinking_level?: string | null;
}

export interface ModelSettingsRecord extends ModelSettingsUpdateInput {
  is_active: boolean;
  setting_type: string;
}

const SYSTEM_PROMPT_SELECT_FIELDS =
  'id, code, scope, version, organization_id, content, description, is_active, parent_prompt_id, source, change_summary, created_by, created_at, updated_at';
const MODEL_SETTINGS_SELECT_FIELDS =
  'id, model_name, fallback_model, temperature, thinking_level, scope, setting_type, is_active';
const MODEL_SETTING_TYPES = [
  'ARTIFACT_BASE',
  'SYLLABUS',
  'INSTRUCTIONAL_PLAN',
  'CURATION',
  'MATERIALS',
  'BUNDLE_AGENT',
  'SLIDES_DECK_BRIEF_AGENT',
  'SLIDES_EVIDENCE_AGENT',
  'SLIDES_STRATEGY_AGENT',
  'SLIDE_TEMPLATE_TYPE_AGENT',
  'SLIDES_VISIBLE_COPY_AGENT',
  'SLIDES_VISUAL_TEMPLATE_AGENT',
  'SLIDES_QA_AGENT',
] as const;
const DEFAULT_MODEL_SETTINGS_BY_TYPE: Record<(typeof MODEL_SETTING_TYPES)[number], Omit<ModelSettingsRecord, 'id'>> = {
  ARTIFACT_BASE: {
    model_name: 'gemini-2.0-flash',
    fallback_model: 'gpt-4o-mini',
    temperature: 0.7,
    thinking_level: 'medium',
    scope: 'Cursos',
    setting_type: 'ARTIFACT_BASE',
    is_active: true,
  },
  SYLLABUS: {
    model_name: 'gemini-2.0-flash',
    fallback_model: 'gpt-4o-mini',
    temperature: 0.7,
    thinking_level: 'medium',
    scope: 'Cursos',
    setting_type: 'SYLLABUS',
    is_active: true,
  },
  INSTRUCTIONAL_PLAN: {
    model_name: 'gemini-2.0-flash',
    fallback_model: 'gpt-4o-mini',
    temperature: 0.7,
    thinking_level: 'medium',
    scope: 'Cursos',
    setting_type: 'INSTRUCTIONAL_PLAN',
    is_active: true,
  },
  CURATION: {
    model_name: 'gpt-4o-mini',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.1,
    thinking_level: 'low',
    scope: 'Cursos',
    setting_type: 'CURATION',
    is_active: true,
  },
  MATERIALS: {
    model_name: 'gpt-4o',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.7,
    thinking_level: 'minimal',
    scope: 'Cursos',
    setting_type: 'MATERIALS',
    is_active: true,
  },
  BUNDLE_AGENT: {
    model_name: 'gemini-2.5-flash',
    fallback_model: 'gpt-4.1-mini',
    temperature: 0.3,
    thinking_level: 'medium',
    scope: 'Modulos: Bundle',
    setting_type: 'BUNDLE_AGENT',
    is_active: true,
  },
  SLIDES_DECK_BRIEF_AGENT: {
    model_name: 'gpt-4o-mini',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.2,
    thinking_level: 'low',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_DECK_BRIEF_AGENT',
    is_active: true,
  },
  SLIDES_EVIDENCE_AGENT: {
    model_name: 'gpt-4o-mini',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.1,
    thinking_level: 'low',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_EVIDENCE_AGENT',
    is_active: true,
  },
  SLIDES_STRATEGY_AGENT: {
    model_name: 'gpt-4o',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.3,
    thinking_level: 'medium',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_STRATEGY_AGENT',
    is_active: true,
  },
  SLIDE_TEMPLATE_TYPE_AGENT: {
    model_name: 'gpt-4o',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.45,
    thinking_level: 'medium',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDE_TEMPLATE_TYPE_AGENT',
    is_active: true,
  },
  SLIDES_VISIBLE_COPY_AGENT: {
    model_name: 'gpt-4o-mini',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.3,
    thinking_level: 'low',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_VISIBLE_COPY_AGENT',
    is_active: true,
  },
  SLIDES_VISUAL_TEMPLATE_AGENT: {
    model_name: 'gpt-4o',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.5,
    thinking_level: 'medium',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_VISUAL_TEMPLATE_AGENT',
    is_active: true,
  },
  SLIDES_QA_AGENT: {
    model_name: 'gpt-4o-mini',
    fallback_model: 'gemini-2.0-flash',
    temperature: 0.1,
    thinking_level: 'low',
    scope: 'Modulos: Slides',
    setting_type: 'SLIDES_QA_AGENT',
    is_active: true,
  },
};

// Helper for admin client that bypasses the RLS if the session token is not understood by PostgREST
function getAdminClient() {
  return createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
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

function dedupeActiveSystemPromptsByCode(prompts: SystemPrompt[]) {
  const promptsByCode = new Map<string, SystemPrompt>();

  for (const prompt of prompts) {
    const current = promptsByCode.get(prompt.code);
    if (!current || isPreferredSystemPrompt(prompt, current)) {
      promptsByCode.set(prompt.code, prompt);
    }
  }

  return Array.from(promptsByCode.values());
}

function parseSemver(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function comparePromptVersions(left: string, right: string) {
  const leftSemver = parseSemver(left);
  const rightSemver = parseSemver(right);

  if (leftSemver && rightSemver) {
    return (
      leftSemver.major - rightSemver.major ||
      leftSemver.minor - rightSemver.minor ||
      leftSemver.patch - rightSemver.patch
    );
  }

  return left.localeCompare(right);
}

function getNextPromptVersion(versions: string[], baseVersion = '1.0.0') {
  const parsedVersions = versions
    .map(parseSemver)
    .filter((version): version is NonNullable<ReturnType<typeof parseSemver>> => Boolean(version));

  if (parsedVersions.length === 0) {
    const base = parseSemver(baseVersion) ?? { major: 1, minor: 0, patch: 0 };
    return `${base.major}.${base.minor}.${base.patch + 1}`;
  }

  parsedVersions.sort((left, right) => (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  ));

  const latest = parsedVersions[parsedVersions.length - 1];
  return `${latest.major}.${latest.minor}.${latest.patch + 1}`;
}

function promptsHaveSameContent(prompt: SystemPrompt, next: UpdateSystemPromptDTO) {
  return (
    prompt.content === next.content &&
    (next.description === undefined || prompt.description === next.description) &&
    (next.is_active === undefined || prompt.is_active === next.is_active)
  );
}

async function getPromptVersionsForScope(params: {
  code: string;
  organizationId: string | null;
  supabaseAdmin: ReturnType<typeof getAdminClient>;
}) {
  let query = params.supabaseAdmin
    .from('system_prompts')
    .select('version')
    .eq('code', params.code);

  query = params.organizationId
    ? query.eq('organization_id', params.organizationId)
    : query.is('organization_id', null);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return ((data || []) as Array<{ version: string }>).map((row) => row.version);
}

async function deactivateActivePromptForScope(params: {
  code: string;
  organizationId: string | null;
  supabaseAdmin: ReturnType<typeof getAdminClient>;
}) {
  let query = params.supabaseAdmin
    .from('system_prompts')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('code', params.code)
    .eq('is_active', true);

  query = params.organizationId
    ? query.eq('organization_id', params.organizationId)
    : query.is('organization_id', null);

  const { error } = await query;

  if (error) {
    throw error;
  }
}

async function insertPromptVersion(params: {
  basePrompt: SystemPrompt;
  content: string;
  createdBy: string;
  description?: string | null;
  organizationId: string | null;
  source: string;
  changeSummary?: string | null;
  supabaseAdmin: ReturnType<typeof getAdminClient>;
}) {
  const versions = await getPromptVersionsForScope({
    code: params.basePrompt.code,
    organizationId: params.organizationId,
    supabaseAdmin: params.supabaseAdmin,
  });
  const nextVersion = getNextPromptVersion(versions, params.basePrompt.version);

  await deactivateActivePromptForScope({
    code: params.basePrompt.code,
    organizationId: params.organizationId,
    supabaseAdmin: params.supabaseAdmin,
  });

  const now = new Date().toISOString();
  const { data, error } = await params.supabaseAdmin
    .from('system_prompts')
    .insert({
      code: params.basePrompt.code,
      scope: params.basePrompt.scope || 'Cursos',
      version: nextVersion,
      organization_id: params.organizationId,
      content: params.content,
      description: params.description ?? params.basePrompt.description,
      is_active: true,
      parent_prompt_id: params.basePrompt.id,
      source: params.source,
      change_summary: params.changeSummary ?? null,
      created_by: params.createdBy,
      created_at: now,
      updated_at: now,
    })
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .single();

  if (error) {
    throw error;
  }

  return data as SystemPrompt;
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
    .eq('is_active', true)
    .order('code', { ascending: true })
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error fetching prompts:', error);
    return { success: false, error: error.message };
  }

  const globalPrompts = dedupeActiveSystemPromptsByCode((globalData || []) as SystemPrompt[]);

  // If no active org, return globals only
  if (!activeOrgId) {
    return { success: true, prompts: globalPrompts };
  }

  // Fetch org-specific prompts and overlay them over globals by code
  const { data: orgData, error: orgError } = await supabaseAdmin
    .from('system_prompts')
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .eq('organization_id', activeOrgId)
    .eq('is_active', true)
    .order('code', { ascending: true })
    .order('updated_at', { ascending: false });

  if (orgError) {
    console.error('Error fetching organization prompts:', orgError);
    return { success: false, error: orgError.message };
  }

  const orgPrompts = dedupeActiveSystemPromptsByCode((orgData || []) as SystemPrompt[]);
  const orgByCode = new Map(orgPrompts.map((p) => [p.code, p]));

  // Merge: org-specific active prompts override global active prompts by code.
  const merged = globalPrompts.map((global) => {
    const override = orgByCode.get(global.code);
    return override
      ? {
          ...override,
          is_org_override: true,
          is_restored_default: override.source === 'RESTORE_DEFAULT',
        }
      : global;
  });

  // Add any org-specific codes that don't exist as globals
  for (const orgPrompt of orgPrompts) {
    const existsInMerged = merged.some(
      (prompt) => prompt.code === orgPrompt.code,
    );

    if (!existsInMerged) {
      merged.push({
        ...orgPrompt,
        is_org_override: true,
        is_restored_default: orgPrompt.source === 'RESTORE_DEFAULT',
      });
    }
  }

  merged.sort((a, b) => {
    return a.code.localeCompare(b.code);
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

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('system_prompts')
      .select(SYSTEM_PROMPT_SELECT_FIELDS)
      .eq('id', prompt.id)
      .single();

    if (existingError || !existing) {
      return { success: false, error: existingError?.message || 'Prompt no encontrado' };
    }

    const existingPrompt = existing as SystemPrompt;
    if (promptsHaveSameContent(existingPrompt, prompt)) {
      return {
        success: true,
        prompt: {
          ...existingPrompt,
          is_org_override: Boolean(existingPrompt.organization_id),
          is_restored_default: existingPrompt.source === 'RESTORE_DEFAULT',
        },
      };
    }

    const targetOrganizationId = activeOrgId || existingPrompt.organization_id || null;

    try {
      const data = await insertPromptVersion({
        basePrompt: existingPrompt,
        content: prompt.content,
        description: prompt.description,
        organizationId: targetOrganizationId,
        source: targetOrganizationId ? 'ORG_EDIT' : 'GLOBAL_EDIT',
        changeSummary: prompt.change_summary || null,
        createdBy: user.id,
        supabaseAdmin,
      });

      await revalidateSettingsPaths();
      return {
        success: true,
        prompt: {
          ...data,
          is_org_override: Boolean(targetOrganizationId),
          is_restored_default: data.source === 'RESTORE_DEFAULT',
        } as SystemPrompt,
      };
    } catch (error) {
      console.error('Error creating prompt version:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al versionar el prompt',
      };
    }

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

  const [{ data: activeOrgPrompt, error: orgError }, { data: globalPrompt, error: globalError }] =
    await Promise.all([
      supabaseAdmin
        .from('system_prompts')
        .select(SYSTEM_PROMPT_SELECT_FIELDS)
        .eq('code', promptCode)
        .eq('organization_id', activeOrgId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from('system_prompts')
        .select(SYSTEM_PROMPT_SELECT_FIELDS)
        .eq('code', promptCode)
        .is('organization_id', null)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (orgError || globalError) {
    const error = orgError || globalError;
    console.error('Error loading prompt for reset:', error);
    return { success: false, error: error?.message || 'Error cargando prompt default' };
  }

  if (!globalPrompt) {
    return { success: false, error: 'No existe un prompt global default para restaurar' };
  }

  const basePrompt = ((activeOrgPrompt || globalPrompt) as SystemPrompt);
  const defaultPrompt = globalPrompt as SystemPrompt;

  try {
    const data = await insertPromptVersion({
      basePrompt,
      content: defaultPrompt.content,
      description: defaultPrompt.description,
      organizationId: activeOrgId,
      source: 'RESTORE_DEFAULT',
      changeSummary: `Restaurado desde default global ${defaultPrompt.version}`,
      createdBy: user.id,
      supabaseAdmin,
    });

    await revalidateSettingsPaths();
    return {
      success: true,
      prompt: {
        ...data,
        is_org_override: true,
        is_restored_default: true,
      } as SystemPrompt,
    };
  } catch (error) {
    console.error('Error resetting prompt to default:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al restaurar el prompt',
    };
  }
}

export async function getSystemPromptHistoryAction(promptCode: string) {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const activeOrgId = await getResolvedActiveOrgId();
  const supabaseAdmin = getAdminClient();

  const { data: globalRows, error: globalError } = await supabaseAdmin
    .from('system_prompts')
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .eq('code', promptCode)
    .is('organization_id', null)
    .order('created_at', { ascending: false });

  if (globalError) {
    console.error('Error fetching global prompt history:', globalError);
    return { success: false, error: globalError.message };
  }

  const orgRowsPromise = activeOrgId
    ? supabaseAdmin
        .from('system_prompts')
        .select(SYSTEM_PROMPT_SELECT_FIELDS)
        .eq('code', promptCode)
        .eq('organization_id', activeOrgId)
        .order('created_at', { ascending: false })
    : Promise.resolve({ data: [], error: null });

  const { data: orgRows, error: orgError } = await orgRowsPromise;

  if (orgError) {
    console.error('Error fetching organization prompt history:', orgError);
    return { success: false, error: orgError.message };
  }

  const history = [
    ...((orgRows || []) as SystemPrompt[]).map((prompt) => ({
      ...prompt,
      is_org_override: true,
      is_restored_default: prompt.source === 'RESTORE_DEFAULT',
    })),
    ...((globalRows || []) as SystemPrompt[]),
  ];

  history.sort((a, b) => {
    const activeComparison = Number(b.is_active) - Number(a.is_active);
    if (activeComparison !== 0) return activeComparison;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
      comparePromptVersions(b.version, a.version)
    );
  });

  return { success: true, prompts: history };
}

export async function restorePromptVersionAction(promptId: string) {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }

  const activeOrgId = await getResolvedActiveOrgId();

  if (!activeOrgId) {
    return { success: false, error: 'No hay organizacion activa' };
  }

  const supabaseAdmin = getAdminClient();
  const { data: selected, error: selectedError } = await supabaseAdmin
    .from('system_prompts')
    .select(SYSTEM_PROMPT_SELECT_FIELDS)
    .eq('id', promptId)
    .single();

  if (selectedError || !selected) {
    return { success: false, error: selectedError?.message || 'Version de prompt no encontrada' };
  }

  const selectedPrompt = selected as SystemPrompt;
  const isAllowedScope =
    !selectedPrompt.organization_id || selectedPrompt.organization_id === activeOrgId;

  if (!isAllowedScope) {
    return { success: false, error: 'No puedes restaurar una version de otra organizacion' };
  }

  try {
    const data = await insertPromptVersion({
      basePrompt: selectedPrompt,
      content: selectedPrompt.content,
      description: selectedPrompt.description,
      organizationId: activeOrgId,
      source: selectedPrompt.organization_id ? 'RESTORE_VERSION' : 'RESTORE_DEFAULT',
      changeSummary: `Restaurado desde ${selectedPrompt.code} v${selectedPrompt.version}`,
      createdBy: user.id,
      supabaseAdmin,
    });

    await revalidateSettingsPaths();
    return {
      success: true,
      prompt: {
        ...data,
        is_org_override: true,
        is_restored_default: data.source === 'RESTORE_DEFAULT',
      } as SystemPrompt,
    };
  } catch (error) {
    console.error('Error restoring prompt version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al restaurar version',
    };
  }
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
        scope: setting.scope || DEFAULT_MODEL_SETTINGS_BY_TYPE[setting.setting_type as keyof typeof DEFAULT_MODEL_SETTINGS_BY_TYPE]?.scope || 'Cursos',
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
