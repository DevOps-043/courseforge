"use server";

import { createClient } from "@/utils/supabase/server";
import { getAccessToken, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getAuthBridgeUser, getUserOrganizations } from "@/utils/auth/session";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { getProductionApiBaseUrl } from "@/lib/server/production-api-url";
import {
  createTemplateConfigSchemaDefinition,
  parseTemplateRenderConfig,
  type TemplateRenderConfigInput,
} from "@/remotion/template-config";
import type { EditableLayerDefinition } from "@/remotion/layout-overrides";
import { createTemplateVersionRecord } from "@/domains/production/templates/template-version.service";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";

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
  template_type: "simple" | "custom_bundle";
  export_mode: "component" | "root";
  composition_id: string | null;
  composition_ids: string[] | null;
  props_schema: Record<string, any> | null;
  default_props: Record<string, any> | null;
  default_duration_frames: number | null;
  default_fps: number | null;
  default_width: number | null;
  default_height: number | null;
  build_status: "PENDING" | "BUILDING" | "BUILT" | "BUILD_FAILED";
  build_hash: string | null;
  build_output_path: string | null;
  built_at: string | null;
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
  cloud_builds?: RemotionTemplateCloudBuild[];
}

const SUPPORTED_INTERNAL_COMPOSITIONS = new Set(["full-slides", "split-avatar", "avatar-focus"]);
const DEFAULT_RENDER_COMPOSITION_ID = "full-slides";
const COURSEFORGE_REMOTION_VERSION = "4.0.484";

function isValidExternalCompositionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (normalized.includes("/") || normalized.includes("\\")) return false;
  if (/\.html?$/i.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized);
}

function isValidatedCloudBuildLog(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized.includes("validated") &&
    normalized.includes(`remotionversion=${COURSEFORGE_REMOTION_VERSION.toLowerCase()}`);
}
const TEMPLATE_BUNDLE_BUCKET = "template-bundles";

export type RemotionTemplateRenderMode =
  | "SUPPORTED_INTERNAL"
  | "INTERNAL_WITH_EXTERNAL_REFERENCE"
  | "EXTERNAL_BUNDLE_SITE_READY"
  | "EXTERNAL_CLOUD_BUILD_READY"
  | "EXTERNAL_CLOUD_BUILD_FAILED"
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
  const tenant = await resolveActiveTenantContext();
  if (tenant?.organizationId) return tenant.organizationId;

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
  cloud_build_id?: string | null;
  cloud_build_status?: "BUILDING" | "BUILT" | "BUILD_FAILED" | null;
  cloud_build_provider_status?: string | null;
  cloud_build_serve_url?: string | null;
  cloud_build_output_storage_path?: string | null;
  cloud_build_composition_id?: string | null;
  cloud_build_validated?: boolean;
  template_version_id?: string | null;
  layout_contract_version?: number | null;
  editable_layers?: EditableLayerDefinition[];
}

interface RemotionTemplateCloudBuild {
  id: string;
  template_version_id: string;
  status: "BUILDING" | "BUILT" | "BUILD_FAILED";
  serve_url: string | null;
  build_output_storage_path?: string | null;
  cloud_provider?: string | null;
  composition_id: string | null;
  build_log?: string | null;
  build_error?: string | null;
  provider_status?: string | null;
  provider_status_detail?: string | null;
  created_at?: string;
}

