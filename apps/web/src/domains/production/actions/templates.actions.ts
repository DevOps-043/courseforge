"use server";

import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getActiveOrganizationId } from "@/utils/auth/session";
import {
  createTemplateConfigSchemaDefinition,
  parseTemplateRenderConfig,
  type TemplateRenderConfigInput,
} from "@/remotion/template-config";

const SUPPORTED_INTERNAL_COMPOSITIONS = new Set(["full-slides", "split-avatar", "avatar-focus"]);
const DEFAULT_RENDER_COMPOSITION_ID = "full-slides";

export type RemotionTemplateRenderMode =
  | "SUPPORTED_INTERNAL"
  | "INTERNAL_WITH_EXTERNAL_REFERENCE"
  | "EXTERNAL_BUNDLE_PENDING"
  | "FALLBACK_INTERNAL";

export type RemotionTemplateBundleStatus =
  | "NOT_APPLICABLE"
  | "STORED_REFERENCE"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED";

function resolveSupportedCompositionId(compositionId: string | null | undefined) {
  return compositionId && SUPPORTED_INTERNAL_COMPOSITIONS.has(compositionId)
    ? compositionId
    : DEFAULT_RENDER_COMPOSITION_ID;
}

async function getAuthorizedSupabase() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);

  if (!authenticatedUser) {
    return { error: "Unauthorized" as const, supabase, user: null };
  }

  return { error: null, supabase, user: authenticatedUser };
}

export interface RemotionTemplate {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  entry_point: string;
  /** Slug estable de la composición Remotion a renderizar (ver Root.tsx). */
  composition_id: string | null;
  config_schema: Record<string, any>;
  default_config: Record<string, any>;
  bundle_status: RemotionTemplateBundleStatus | null;
  is_public: boolean;
  storage_path: string | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  organization?: {
    name: string;
  } | null;
  render_mode: RemotionTemplateRenderMode;
  render_composition_id: string;
  is_external_bundle_supported: boolean;
  render_status_label: string;
}

function decorateTemplate(template: Omit<RemotionTemplate, "render_mode" | "render_composition_id" | "is_external_bundle_supported" | "render_status_label">): RemotionTemplate {
  const hasSupportedComposition = Boolean(
    template.composition_id && SUPPORTED_INTERNAL_COMPOSITIONS.has(template.composition_id),
  );
  const hasExternalBundle = Boolean(template.storage_path);
  const renderCompositionId = hasSupportedComposition ? template.composition_id! : DEFAULT_RENDER_COMPOSITION_ID;
  const bundleStatus = template.bundle_status || (hasExternalBundle ? "STORED_REFERENCE" : "NOT_APPLICABLE");

  let renderMode: RemotionTemplateRenderMode = "FALLBACK_INTERNAL";
  let renderStatusLabel = `Render interno: ${renderCompositionId}`;

  if (hasSupportedComposition && hasExternalBundle) {
    renderMode = "INTERNAL_WITH_EXTERNAL_REFERENCE";
    renderStatusLabel = `Renderizable ahora: ${renderCompositionId}. ZIP guardado como referencia (${bundleStatus})`;
  } else if (hasSupportedComposition) {
    renderMode = "SUPPORTED_INTERNAL";
    renderStatusLabel = `Renderizable ahora: ${renderCompositionId}`;
  } else if (hasExternalBundle) {
    renderMode = "EXTERNAL_BUNDLE_PENDING";
    renderStatusLabel = `ZIP guardado como referencia; se usara ${DEFAULT_RENDER_COMPOSITION_ID}`;
  }

  return {
    ...template,
    config_schema: template.config_schema || createTemplateConfigSchemaDefinition(),
    default_config: parseTemplateRenderConfig(template.default_config),
    bundle_status: bundleStatus,
    render_mode: renderMode,
    render_composition_id: renderCompositionId,
    is_external_bundle_supported: false,
    render_status_label: renderStatusLabel,
  };
}

function decorateTemplates(templates: Array<Omit<RemotionTemplate, "render_mode" | "render_composition_id" | "is_external_bundle_supported" | "render_status_label">>): RemotionTemplate[] {
  return templates.map(decorateTemplate);
}

