/**
 * Persistence contracts used by the desktop worker control plane.
 *
 * Source of truth: `supabase/migrations/BD.sql`. These types intentionally live
 * at the database boundary; they are not API DTOs and must be updated whenever
 * the referenced tables change.
 */

export type DatabaseJsonObject = Record<string, unknown>;

type DatabaseRow = Record<string, unknown>;

export type ProductionJobStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "WAITING_PROVIDER"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "RETRY_SCHEDULED";

export interface ProductionJobRow extends DatabaseRow {
  id: string;
  organization_id: string | null;
  artifact_id: string;
  material_lesson_id: string | null;
  material_component_id: string | null;
  lesson_id: string | null;
  module_id: string | null;
  job_type: string;
  provider: string;
  provider_model: string | null;
  status: ProductionJobStatus;
  input_snapshot: DatabaseJsonObject;
  output_snapshot: DatabaseJsonObject;
  progress: unknown;
  provider_error: DatabaseJsonObject | null;
  duration_seconds: number | null;
  worker_id: string | null;
  lease_expires_at: string | null;
  output_checksum: string | null;
  logs_ref: string | null;
  render_batch_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
}

export type RemotionTemplateBuildStatus = "BUILDING" | "BUILT" | "BUILD_FAILED";

export interface RemotionTemplateBuildRow extends DatabaseRow {
  id: string;
  template_version_id: string;
  organization_id: string;
  status: RemotionTemplateBuildStatus;
  bundle_hash: string;
  build_hash: string | null;
  serve_url: string | null;
  build_output_storage_path: string | null;
  composition_id: string | null;
  export_mode: "component" | "root";
  build_log: string | null;
  build_log_storage_path: string | null;
  build_error: string | null;
  cloud_provider: string | null;
  provider_build_id: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  worker_id: string | null;
  claimed_at: string | null;
  worker_heartbeat_at: string | null;
  lease_expires_at: string | null;
  output_checksum: string | null;
  created_at: string;
  updated_at: string;
  built_at: string | null;
  build_failed_at: string | null;
}

export type RemotionTemplatePreviewStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface RemotionTemplatePreviewRow extends DatabaseRow {
  id: string;
  organization_id: string;
  template_id: string;
  template_version_id: string;
  template_build_id: string;
  material_component_id: string | null;
  status: RemotionTemplatePreviewStatus;
  props_hash: string;
  layout_overrides_hash: string | null;
  resolved_props: DatabaseJsonObject;
  composition_id: string;
  bundle_hash: string | null;
  build_hash: string | null;
  preview_frame: number;
  preview_poster_storage_path: string | null;
  preview_video_storage_path: string | null;
  preview_duration_seconds: number | null;
  preview_frames: number | null;
  worker_id: string | null;
  claimed_at: string | null;
  worker_heartbeat_at: string | null;
  lease_expires_at: string | null;
  provider_status: string | null;
  provider_status_detail: string | null;
  progress: unknown;
  output_checksum: string | null;
  error_code: string | null;
  error_message: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
  preview_cache_key: string;
}

export type RenderWorkerStatus = "LINKED" | "ONLINE" | "BUSY" | "OFFLINE" | "REVOKED";

export interface RenderWorkerRow extends DatabaseRow {
  id: string;
  organization_id: string;
  device_name: string;
  platform: string | null;
  arch: string | null;
  app_version: string | null;
  status: RenderWorkerStatus;
  last_heartbeat_at: string | null;
  token_last4: string;
  max_concurrent_jobs: number;
  capabilities: DatabaseJsonObject;
  last_capacity_report: DatabaseJsonObject;
  capacity_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RenderWorkerJobRunStatus =
  | "running"
  | "completed"
  | "upload_pending"
  | "confirm_pending"
  | "failed"
  | "interrupted";

export interface RenderWorkerJobRunRow extends DatabaseRow {
  id: string;
  worker_id: string;
  organization_id: string;
  local_run_id: string;
  remote_table: "production_jobs" | "remotion_template_builds" | "remotion_template_previews";
  remote_job_id: string;
  job_type: "render" | "template_build" | "template_preview";
  status: RenderWorkerJobRunStatus;
  started_at: string;
  finished_at: string | null;
  last_stage: string | null;
  last_progress_percent: number | null;
  updated_at: string;
}

export interface RemotionTemplateVersionRow extends DatabaseRow {
  id: string;
  template_id: string;
  organization_id: string;
  storage_path: string;
  bundle_hash: string | null;
  entry_point: string | null;
  export_mode: "component" | "root";
  composition_id: string | null;
  build_hash?: string | null;
  build_output_path?: string | null;
}

export interface ProductionRenderBatchItemStatusRow extends DatabaseRow {
  status: string;
}

function isDatabaseRow(value: unknown): value is DatabaseRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Normalizes the untyped Supabase client boundary and discards malformed
 * non-object entries before callers consume rows under the BD.sql contract.
 */
export function readDatabaseRows<Row extends DatabaseRow>(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isDatabaseRow) as Row[] : [];
}

export function readDatabaseRow<Row extends DatabaseRow>(value: unknown): Row | null {
  return isDatabaseRow(value) ? value as Row : null;
}