function decorateTemplate(template: Omit<RemotionTemplate, "render_mode" | "render_composition_id" | "is_external_bundle_supported" | "render_status_label">): RemotionTemplate {
  const hasSupportedComposition = Boolean(
    template.composition_id && SUPPORTED_INTERNAL_COMPOSITIONS.has(template.composition_id),
  );
  const hasExternalBundle = Boolean(template.storage_path);
  const hasLegacySandboxApproval = template.bundle_status === "APPROVED_FOR_SANDBOX";
  const cloudCompositionId = isValidExternalCompositionId(template.cloud_build_composition_id)
    ? template.cloud_build_composition_id
    : isValidExternalCompositionId(template.composition_id)
      ? template.composition_id
      : null;
  const hasCloudBuild = template.cloud_build_status === "BUILT" &&
    Boolean(template.cloud_build_serve_url || template.cloud_build_output_storage_path) &&
    Boolean(cloudCompositionId) &&
    template.cloud_build_validated === true;
  const hasCloudBuildFailure = template.cloud_build_status === "BUILD_FAILED";
  const hasCloudBuildRunning = template.cloud_build_status === "BUILDING";
  const isCloudBuildQueued = hasCloudBuildRunning && template.cloud_build_provider_status === "QUEUED";
  const renderCompositionId = hasSupportedComposition ? template.composition_id! : DEFAULT_RENDER_COMPOSITION_ID;
  const bundleStatus = template.bundle_status || (hasExternalBundle ? "STORED_REFERENCE" : "NOT_APPLICABLE");

  let renderMode: RemotionTemplateRenderMode = "FALLBACK_INTERNAL";
  let renderStatusLabel = `Render interno: ${renderCompositionId}`;

  if (hasExternalBundle && hasCloudBuild) {
    renderMode = "EXTERNAL_BUNDLE_SITE_READY";
    renderStatusLabel = `Bundle compilado listo: ${cloudCompositionId}`;
  } else if (hasExternalBundle && isCloudBuildQueued) {
    renderMode = "EXTERNAL_CLOUD_BUILD_READY";
    renderStatusLabel = "Build con worker en cola; esperando que un worker lo reclame";
  } else if (hasExternalBundle && hasCloudBuildRunning) {
    renderMode = "EXTERNAL_CLOUD_BUILD_READY";
    renderStatusLabel = "Build con worker en progreso";
  } else if (hasExternalBundle && hasCloudBuildFailure) {
    renderMode = "EXTERNAL_CLOUD_BUILD_FAILED";
    renderStatusLabel = "Build con worker fallido";
  } else if (hasExternalBundle && hasLegacySandboxApproval) {
    renderMode = "EXTERNAL_CLOUD_BUILD_READY";
    renderStatusLabel = "ZIP aprobado historico; requiere construir con worker";
  } else if (hasSupportedComposition && hasExternalBundle) {
    renderMode = "INTERNAL_WITH_EXTERNAL_REFERENCE";
    renderStatusLabel = `ZIP guardado como referencia (${bundleStatus}); requiere build con worker para usar la plantilla custom`;
  } else if (hasSupportedComposition) {
    renderMode = "SUPPORTED_INTERNAL";
    renderStatusLabel = `Renderizable ahora: ${renderCompositionId}`;
  } else if (hasExternalBundle) {
    renderMode = "EXTERNAL_BUNDLE_PENDING";
    renderStatusLabel = "ZIP guardado como referencia; requiere aprobacion y build con worker";
  }

  return {
    ...template,
    config_schema: template.config_schema || createTemplateConfigSchemaDefinition(),
    default_config: parseTemplateRenderConfig(template.default_config),
    bundle_status: bundleStatus,
    render_mode: renderMode,
    render_composition_id: renderCompositionId,
    is_external_bundle_supported: hasCloudBuild,
    render_status_label: renderStatusLabel,
  };
}