/**
 * Fetches templates available to the active organization:
 * - Global system templates (organization_id IS NULL)
 * - Templates owned by the active organization
 * - Templates acquired from other organizations
 */
export async function getTemplatesAction(): Promise<{
  success: boolean;
  templates?: RemotionTemplate[];
  error?: string;
}> {
  const { error: authError } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const activeOrgId = await getActiveOrganizationId();
  const admin = getServiceRoleClient();

  try {
    // 1. Fetch system templates + owned templates
    let query = admin
      .from("remotion_templates")
      .select("*, organization:organizations!remotion_templates_organization_id_fkey(name)");
    
    if (activeOrgId) {
      query = query.or(`organization_id.is.null,organization_id.eq.${activeOrgId}`);
    } else {
      query = query.is("organization_id", null);
    }

    const { data: ownedTemplates, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    // 2. Fetch acquired templates for this organization
    let acquiredTemplates: any[] = [];
    if (activeOrgId) {
      const { data: acquiredData, error: acquiredError } = await admin
        .from("organization_acquired_templates")
        .select("template:remotion_templates(*, organization:organizations!remotion_templates_organization_id_fkey(name))")
        .eq("organization_id", activeOrgId);
      
      if (acquiredError) throw acquiredError;
      if (acquiredData) {
        acquiredTemplates = acquiredData.map((d: any) => d.template).filter(Boolean);
      }
    }

    // Merge and de-duplicate by ID
    const merged = decorateTemplates([...(ownedTemplates || []), ...acquiredTemplates]);
    const uniqueMap = new Map<string, RemotionTemplate>();
    merged.forEach((item) => {
      uniqueMap.set(item.id, item);
    });

    const templates = Array.from(uniqueMap.values()).sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return { success: true, templates };
  } catch (error: any) {
    console.error("[TemplatesActions] Error fetching templates:", error);
    return { success: false, error: error.message || "Error al obtener plantillas" };
  }
}

/**
 * Fetches public templates owned by other organizations that have NOT been acquired
 */
export async function getPublicTemplatesAction(): Promise<{
  success: boolean;
  templates?: RemotionTemplate[];
  error?: string;
}> {
  const { error: authError } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: true, templates: [] };

  const admin = getServiceRoleClient();

  try {
    // Get owned and acquired templates to exclude them
    const { data: owned } = await admin
      .from("remotion_templates")
      .select("id")
      .or(`organization_id.is.null,organization_id.eq.${activeOrgId}`);

    const { data: acquired } = await admin
      .from("organization_acquired_templates")
      .select("template_id")
      .eq("organization_id", activeOrgId);

    const excludedIds = [
      ...(owned?.map((t) => t.id) || []),
      ...(acquired?.map((t) => t.template_id) || []),
    ];

    let query = admin
      .from("remotion_templates")
      .select("*, organization:organizations!remotion_templates_organization_id_fkey(name)")
      .eq("is_public", true);

    if (excludedIds.length > 0) {
      query = query.not("id", "in", `(${excludedIds.join(",")})`);
    }

    const { data: publicTemplates, error } = await query;
    if (error) throw error;

    return { success: true, templates: decorateTemplates(publicTemplates || []) };
  } catch (error: any) {
    console.error("[TemplatesActions] Error fetching public templates:", error);
    return { success: false, error: error.message || "Error al obtener plantillas públicas" };
  }
}

/**
 * Creates a new template for the active organization
 */
