"use server";

import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import {
  getActiveOrganizationId,
  getAuthBridgeUser,
  getUserOrganizations,
} from "@/utils/auth/session";
import {
  createTemplateConfigSchemaDefinition,
  parseTemplateRenderConfig,
  type TemplateRenderConfigInput,
} from "@/remotion/template-config";
import { validateRemotionBundle } from "@/domains/production/validation/bundle-validator";

export interface RemotionTemplateVersion {
  id: string;
  template_id: string;
  organization_id: string;
  version_number: number;
  status:
    | "UPLOADED"
    | "VALIDATING"
    | "VALIDATION_FAILED"
    | "PENDING_REVIEW"
    | "APPROVED"
    | "APPROVED_FOR_SANDBOX"
    | "SANDBOX_VALIDATION_FAILED"
    | "REJECTED"
    | "DEPRECATED";
  storage_path: string;
  original_file_name: string | null;
  bundle_hash: string | null;
  entry_point: string | null;
  manifest: Record<string, any> | null;
  validation_report: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    info: {
      fileCount: number;
      unzippedSize: number;
      dependencies: Record<string, string>;
    };
  };
  validated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_profile?: {
    username: string | null;
    first_name: string | null;
    email: string | null;
  } | null;
  approved_by_profile?: {
    username: string | null;
    first_name: string | null;
    email: string | null;
  } | null;
  rejected_by_profile?: {
    username: string | null;
    first_name: string | null;
    email: string | null;
  } | null;
}