export async function getExternalBundlePreviewDataAction(params: {
  templateId: string;
  componentId?: string | null;
  variables?: Record<string, unknown>;
}): Promise<{ success: true; data: ExternalBundlePreviewData } | { success: false; error: string }> {
  const supabase = await createClient();
  const token = await getAccessToken(supabase);

  if (!token) {
    return { success: false, error: "No se encontro un token de autenticacion" };
  }

  if (!params.templateId) {
    return { success: false, error: "templateId es requerido" };
  }

  try {
    const productionApiUrl = getProductionApiBaseUrl();
    const response = await fetch(`${productionApiUrl}/api/v1/production/remotion/external-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        templateId: params.templateId,
        componentId: params.componentId || undefined,
        variables: params.variables || {},
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return {
        success: false,
        error: formatExternalPreviewError(payload?.error ?? payload, `HTTP ${response.status}`),
      };
    }

    return {
      success: true,
      data: {
        serveUrl: payload.serveUrl,
        compositionId: payload.compositionId,
        exportMode: payload.exportMode === "root" ? "root" : "component",
        resolvedProps: payload.resolvedProps || {},
        propsHash: payload.propsHash,
        buildHash: payload.buildHash || null,
        buildId: payload.buildId || null,
        templateVersionId: payload.templateVersionId,
        bundleHash: payload.bundleHash || null,
        previewId: payload.previewId || null,
        previewStatus: payload.previewStatus || "MISSING",
        previewError: payload.previewError || null,
        previewVideoUrl: payload.previewVideoUrl || null,
        previewPosterUrl: payload.previewPosterUrl || null,
        previewDurationSeconds: typeof payload.previewDurationSeconds === "number" ? payload.previewDurationSeconds : null,
        previewFrames: typeof payload.previewFrames === "number" ? payload.previewFrames : null,
        compositionDurationSeconds: typeof payload.compositionDurationSeconds === "number" ? payload.compositionDurationSeconds : null,
        compositionFrames: typeof payload.compositionFrames === "number" ? payload.compositionFrames : null,
      },
    };
  } catch (error: any) {
    console.error("[TemplatesActions] Error fetching external preview data:", error);
    return {
      success: false,
      error: formatExternalPreviewError(error, "No se pudo obtener el preview externo"),
    };
  }
}

export async function requestExternalBundlePreviewRenderAction(params: {
  templateId: string;
  componentId?: string | null;
  variables?: Record<string, unknown>;
}): Promise<{ success: true; data: ExternalBundlePreviewData } | { success: false; error: string }> {
  const supabase = await createClient();
  const token = await getAccessToken(supabase);

  if (!token) {
    return { success: false, error: "No se encontro un token de autenticacion" };
  }

  if (!params.templateId) {
    return { success: false, error: "templateId es requerido" };
  }

  try {
    const productionApiUrl = getProductionApiBaseUrl();
    const response = await fetch(`${productionApiUrl}/api/v1/production/remotion/external-preview/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        templateId: params.templateId,
        componentId: params.componentId || undefined,
        variables: params.variables || {},
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return {
        success: false,
        error: formatExternalPreviewError(payload?.error ?? payload, `HTTP ${response.status}`),
      };
    }

    return {
      success: true,
      data: {
        serveUrl: payload.serveUrl,
        compositionId: payload.compositionId,
        exportMode: payload.exportMode === "root" ? "root" : "component",
        resolvedProps: payload.resolvedProps || {},
        propsHash: payload.propsHash,
        buildHash: payload.buildHash || null,
        buildId: payload.buildId || null,
        templateVersionId: payload.templateVersionId,
        bundleHash: payload.bundleHash || null,
        previewId: payload.previewId || null,
        previewStatus: payload.previewStatus || "QUEUED",
        previewError: payload.previewError || null,
        previewVideoUrl: payload.previewVideoUrl || null,
        previewPosterUrl: payload.previewPosterUrl || null,
        previewDurationSeconds: typeof payload.previewDurationSeconds === "number" ? payload.previewDurationSeconds : null,
        previewFrames: typeof payload.previewFrames === "number" ? payload.previewFrames : null,
        compositionDurationSeconds: typeof payload.compositionDurationSeconds === "number" ? payload.compositionDurationSeconds : null,
        compositionFrames: typeof payload.compositionFrames === "number" ? payload.compositionFrames : null,
      },
    };
  } catch (error: any) {
    console.error("[TemplatesActions] Error requesting external preview render:", error);
    return {
      success: false,
      error: formatExternalPreviewError(error, "No se pudo solicitar el preview externo"),
    };
  }
}

