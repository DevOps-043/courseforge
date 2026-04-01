import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId, getAuthBridgeUser } from "@/utils/auth/session";
import type { Artifact } from "./artifacts-list.types";

interface ArtifactStateRelation {
  state?: string | null;
}

interface ArtifactRow extends Artifact {
  syllabus?: ArtifactStateRelation[] | ArtifactStateRelation | null;
  instructional_plans?: ArtifactStateRelation[] | ArtifactStateRelation | null;
}

interface ProfileRow {
  id: string;
  username: string | null;
  email: string | null;
}

interface MaterialComponentRow {
  type?: string | null;
  assets?: {
    final_video_url?: string | null;
  } | null;
}

interface MaterialLessonRow {
  material_components?: MaterialComponentRow[] | null;
}

interface MaterialsRow {
  artifact_id: string;
  material_lessons?: MaterialLessonRow[] | null;
}

const ARTIFACTS_LIST_SELECT = `
  id,
  idea_central,
  descripcion,
  state,
  created_at,
  created_by,
  production_complete,
  syllabus(state),
  instructional_plans(state)
`;

function getSingleStateRelation(
  relation?: ArtifactStateRelation[] | ArtifactStateRelation | null,
) {
  return Array.isArray(relation) ? relation[0] : relation;
}

function buildProductionStatusMap(materials: MaterialsRow[] = []) {
  const statusMap: Record<string, { total: number; completed: number }> = {};

  materials.forEach((material) => {
    const artifactId = material.artifact_id;
    if (!statusMap[artifactId]) {
      statusMap[artifactId] = { total: 0, completed: 0 };
    }

    material.material_lessons?.forEach((lesson) => {
      lesson.material_components?.forEach((component) => {
        if (component.type?.includes("VIDEO")) {
          statusMap[artifactId].total += 1;
          if (component.assets?.final_video_url) {
            statusMap[artifactId].completed += 1;
          }
        }
      });
    });
  });

  return statusMap;
}

function mergeArtifactsWithProfiles(
  artifacts: ArtifactRow[],
  profiles: ProfileRow[],
  productionStatusMap: Record<string, { total: number; completed: number }>,
) {
  return artifacts.map((artifact) => {
    const syllabus = getSingleStateRelation(artifact.syllabus);
    const instructionalPlan = getSingleStateRelation(
      artifact.instructional_plans,
    );
    const productionStatus = productionStatusMap[artifact.id] || {
      total: 0,
      completed: 0,
    };

    return {
      ...artifact,
      syllabus_state: syllabus?.state || undefined,
      plan_state: instructionalPlan?.state || undefined,
      production_status: productionStatus,
      production_complete:
        productionStatus.total > 0 &&
        productionStatus.completed === productionStatus.total,
      profiles: profiles.find((profile) => profile.id === artifact.created_by) || null,
    };
  });
}

export async function loadArtifactsPageData(options?: {
  onlyCurrentUser?: boolean;
}) {
  const supabase = await createClient();
  const activeOrgId = await getActiveOrganizationId();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bridgeUser = !user ? await getAuthBridgeUser() : null;
  const currentUserId = user?.id || bridgeUser?.id || null;

  let query = supabase
    .from("artifacts")
    .select(ARTIFACTS_LIST_SELECT)
    .order("created_at", { ascending: false });

  if (options?.onlyCurrentUser && currentUserId) {
    query = query.eq("created_by", currentUserId);
  }

  if (activeOrgId) {
    query = query.eq("organization_id", activeOrgId);
  }

  const { data: artifactsData } = await query;
  const artifacts = (artifactsData as ArtifactRow[] | null) || [];

  const userIds = [...new Set(artifacts.map((artifact) => artifact.created_by))];
  let profiles: ProfileRow[] = [];

  if (userIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, email")
      .in("id", userIds);
    profiles = (data as ProfileRow[] | null) || [];
  }

  const artifactIds = artifacts.map((artifact) => artifact.id);
  let productionStatusMap: Record<string, { total: number; completed: number }> = {};

  if (artifactIds.length > 0) {
    const { data: materials } = await supabase
      .from("materials")
      .select(`
        artifact_id,
        material_lessons (
          material_components (
            type,
            assets
          )
        )
      `)
      .in("artifact_id", artifactIds);

    productionStatusMap = buildProductionStatusMap(
      (materials as MaterialsRow[] | null) || [],
    );
  }

  return {
    currentUserId,
    artifactsWithProfiles: mergeArtifactsWithProfiles(
      artifacts,
      profiles,
      productionStatusMap,
    ),
  };
}
