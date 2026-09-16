import "server-only";

import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import {
  mapProductionCourseContext,
  type ProductionCourseContext,
  type ProductionCourseContextRow,
} from "./production-course-context";

export async function getProductionCourseContext(params: {
  componentId: string | null | undefined;
  organizationId: string;
}): Promise<ProductionCourseContext | null> {
  if (!params.componentId) return null;

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("material_components")
    .select(`
      id,
      type,
      material_lessons!inner (
        lesson_title,
        materials!inner (
          artifact_id,
          artifacts!inner (
            idea_central,
            organization_id
          )
        )
      )
    `)
    .eq("id", params.componentId)
    .maybeSingle();

  if (error) {
    console.warn("[ProductionCourseContext] Could not resolve component context:", error.message);
    return null;
  }

  return data
    ? mapProductionCourseContext(
        data as ProductionCourseContextRow,
        params.organizationId,
      )
    : null;
}
