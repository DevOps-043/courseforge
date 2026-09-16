import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProductionComponentContext } from "../jobs/production-jobs.service";

export class HyperframesCompositionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Creates the shell for an internally-authored HyperFrames composition. */
export async function createHyperframesCompositionDraft(params: {
  componentId: string;
  createdBy: string;
  name: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const context = await resolveProductionComponentContext({
    componentId: params.componentId,
    supabase: params.supabase,
  });
  if (context.organizationId !== params.organizationId) {
    throw new HyperframesCompositionError("El componente no pertenece a la empresa activa.", 403);
  }

  const { data, error } = await params.supabase
    .from("video_compositions")
    .insert({
      artifact_id: context.artifactId,
      created_by: params.createdBy,
      material_component_id: context.componentId,
      name: params.name,
      organization_id: params.organizationId,
      status: "DRAFT",
    })
    .select("id, name, status, artifact_id, material_component_id, created_at, updated_at")
    .single();
  if (error) throw error;
  return data;
}

/** One active composition is created or recovered when a video is opened in Ensamble. */
export async function getOrCreateHyperframesCompositionDraft(params: {
  componentId: string;
  createdBy: string;
  name: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const existing = await findActiveHyperframesComposition(params);
  if (existing) return { composition: existing, created: false };

  try {
    return { composition: await createHyperframesCompositionDraft(params), created: true };
  } catch (error) {
    // The partial unique index is authoritative when two tabs (or a Strict
    // Mode remount) initialize the same lesson concurrently. Recover the row
    // that won instead of surfacing an intermittent preparation failure.
    if (isUniqueViolation(error)) {
      const concurrent = await findActiveHyperframesComposition(params);
      if (concurrent) return { composition: concurrent, created: false };
    }
    throw error;
  }
}

async function findActiveHyperframesComposition(params: {
  componentId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  const { data, error } = await params.supabase
    .from("video_compositions")
    .select("id, name, status, active_revision_id, artifact_id, material_component_id, created_at, updated_at")
    .eq("organization_id", params.organizationId)
    .eq("material_component_id", params.componentId)
    .neq("status", "ARCHIVED")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "23505");
}

export async function listHyperframesCompositions(params: {
  componentId?: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}) {
  let query = params.supabase
    .from("video_compositions")
    .select("id, name, status, active_revision_id, artifact_id, material_component_id, created_at, updated_at")
    .eq("organization_id", params.organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (params.componentId) query = query.eq("material_component_id", params.componentId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
