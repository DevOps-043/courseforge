'use server';

import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { SystemPrompt, UpdateSystemPromptDTO } from '@/domains/prompts/types';
import { revalidatePath } from 'next/cache';
import { getActiveOrganizationId, getAuthBridgeUser } from '@/utils/auth/session';

// Helper for admin client that bypasses the RLS if the session token is not understood by PostgREST
function getAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey);
}

export async function getSystemPromptsAction() {
  const user = await getAuthBridgeUser();

  if (!user) {
    return { success: false, error: 'Unauthorized' };
  }
  const activeOrgId = await getActiveOrganizationId();
  const supabaseAdmin = getAdminClient();

  // 1. Fetch global prompts (organization_id IS NULL) — these are the defaults
  const { data: globalData, error: globalError } = await supabaseAdmin
    .from('system_prompts')
    .select('*')
    .is('organization_id', null)
    .order('code', { ascending: true });

  if (globalError) {
    console.error('Error fetching global prompts:', globalError);
    return { success: false, error: globalError.message };
  }

  const globalPrompts = (globalData || []) as SystemPrompt[];

  // 2. If there's an active org, fetch org-specific overrides
  if (activeOrgId) {
    const { data: orgData } = await supabaseAdmin
      .from('system_prompts')
      .select('*')
      .eq('organization_id', activeOrgId)
      .order('code', { ascending: true });

    if (orgData && orgData.length > 0) {
      // Merge: org-specific prompts take priority, global fills the gaps
      const orgMap = new Map((orgData as SystemPrompt[]).map(p => [p.code, p]));
      const merged: SystemPrompt[] = [];

      // First add all global prompts, replacing with org override if exists
      for (const gp of globalPrompts) {
        merged.push(orgMap.get(gp.code) || gp);
        orgMap.delete(gp.code);
      }
      // Then add any org-specific prompts that don't exist globally
      for (const op of orgMap.values()) {
        merged.push(op);
      }

      return { success: true, prompts: merged };
    }
  }

  // 3. No org or no org-specific overrides — return globals
  return { success: true, prompts: globalPrompts };
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
    const { data: orgData, error: orgError } = await supabaseAdmin
      .from('model_settings')
      .select('*')
      .eq('is_active', true)
      .eq('organization_id', activeOrgId)
      .order('id', { ascending: true });

    if (orgData && orgData.length > 0) {
      return { success: true, settings: orgData };
    }
  }

  // Fallback a globales
  const { data, error } = await supabaseAdmin
    .from('model_settings')
    .select('*')
    .eq('is_active', true)
    .is('organization_id', null)
    .order('id', { ascending: true });

  if (error) {
    console.error('Error fetching model settings:', error);
    return { success: false, error: error.message };
  }

  return { success: true, settings: data };
}

// Actualiza un batch completo de configuraciones de modelo
export async function updateModelSettingsAction(settings: any[]) {
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