function getPathFromPublicUrl(publicUrl: string, bucket: string = "production-assets"): string {
  if (!publicUrl.startsWith("http")) return publicUrl;
  const marker = `/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  if (index !== -1) {
    return publicUrl.substring(index + marker.length);
  }
  return publicUrl;
}

function resolveBundleStorageLocation(storagePath: string) {
  if (storagePath.startsWith("production-assets/")) {
    return { bucket: "production-assets", path: storagePath.substring("production-assets/".length) };
  }

  if (storagePath.startsWith(`${TEMPLATE_BUNDLE_BUCKET}/`)) {
    return {
      bucket: TEMPLATE_BUNDLE_BUCKET,
      path: storagePath.substring(`${TEMPLATE_BUNDLE_BUCKET}/`.length),
    };
  }

  if (storagePath.startsWith("http")) {
    const templateBundlePath = getPathFromPublicUrl(storagePath, TEMPLATE_BUNDLE_BUCKET);
    if (templateBundlePath !== storagePath) {
      return { bucket: TEMPLATE_BUNDLE_BUCKET, path: templateBundlePath };
    }

    return {
      bucket: "production-assets",
      path: getPathFromPublicUrl(storagePath, "production-assets"),
    };
  }

  return { bucket: TEMPLATE_BUNDLE_BUCKET, path: storagePath };
}

const SUPPORTED_INTERNAL_COMPOSITIONS = new Set(["full-slides", "split-avatar", "avatar-focus"]);
const DEFAULT_RENDER_COMPOSITION_ID = "full-slides";
const TEMPLATE_BUNDLE_BUCKET = "template-bundles";

export type RemotionTemplateRenderMode =
  | "SUPPORTED_INTERNAL"
  | "INTERNAL_WITH_EXTERNAL_REFERENCE"
  | "EXTERNAL_BUNDLE_PENDING"
  | "FALLBACK_INTERNAL";

export type RemotionTemplateBundleStatus =
  | "NOT_APPLICABLE"
  | "VALIDATING"
  | "STORED_REFERENCE"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "APPROVED_FOR_SANDBOX"
  | "SANDBOX_VALIDATION_FAILED"
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

async function resolveActiveTemplateOrganizationId(): Promise<string | null> {
  const activeOrgId = await getActiveOrganizationId();
  if (activeOrgId) return activeOrgId;

  const bridgeUser = await getAuthBridgeUser();
  if (bridgeUser?.active_organization_id) {
    return bridgeUser.active_organization_id;
  }

  if (Array.isArray(bridgeUser?.organization_ids) && bridgeUser.organization_ids.length > 0) {
    return bridgeUser.organization_ids[0];
  }

  const organizations = await getUserOrganizations();
  return organizations[0]?.id || null;
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

function sanitizeBundleFileSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "template";
}

export async function createTemplateBundleUploadPathAction(params: {
  templateId?: string | null;
  fileName: string;
}): Promise<{ success: boolean; bucket?: string; path?: string; error?: string }> {
  const { error: authError } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontrÃ³ organizaciÃ³n activa" };

  const scope = sanitizeBundleFileSegment(params.templateId || "new");
  const safeName = sanitizeBundleFileSegment(params.fileName).replace(/\.zip$/i, "");
  const entropy = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  return {
    success: true,
    bucket: TEMPLATE_BUNDLE_BUCKET,
    path: `organizations/${activeOrgId}/templates/${scope}/${entropy}_${safeName}.zip`,
  };
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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
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
  originalFileName?: string | null;
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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
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
        bundle_status: params.storagePath ? "VALIDATING" : "NOT_APPLICABLE",
      })
      .select("*, organization:organizations!remotion_templates_organization_id_fkey(name)")
      .single();

    if (error) throw error;

    if (params.storagePath) {
      await createTemplateVersionAction(data.id, params.storagePath, params.originalFileName || "template.zip");
    }

    // Refresh template to get final validation-updated status
    const { data: refreshed } = await admin
      .from("remotion_templates")
      .select("*, organization:organizations!remotion_templates_organization_id_fkey(name)")
      .eq("id", data.id)
      .single();

    return { success: true, template: decorateTemplate(refreshed || data) };
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
    originalFileName?: string | null;
    thumbnailUrl?: string;
    configSchema?: Record<string, any>;
    defaultConfig?: TemplateRenderConfigInput;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // Verify ownership
    const { data: template, error: fetchError } = await admin
      .from("remotion_templates")
      .select("organization_id, storage_path")
      .eq("id", templateId)
      .single();

    if (fetchError || !template) throw new Error("Plantilla no encontrada");
    if (template.organization_id !== activeOrgId) {
      throw new Error("No tienes permiso para modificar esta plantilla");
    }

    const isNewZip = updates.storagePath && updates.storagePath !== template.storage_path;

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
        bundle_status: isNewZip
          ? "VALIDATING"
          : updates.storagePath === null
            ? "NOT_APPLICABLE"
            : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId);

    if (error) throw error;

    if (isNewZip) {
      await createTemplateVersionAction(templateId, updates.storagePath!, updates.originalFileName || "template_update.zip");
    }

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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
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

/**
 * Creates a new template bundle version, downloads the ZIP, runs static validation,
 * and updates template status accordingly.
 */
export async function createTemplateVersionAction(
  templateId: string,
  storagePath: string,
  originalFileName: string
): Promise<{ success: boolean; version?: RemotionTemplateVersion; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // 1. Get template to ensure ownership/existence
    const { data: template, error: fetchError } = await admin
      .from("remotion_templates")
      .select("organization_id, bundle_status")
      .eq("id", templateId)
      .single();

    if (fetchError || !template) throw new Error("Plantilla no encontrada");
    if (template.organization_id !== activeOrgId) {
      throw new Error("No tienes permiso para modificar esta plantilla");
    }

    // 2. Fetch the ZIP from storage
    const bundleLocation = resolveBundleStorageLocation(storagePath);
    const { data: fileData, error: downloadError } = await admin.storage
      .from(bundleLocation.bucket)
      .download(bundleLocation.path);

    if (downloadError || !fileData) {
      throw new Error(`Error al descargar el bundle de almacenamiento: ${downloadError?.message || 'Archivo no encontrado'}`);
    }

    // Convert Blob to ArrayBuffer
    const arrayBuffer = await fileData.arrayBuffer();

    // 3. Run validation
    const report = await validateRemotionBundle(arrayBuffer, originalFileName);

    // 4. Determine next version number
    const { data: latest } = await admin
      .from("remotion_template_versions")
      .select("version_number")
      .eq("template_id", templateId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersionNumber = latest ? latest.version_number + 1 : 1;
    const status = report.isValid ? "PENDING_REVIEW" : "VALIDATION_FAILED";

    // 5. Create version record
    const { data: version, error: insertError } = await admin
      .from("remotion_template_versions")
      .insert({
        template_id: templateId,
        organization_id: activeOrgId,
        version_number: nextVersionNumber,
        status,
        storage_path: `${bundleLocation.bucket}/${bundleLocation.path}`,
        original_file_name: originalFileName,
        bundle_hash: report.info.hash,
        entry_point: report.info.manifest?.entryPoint || null,
        manifest: report.info.manifest || null,
        validation_report: {
          isValid: report.isValid,
          errors: report.errors,
          warnings: report.warnings,
          info: {
            fileCount: report.info.fileCount,
            unzippedSize: report.info.unzippedSize,
            dependencies: report.info.dependencies || {},
          }
        },
        validated_at: new Date().toISOString(),
        created_by: user.userId,
      })
      .select(`
        *,
        created_by_profile:profiles!created_by(username, first_name, email),
        approved_by_profile:profiles!approved_by(username, first_name, email),
        rejected_by_profile:profiles!rejected_by(username, first_name, email)
      `)
      .single();

    if (insertError) throw insertError;

    // 6. Update template bundle_status
    const newTemplateStatus = report.isValid ? "PENDING_REVIEW" : "REJECTED";
    await admin
      .from("remotion_templates")
      .update({
        bundle_status: newTemplateStatus,
        storage_path: `${bundleLocation.bucket}/${bundleLocation.path}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", templateId);

    return { success: true, version: version as any };
  } catch (error: any) {
    console.error("[TemplatesActions] Error creating version:", error);
    return { success: false, error: error.message || "Error al registrar la versión" };
  }
}

