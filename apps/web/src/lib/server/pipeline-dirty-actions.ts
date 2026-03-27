"use server";

import { getAuthorizedArtifactAdmin } from "@/lib/server/artifact-action-auth";

type DirtyTable =
  | "syllabus"
  | "instructional_plans"
  | "curation"
  | "materials"
  | "publication_requests";

export async function markDownstreamDirtyAction(
  artifactId: string,
  stepIndex: number,
  source: string,
) {
  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) return { success: false, error: "No autorizado" };

  const { admin } = authorized;
  const downstreamSteps: Array<{ index: number; table: DirtyTable }> = [
    { index: 2, table: "syllabus" },
    { index: 3, table: "instructional_plans" },
    { index: 4, table: "curation" },
    { index: 5, table: "materials" },
    { index: 7, table: "publication_requests" },
  ];

  const targets = downstreamSteps.filter((step) => step.index > stepIndex);
  if (targets.length === 0) return { success: true };

  for (const target of targets) {
    const { error } = await admin
      .from(target.table)
      .update({ upstream_dirty: true, upstream_dirty_source: source })
      .eq("artifact_id", artifactId);

    if (error) {
      console.warn(
        `[PipelineDirty] Could not mark ${target.table} as dirty:`,
        error.message,
      );
    }
  }

  return { success: true };
}

export async function dismissUpstreamDirtyAction(
  table: DirtyTable,
  artifactId: string,
) {
  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized) return { success: false, error: "No autorizado" };

  const { admin } = authorized;
  const { error } = await admin
    .from(table)
    .update({ upstream_dirty: false, upstream_dirty_source: null })
    .eq("artifact_id", artifactId);

  if (error) {
    console.error(
      `[PipelineDirty] Error dismissing upstream dirty for ${table}:`,
      error,
    );
    throw error;
  }

  return { success: true };
}