export interface ExternalBundlePreviewData {
  serveUrl: string | null;
  compositionId: string;
  exportMode: "component" | "root";
  resolvedProps: Record<string, unknown>;
  propsHash: string;
  buildHash: string | null;
  buildId: string | null;
  templateVersionId: string;
  bundleHash: string | null;
  previewId: string | null;
  previewStatus: "READY" | "MISSING" | "QUEUED" | "RUNNING" | "FAILED" | "STALE";
  previewError: string | null;
  previewVideoUrl: string | null;
  previewPosterUrl: string | null;
  previewDurationSeconds: number | null;
  previewFrames: number | null;
  compositionDurationSeconds: number | null;
  compositionFrames: number | null;
}

export async function startTemplateCloudBuildAction(
  templateVersionId: string,
): Promise<{ success: boolean; buildId?: string; status?: string; providerBuildId?: string | null; serveUrl?: string | null; buildOutputStoragePath?: string | null; error?: string }> {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { success: false, error: "No se encontro un token de autenticacion" };

  try {
    const activeOrgId = await resolveActiveTemplateOrganizationId();
    if (!activeOrgId) return { success: false, error: "No se encontro organizacion activa" };
    await requireTemplateReviewerPermission("construir");
    const payload = await new DesktopWorkerControlPlane(getServiceRoleClient()).startTemplateBuild({
      templateVersionId,
      organizationIds: [activeOrgId],
    });

    return {
      success: true,
      buildId: payload.buildId,
      status: payload.status,
      providerBuildId: payload.providerBuildId || null,
      serveUrl: payload.serveUrl || null,
      buildOutputStoragePath: payload.buildOutputStoragePath || null,
    };
  } catch (error: any) {
    console.error("[TemplatesActions] Error starting template build:", error);
    return { success: false, error: formatExternalPreviewError(error, "No se pudo iniciar el build con worker") };
  }
}

export async function getTemplateCloudBuildStatusAction(
  buildId: string,
): Promise<{ success: boolean; build?: RemotionTemplateCloudBuild & { providerBuildId?: string | null; providerStatusDetail?: string | null }; error?: string }> {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) return { success: false, error: "No se encontro un token de autenticacion" };

  try {
    const activeOrgId = await resolveActiveTemplateOrganizationId();
    if (!activeOrgId) return { success: false, error: "No se encontro organizacion activa" };
    const payload = await new DesktopWorkerControlPlane(getServiceRoleClient()).getTemplateBuildStatus(buildId, [activeOrgId]);

    return {
      success: true,
      build: {
        id: payload.buildId,
        template_version_id: "",
        status: payload.status,
        serve_url: payload.serveUrl || null,
        build_output_storage_path: payload.buildOutputStoragePath || null,
        composition_id: null,
        provider_status: payload.providerStatus || null,
        provider_status_detail: payload.providerStatusDetail || null,
        providerBuildId: payload.providerBuildId || null,
        providerStatusDetail: payload.providerStatusDetail || null,
      },
    };
  } catch (error: any) {
    console.error("[TemplatesActions] Error getting template build status:", error);
    return { success: false, error: formatExternalPreviewError(error, "No se pudo consultar el build con worker") };
  }
}

function formatExternalPreviewError(value: unknown, fallback: string): string {
  if (!value) return fallback;

  if (value instanceof Error) {
    return value.message || fallback;
  }

  if (typeof value === "string") {
    return value || fallback;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directMessage = record.message || record.error || record.detail || record.details;

    if (typeof directMessage === "string" && directMessage.trim()) {
      return directMessage;
    }

    if (directMessage && typeof directMessage === "object") {
      return formatExternalPreviewError(directMessage, fallback);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return String(value) || fallback;
}

function logTemplateRuntimeState(message: string, meta: Record<string, unknown>) {
  console.log(`[TemplatesActions] ${message}`, meta);
}

const TEMPLATE_REVIEWER_ROLES = new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]);

async function requireTemplateReviewerPermission(action: string) {
  const context = await resolveActiveTenantContext();
  const platformRole = context?.platformRole || "";

  if (!TEMPLATE_REVIEWER_ROLES.has(platformRole)) {
    throw new Error(`No tienes permisos de revisor para ${action} bundles.`);
  }
}