/**
 * Fetches all versions associated with a template
 */
export async function getTemplateVersionsAction(
  templateId: string
): Promise<{ success: boolean; versions?: RemotionTemplateVersion[]; error?: string }> {
  const { error: authError } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const admin = getServiceRoleClient();

  try {
    const { data: versions, error } = await admin
      .from("remotion_template_versions")
      .select(`
        *,
        created_by_profile:profiles!created_by(username, first_name, email),
        approved_by_profile:profiles!approved_by(username, first_name, email),
        rejected_by_profile:profiles!rejected_by(username, first_name, email)
      `)
      .eq("template_id", templateId)
      .order("version_number", { ascending: false });

    if (error) throw error;

    return { success: true, versions: versions as any[] };
  } catch (error: any) {
    console.error("[TemplatesActions] Error fetching template versions:", error);
    return { success: false, error: error.message || "Error al obtener versiones de la plantilla" };
  }
}

/**
 * Approves a template version, updating the active template code reference.
 */
export async function approveTemplateVersionAction(
  versionId: string
): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // 1. Verify role
    const { data: requesterProfile, error: profileError } = await admin
      .from("profiles")
      .select("platform_role")
      .eq("id", user.userId)
      .single();

    if (profileError || !requesterProfile) {
      throw new Error("No se pudo verificar el rol del usuario.");
    }

    const REVIEWER_ROLES = new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]);
    if (!REVIEWER_ROLES.has(requesterProfile.platform_role)) {
      throw new Error("No tienes permisos de revisor para aprobar bundles.");
    }

    // 2. Fetch version
    const { data: version, error: fetchVersionError } = await admin
      .from("remotion_template_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (fetchVersionError || !version) {
      throw new Error("Versión de plantilla no encontrada.");
    }

    if (version.status !== "PENDING_REVIEW") {
      throw new Error(`La versión no se puede aprobar en su estado actual: ${version.status}`);
    }

    // 3. Deprecate previous audit-approved versions. Sandbox-enabled versions
    // are demoted explicitly by approveTemplateVersionForSandboxAction.
    await admin
      .from("remotion_template_versions")
      .update({ status: "DEPRECATED" })
      .eq("template_id", version.template_id)
      .eq("status", "APPROVED");

    // 4. Approve this version
    const { error: approveError } = await admin
      .from("remotion_template_versions")
      .update({
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        approved_by: user.userId,
      })
      .eq("id", versionId);

    if (approveError) throw approveError;

    // 5. Update parent template config
    const manifest = version.manifest || {};
    const { error: updateTemplateError } = await admin
      .from("remotion_templates")
      .update({
        bundle_status: "APPROVED",
        storage_path: version.storage_path,
        entry_point: version.entry_point || "src/index.tsx",
        composition_id: manifest.compositionId || "full-slides",
        updated_at: new Date().toISOString(),
      })
      .eq("id", version.template_id);

    if (updateTemplateError) throw updateTemplateError;

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error approving version:", error);
    return { success: false, error: error.message || "Error al aprobar la versión" };
  }
}

