import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { validateRemotionBundle, type ValidationReport } from "@/domains/production/validation/bundle-validator";

type SupabaseAdminClient = any;

export interface CreateTemplateVersionInput {
  admin: SupabaseAdminClient;
  activeOrgId: string;
  userId: string;
  templateId: string;
  storagePath: string;
  originalFileName: string;
  validationReport?: ValidationReport;
  bundleBuffer?: ArrayBuffer;
}

export function resolveBundleStorageLocation(storagePath: string) {
  const normalized = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (normalized.startsWith("template-bundles/")) {
    return {
      bucket: "template-bundles",
      path: normalized.substring("template-bundles/".length),
    };
  }

  if (normalized.startsWith("production-assets/")) {
    return {
      bucket: "production-assets",
      path: normalized.substring("production-assets/".length),
    };
  }

  if (normalized.startsWith("http")) {
    const templateBundleMarker = "/template-bundles/";
    const templateBundleIndex = normalized.indexOf(templateBundleMarker);
    if (templateBundleIndex !== -1) {
      return {
        bucket: "template-bundles",
        path: normalized.substring(templateBundleIndex + templateBundleMarker.length),
      };
    }

    const productionAssetsMarker = "/production-assets/";
    const productionAssetsIndex = normalized.indexOf(productionAssetsMarker);
    if (productionAssetsIndex !== -1) {
      return {
        bucket: "production-assets",
        path: normalized.substring(productionAssetsIndex + productionAssetsMarker.length),
      };
    }
  }

  return { bucket: "template-bundles", path: normalized };
}

async function downloadBundleArrayBuffer(storagePath: string): Promise<ArrayBuffer> {
  const bundleLocation = resolveBundleStorageLocation(storagePath);
  const downloadUrl = `${getSupabaseUrl()}/storage/v1/object/${bundleLocation.bucket}/${bundleLocation.path}`;
  const response = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${getSupabaseServiceRoleKey()}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }

  return response.arrayBuffer();
}

export async function createTemplateVersionRecord(
  input: CreateTemplateVersionInput,
): Promise<{ version: any; report: ValidationReport; normalizedStoragePath: string }> {
  const { admin, activeOrgId, templateId } = input;
  const { data: template, error: fetchError } = await admin
    .from("remotion_templates")
    .select("organization_id, bundle_status")
    .eq("id", templateId)
    .single();

  if (fetchError || !template) throw new Error("Plantilla no encontrada");
  if (template.organization_id !== activeOrgId) {
    throw new Error("No tienes permiso para modificar esta plantilla");
  }

  const bundleLocation = resolveBundleStorageLocation(input.storagePath);
  const normalizedStoragePath = `${bundleLocation.bucket}/${bundleLocation.path}`;
  const arrayBuffer = input.bundleBuffer || (await downloadBundleArrayBuffer(normalizedStoragePath));
  const report = input.validationReport || (await validateRemotionBundle(arrayBuffer, input.originalFileName));

  const { data: latest } = await admin
    .from("remotion_template_versions")
    .select("version_number")
    .eq("template_id", templateId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNumber = latest ? latest.version_number + 1 : 1;
  const status = report.isValid ? "PENDING_REVIEW" : "VALIDATION_FAILED";
  const manifest = report.info.manifest;
  const compositionIds = manifest
    ? Array.from(new Set([manifest.compositionId, ...(manifest.compositionIds || [])]))
    : null;

  const { data: version, error: insertError } = await admin
    .from("remotion_template_versions")
    .insert({
      template_id: templateId,
      organization_id: activeOrgId,
      version_number: nextVersionNumber,
      status,
      template_type: "custom_bundle",
      storage_path: normalizedStoragePath,
      original_file_name: input.originalFileName,
      bundle_hash: report.info.hash,
      entry_point: manifest?.entryPoint || null,
      manifest: manifest || null,
      export_mode: manifest?.exportMode || "component",
      composition_id: manifest?.compositionId || null,
      composition_ids: compositionIds,
      props_schema: manifest?.propsSchema || null,
      default_props: manifest?.defaultProps || null,
      default_duration_frames: manifest?.defaultDurationFrames || null,
      default_fps: manifest?.fps || null,
      default_width: manifest?.width || null,
      default_height: manifest?.height || null,
      build_status: "PENDING",
      validation_report: {
        isValid: report.isValid,
        errors: report.errors,
        warnings: report.warnings,
        info: {
          fileCount: report.info.fileCount,
          unzippedSize: report.info.unzippedSize,
          dependencies: report.info.dependencies || {},
        },
      },
      validated_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select(`
      *,
      created_by_profile:profiles!created_by(username, first_name, email),
      approved_by_profile:profiles!approved_by(username, first_name, email),
      rejected_by_profile:profiles!rejected_by(username, first_name, email)
    `)
    .single();

  if (insertError) throw insertError;

  await admin
    .from("remotion_templates")
    .update({
      bundle_status: report.isValid ? "PENDING_REVIEW" : "REJECTED",
      storage_path: normalizedStoragePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);

  return { version, report, normalizedStoragePath };
}
