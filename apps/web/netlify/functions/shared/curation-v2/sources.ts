import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePdfBuffer, validateUrlSource } from "./validation";
import type { CurationValidationReport } from "./types";

export interface PersistedCurationSource {
  id: string;
  source_kind: "url" | "pdf";
  source_ref: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  apta: boolean | null;
  cobertura_completa: boolean | null;
  forbidden_override: boolean | null;
}

function reportUpdate(
  report: CurationValidationReport,
  isValid: boolean,
  existing: PersistedCurationSource,
) {
  return {
    validation_report: report,
    url_status: report.status === "review_required" ? "REVIEW_REQUIRED" : isValid ? "OK" : "BROKEN",
    http_status_code: report.http_status_code ?? null,
    last_checked_at: report.checked_at,
    failure_reason: isValid ? null : report.reason,
    auto_evaluated: true,
    auto_reason: report.reason,
    apta: existing.forbidden_override ? existing.apta : isValid,
    cobertura_completa: existing.forbidden_override
      ? existing.cobertura_completa
      : isValid,
    motivo_no_apta: isValid ? null : report.reason,
    updated_at: report.checked_at,
  };
}

export async function validateAndPersistCurationSource(
  supabase: SupabaseClient,
  source: PersistedCurationSource,
) {
  if (source.source_kind === "pdf") {
    if (!source.storage_bucket || !source.storage_path) {
      throw new Error("La fuente PDF no tiene una ubicacion privada valida.");
    }
    const { data, error } = await supabase.storage
      .from(source.storage_bucket)
      .download(source.storage_path);
    if (error || !data) throw new Error(error?.message || "No se pudo leer el PDF.");
    const buffer = new Uint8Array(await data.arrayBuffer());
    const validation = await validatePdfBuffer(buffer, source.mime_type || data.type);
    const { error: updateError } = await supabase
      .from("curation_rows")
      .update({
        ...reportUpdate(validation.report, validation.isValid, source),
        content_sha256: validation.sha256,
      })
      .eq("id", source.id);
    if (updateError) throw new Error(updateError.message);
    return validation;
  }

  const validation = await validateUrlSource(source.source_ref);
  const { error } = await supabase
    .from("curation_rows")
    .update({
      ...reportUpdate(validation.report, validation.isValid, source),
      source_ref: validation.normalizedUrl,
      source_title: validation.report.detected_title || undefined,
    })
    .eq("id", source.id);
  if (error) throw new Error(error.message);
  return validation;
}