/**
 * Enables a previously approved version for sandbox execution. This is separate
 * from audit approval so static validation + human review never imply runtime
 * execution permission.
 */
export async function approveTemplateVersionForSandboxAction(
  versionId: string
): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontrÃ³ organizaciÃ³n activa" };

  const admin = getServiceRoleClient();

  try {
    const { data: requesterProfile, error: profileError } = await admin
      .from("profiles")
      .select("platform_role")
      .eq("id", user.userId)
      .single();

    if (profileError || !requesterProfile) {
      throw new Error("No se pudo verificar el rol del usuario.");
    }

    const REVIEWER_ROLES = new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]);
    if (!REVIEWER_ROLES.has(requesterProfile.platform_role)) {
      throw new Error("No tienes permisos de revisor para habilitar bundles en sandbox.");
    }

    const { data: version, error: fetchVersionError } = await admin
      .from("remotion_template_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (fetchVersionError || !version) {
      throw new Error("VersiÃ³n de plantilla no encontrada.");
    }

    if (version.organization_id !== activeOrgId) {
      throw new Error("No tienes permiso para habilitar esta versiÃ³n.");
    }

    if (version.status !== "APPROVED") {
      throw new Error(`La versiÃ³n debe estar APPROVED antes de habilitar sandbox. Estado actual: ${version.status}`);
    }

    await admin
      .from("remotion_template_versions")
      .update({ status: "APPROVED" })
      .eq("template_id", version.template_id)
      .eq("status", "APPROVED_FOR_SANDBOX");

    const { error: approveError } = await admin
      .from("remotion_template_versions")
      .update({
        status: "APPROVED_FOR_SANDBOX",
        approved_at: new Date().toISOString(),
        approved_by: user.userId,
      })
      .eq("id", versionId);

    if (approveError) throw approveError;

    const manifest = version.manifest || {};
    const { error: updateTemplateError } = await admin
      .from("remotion_templates")
      .update({
        bundle_status: "APPROVED_FOR_SANDBOX",
        storage_path: version.storage_path,
        entry_point: version.entry_point || "src/index.tsx",
        composition_id: manifest.compositionId || "full-slides",
        updated_at: new Date().toISOString(),
      })
      .eq("id", version.template_id);

    if (updateTemplateError) throw updateTemplateError;

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error enabling sandbox version:", error);
    return { success: false, error: error.message || "Error al habilitar la versiÃ³n para sandbox" };
  }
}

/**
 * Rejects a template version with a given reason.
 */
export async function rejectTemplateVersionAction(
  versionId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const { error: authError, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "No autorizado" };

  const activeOrgId = await getActiveOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    // 1. Verify role
    const { data: requesterProfile, error: profileError } = await admin
      .from("profiles")
      .select("platform_role")
      .eq("id", user.userId)
      .single();

    if (profileError || !requesterProfile) {
      throw new Error("No se pudo verificar el rol del usuario.");
    }

    const REVIEWER_ROLES = new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]);
    if (!REVIEWER_ROLES.has(requesterProfile.platform_role)) {
      throw new Error("No tienes permisos de revisor para rechazar bundles.");
    }

    // 2. Fetch version
    const { data: version, error: fetchVersionError } = await admin
      .from("remotion_template_versions")
      .select("*")
      .eq("id", versionId)
      .single();

    if (fetchVersionError || !version) {
      throw new Error("Versión de plantilla no encontrada.");
    }

    // 3. Reject this version
    const { error: rejectError } = await admin
      .from("remotion_template_versions")
      .update({
        status: "REJECTED",
        rejected_at: new Date().toISOString(),
        rejected_by: user.userId,
        rejection_reason: reason,
      })
      .eq("id", versionId);

    if (rejectError) throw rejectError;

    // 4. Update parent template status if it was referencing this version
    const { data: template } = await admin
      .from("remotion_templates")
      .select("storage_path")
      .eq("id", version.template_id)
      .single();

    if (template && template.storage_path === version.storage_path) {
      await admin
        .from("remotion_templates")
        .update({
          bundle_status: "REJECTED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", version.template_id);
    }

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error rejecting version:", error);
    return { success: false, error: error.message || "Error al rechazar la versión" };
  }
}