export async function createTemplateAction(params: {
  name: string;
  description?: string;
  entryPoint?: string;
  compositionId?: string;
  isPublic?: boolean;
  storagePath?: string | null;
  thumbnailUrl?: string;
  configSchema?: Record<string, any>;
  defaultConfig?: TemplateRenderConfigInput;
}): Promise<{
  success: boolean;
  template?: RemotionTemplate;
  error?: string;
}> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    const { data, error } = await admin
      .from("remotion_templates")
      .insert({
        organization_id: activeOrgId,
        name: params.name,
        description: params.description || null,
        entry_point: params.entryPoint || "src/index.tsx",
        composition_id: resolveSupportedCompositionId(params.compositionId),
        is_public: params.isPublic || false,
        storage_path: params.storagePath || null,
        thumbnail_url: params.thumbnailUrl || null,
        config_schema: params.configSchema || createTemplateConfigSchemaDefinition(),
        default_config: parseTemplateRenderConfig(params.defaultConfig),
        bundle_status: params.storagePath ? "STORED_REFERENCE" : "NOT_APPLICABLE",
      })
      .select("*, organization:organizations!remotion_templates_organization_id_fkey(name)")
      .single();

    if (error) throw error;

    return { success: true, template: decorateTemplate(data) };
  } catch (error: any) {
    console.error("[TemplatesActions] Error creating template:", error);
    return { success: false, error: error.message || "Error al crear la plantilla" };
  }
}

/**
 * Updates an existing template. User must belong to the template's owner organization.
 */
export async function updateTemplateAction(
  templateId: string,
  updates: {
    name?: string;
    description?: string;
    entryPoint?: string;
    compositionId?: string;
    isPublic?: boolean;
    storagePath?: string | null;
    thumbnailUrl?: string;
    configSchema?: Record<string, any>;
    defaultConfig?: TemplateRenderConfigInput;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // Verify ownership
    const { data: template, error: fetchError } = await admin
      .from("remotion_templates")
      .select("organization_id")
      .eq("id", templateId)
      .single();

    if (fetchError || !template) throw new Error("Plantilla no encontrada");
    if (template.organization_id !== activeOrgId) {
      throw new Error("No tienes permiso para modificar esta plantilla");
    }

    const { error } = await admin
      .from("remotion_templates")
      .update({
        name: updates.name,
        description: updates.description,
        entry_point: updates.entryPoint,
        composition_id: updates.compositionId ? resolveSupportedCompositionId(updates.compositionId) : undefined,
        is_public: updates.isPublic,
        storage_path: updates.storagePath,
        thumbnail_url: updates.thumbnailUrl,
        config_schema: updates.configSchema,
        default_config: updates.defaultConfig ? parseTemplateRenderConfig(updates.defaultConfig) : undefined,
        bundle_status: updates.storagePath
          ? "STORED_REFERENCE"
          : updates.storagePath === null
            ? "NOT_APPLICABLE"
            : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error updating template:", error);
    return { success: false, error: error.message || "Error al actualizar plantilla" };
  }
}

/**
 * Subscribes the active organization to a public template owned by another organization
 */
export async function acquireTemplateAction(templateId: string): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // Verify template is public and doesn't belong to the active org
    const { data: template, error: checkError } = await admin
      .from("remotion_templates")
      .select("organization_id, is_public")
      .eq("id", templateId)
      .single();

    if (checkError || !template) throw new Error("Plantilla no encontrada");
    if (!template.is_public) throw new Error("Esta plantilla no es pública");
    if (template.organization_id === activeOrgId) {
      throw new Error("Esta plantilla ya pertenece a tu organización");
    }

    const { error } = await admin
      .from("organization_acquired_templates")
      .insert({
        organization_id: activeOrgId,
        template_id: templateId,
      });

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error acquiring template:", error);
    return { success: false, error: error.message || "Error al adquirir plantilla" };
  }
}

/**
 * Deletes a template if owned, or unsubscribes (removes acquisition link) if acquired
 */
export async function deleteTemplateAction(templateId: string): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    const { data: template, error: fetchError } = await admin
      .from("remotion_templates")
      .select("id, organization_id")
      .eq("id", templateId)
      .single();

    if (fetchError || !template) throw new Error("Plantilla no encontrada");

    if (template.organization_id === activeOrgId) {
      // Owner -> Delete entirely
      const { error } = await admin
        .from("remotion_templates")
        .delete()
        .eq("id", templateId);
      if (error) throw error;
    } else {
      // Acquired -> Just delete connection
      const { error } = await admin
        .from("organization_acquired_templates")
        .delete()
        .eq("organization_id", activeOrgId)
        .eq("template_id", templateId);
      if (error) throw error;
    }

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error deleting/unsubscribing template:", error);
    return { success: false, error: error.message || "Error al eliminar plantilla" };
  }
}
