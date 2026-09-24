import type { SupabaseClient } from "@supabase/supabase-js";

export type AssetAccessAuditEvent = "DOWNLOAD" | "EXPORT_JSON" | "EXPORT_ZIP";
export type AssetAccessResource = "MATERIAL_COMPONENT" | "PRODUCTION_ASSET" | "SOUND_EFFECT";

/** Persists only non-sensitive identifiers; delivery URLs and Storage paths never enter the audit log. */
export async function recordAssetAccessAudit(params: {
  actorId: string;
  eventType: AssetAccessAuditEvent;
  metadata?: Record<string, unknown>;
  organizationId: string;
  requestId: string;
  resourceId: string;
  resourceType: AssetAccessResource;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { error } = await params.supabase.from("asset_access_audit_events").insert({
    actor_id: params.actorId,
    event_type: params.eventType,
    metadata: params.metadata || {},
    organization_id: params.organizationId,
    request_id: params.requestId,
    resource_id: params.resourceId,
    resource_type: params.resourceType,
  });
  if (error) throw error;
}
