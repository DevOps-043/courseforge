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

// Helper for admin client that bypasses the RLS if the session token is not understood by PostgREST
function getAdminClient() {
  return createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
}

export async function getSystemPromptsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getActiveOrganizationId();
  const supabaseAdmin = getAdminClient();

  if (activeOrgId) {
    const { data: orgData } = await supabaseAdmin
      .from('system_prompts')
      .select('id, code, version, content, description, is_active, created_at, updated_at')
      .eq('organization_id', activeOrgId)
      .order('code', { ascending: true });

    if (orgData && orgData.length > 0) {
      return { success: true, prompts: orgData as SystemPrompt[] };
    }
  }

  // Fallback a los globales (null org_id) si no hay específicos de la org
  const { data, error } = await supabaseAdmin
    .from('system_prompts')
    .select('id, code, version, content, description, is_active, created_at, updated_at')
    .is('organization_id', null)
    .order('code', { ascending: true });

  if (error) {
    console.error('Error fetching prompts:', error);
    return { success: false, error: error.message };
  }

  return { success: true, prompts: data as SystemPrompt[] };
}

export async function updateSystemPromptAction(prompt: UpdateSystemPromptDTO) {
    const user = await getAuthBridgeUser();
  
    if (!user) {
      return { success: false, error: 'Unauthorized' };
    }
  
    const activeOrgId = await getActiveOrganizationId();
    const supabaseAdmin = getAdminClient();

    const { data, error } = await supabaseAdmin
      .from('system_prompts')
      .update({
          content: prompt.content,
          description: prompt.description,
          is_active: prompt.is_active,
          updated_at: new Date().toISOString(),
          ...(activeOrgId ? { organization_id: activeOrgId } : {})
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

  if (activeOrgId) {
    const { data: orgData } = await supabaseAdmin
      .from('model_settings')
      .select('id, model_name, fallback_model, temperature, thinking_level, setting_type, is_active')
      .eq('is_active', true)
      .eq('organization_id', activeOrgId)
      .order('id', { ascending: true });

    if (orgData && orgData.length > 0) {
      return { success: true, settings: orgData as ModelSettingsRecord[] };
    }
  }

  // Fallback a globales
  const { data, error } = await supabaseAdmin
    .from('model_settings')
    .select('id, model_name, fallback_model, temperature, thinking_level, setting_type, is_active')
    .eq('is_active', true)
    .is('organization_id', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching model settings:', error);
    return { success: false, error: error.message };
  }

  return { success: true, settings: data as ModelSettingsRecord[] };
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