function decorateTemplates(templates: Array<Omit<RemotionTemplate, "render_mode" | "render_composition_id" | "is_external_bundle_supported" | "render_status_label">>): RemotionTemplate[] {
  return templates.map(decorateTemplate);
}

async function attachLatestCloudBuilds(
  admin: ReturnType<typeof getServiceRoleClient>,
  templates: any[],
): Promise<any[]> {
  const templateIds = templates.map((template) => template?.id).filter(Boolean);
  if (templateIds.length === 0) {
    return templates;
  }

  const { data: versions } = await admin
    .from("remotion_template_versions")
    .select("id, template_id, composition_id, manifest, editable_layers")
    .in("template_id", templateIds)
    .in("status", ["APPROVED_FOR_SANDBOX", "APPROVED"])
    .order("version_number", { ascending: false });

  const latestVersionByTemplate = new Map<string, {
    id: string;
    compositionId: string | null;
    layoutContractVersion: number | null;
    editableLayers: EditableLayerDefinition[];
  }>();
  for (const version of versions || []) {
    if (!latestVersionByTemplate.has(version.template_id)) {
      const manifest = version.manifest && typeof version.manifest === "object"
        ? version.manifest as Record<string, unknown>
        : {};
      const editableLayers = Array.isArray(version.editable_layers)
        ? version.editable_layers as EditableLayerDefinition[]
        : Array.isArray(manifest.editableLayers)
          ? manifest.editableLayers as EditableLayerDefinition[]
          : [];
      latestVersionByTemplate.set(version.template_id, {
        id: version.id,
        compositionId: isValidExternalCompositionId(version.composition_id) ? version.composition_id : null,
        layoutContractVersion: Number.isInteger(manifest.layoutContractVersion)
          ? Number(manifest.layoutContractVersion)
          : null,
        editableLayers,
      });
    }
  }

  const versionIds = Array.from(latestVersionByTemplate.values()).map((version) => version.id);
  if (versionIds.length === 0) {
    return templates;
  }

  const { data: builds } = await admin
    .from("remotion_template_builds")
    .select("id, template_version_id, status, serve_url, build_output_storage_path, cloud_provider, composition_id, build_log, build_error, provider_status, provider_status_detail, created_at")
    .in("template_version_id", versionIds)
    .in("status", ["BUILDING", "BUILT", "BUILD_FAILED"])
    .order("created_at", { ascending: false });

  const latestBuildByVersion = new Map<string, RemotionTemplateCloudBuild>();
  for (const build of (builds || []) as RemotionTemplateCloudBuild[]) {
    if (!latestBuildByVersion.has(build.template_version_id)) {
      latestBuildByVersion.set(build.template_version_id, build);
    }
  }

  return templates.map((template) => {
    const version = latestVersionByTemplate.get(template.id);
    const build = version ? latestBuildByVersion.get(version.id) : null;
    const buildCompositionId = isValidExternalCompositionId(build?.composition_id)
      ? build?.composition_id
      : null;
    const templateCompositionId = isValidExternalCompositionId(template.composition_id)
      ? template.composition_id
      : null;
    return {
      ...template,
      cloud_build_id: build?.id || null,
      cloud_build_status: build?.status || null,
      cloud_build_provider_status: build?.provider_status || null,
      cloud_build_serve_url: build?.serve_url || null,
      cloud_build_output_storage_path: build?.build_output_storage_path || null,
      cloud_build_composition_id: buildCompositionId || version?.compositionId || templateCompositionId,
      cloud_build_validated: build?.cloud_provider === "desktop_worker"
        ? Boolean(build.build_output_storage_path)
        : isValidatedCloudBuildLog(build?.build_log),
      template_version_id: version?.id || null,
      layout_contract_version: version?.layoutContractVersion || null,
      editable_layers: version?.editableLayers || [],
    };
  });
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
    const templatesWithBuilds = await attachLatestCloudBuilds(admin, [...(ownedTemplates || []), ...acquiredTemplates]);
    const merged = decorateTemplates(templatesWithBuilds);
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

    const templatesWithBuilds = await attachLatestCloudBuilds(admin, publicTemplates || []);
    return { success: true, templates: decorateTemplates(templatesWithBuilds) };
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
    const { version, report, normalizedStoragePath } = await createTemplateVersionRecord({
      admin,
      activeOrgId,
      userId: user.userId,
      templateId,
      storagePath,
      originalFileName,
    });

    logTemplateRuntimeState("Bundle validation completed.", {
      templateId,
      originalFileName,
      isValid: report.isValid,
      errorsCount: report.errors.length,
      warningsCount: report.warnings.length,
      manifestEntryPoint: report.info.manifest?.entryPoint || null,
      manifestCompositionId: report.info.manifest?.compositionId || null,
      manifestExportMode: report.info.manifest?.exportMode || null,
      hash: report.info.hash,
      dependencies: Object.keys(report.info.dependencies || {}),
    });
    logTemplateRuntimeState("Template version created.", {
      templateId,
      versionId: version.id,
      versionNumber: version.version_number,
      status: version.status,
      storagePath: normalizedStoragePath,
      entryPoint: report.info.manifest?.entryPoint || null,
      compositionId: report.info.manifest?.compositionId || null,
      exportMode: report.info.manifest?.exportMode || null,
      bundleHash: report.info.hash,
    });
    logTemplateRuntimeState("Parent template updated after version creation.", {
      templateId,
      bundleStatus: report.isValid ? "PENDING_REVIEW" : "REJECTED",
      storagePath: normalizedStoragePath,
    });

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

    const versionIds = (versions || []).map((version: any) => version.id);
    const { data: builds } = versionIds.length > 0
      ? await admin
          .from("remotion_template_builds")
          .select("id, template_version_id, status, serve_url, build_output_storage_path, cloud_provider, build_error, provider_status, provider_status_detail, created_at")
          .in("template_version_id", versionIds)
          .order("created_at", { ascending: false })
      : { data: [] };

    const buildsByVersion = new Map<string, RemotionTemplateCloudBuild[]>();
    for (const build of (builds || []) as RemotionTemplateCloudBuild[]) {
      const current = buildsByVersion.get(build.template_version_id) || [];
      current.push(build);
      buildsByVersion.set(build.template_version_id, current);
    }

    return {
      success: true,
      versions: (versions || []).map((version: any) => ({
        ...version,
        cloud_builds: buildsByVersion.get(version.id) || [],
      })) as any[],
    };
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
    await requireTemplateReviewerPermission("aprobar");

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

    logTemplateRuntimeState("Approving template version for audit.", {
      versionId,
      templateId: version.template_id,
      currentStatus: version.status,
      manifestCompositionId: version.manifest?.compositionId || null,
      entryPoint: version.entry_point || null,
      bundleHash: version.bundle_hash || null,
    });

    // 3. Deprecate previous audit-approved versions. Legacy runtime-approved
    // records are kept for compatibility but new approvals use cloud builds.
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
    const compositionId = version.composition_id || manifest.compositionId || "full-slides";
    const { error: updateTemplateError } = await admin
      .from("remotion_templates")
      .update({
        bundle_status: "APPROVED",
        storage_path: version.storage_path,
        entry_point: version.entry_point || "src/index.tsx",
        composition_id: compositionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", version.template_id);

    if (updateTemplateError) throw updateTemplateError;
    logTemplateRuntimeState("Template version approved for audit.", {
      versionId,
      templateId: version.template_id,
      newVersionStatus: "APPROVED",
      templateBundleStatus: "APPROVED",
      templateCompositionId: compositionId,
      templateEntryPoint: version.entry_point || "src/index.tsx",
    });

    return { success: true };
  } catch (error: any) {
    console.error("[TemplatesActions] Error approving version:", error);
    return { success: false, error: error.message || "Error al aprobar la versión" };
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

  const activeOrgId = await resolveActiveTemplateOrganizationId();
  if (!activeOrgId) return { success: false, error: "No se encontró organización activa" };

  const admin = getServiceRoleClient();

  try {
    await requireTemplateReviewerPermission("rechazar");

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
