import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getAuthBridgeUser } from "@/utils/auth/session";
import type {
  ArtifactStageRelation,
  ArtifactDisplayProfile,
  ArtifactTemarioRelation,
  ArtifactViewRecord,
} from "@/app/admin/artifacts/[id]/artifact-view.types";
import type {
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
import type { MaterialAssets, VideoScript } from "@/domains/materials/types/materials.types";
import type { SyllabusModule } from "@/domains/syllabus/types/syllabus.types";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";

type PlatformRole = "ADMIN" | "CONSTRUCTOR" | "ARQUITECTO";

interface ArtifactDetailLoadOptions {
  artifactId: string;
  activeOrganizationId?: string | null;
  fallbackRole: PlatformRole;
  fallbackName: string;
}

interface ArtifactDetailPageData {
  artifact: ArtifactViewRecord;
  publicationRequest: PublicationRequestRecord | null;
  publicationLessons: PublicationVideoLesson[];
  displayProfile: ArtifactDisplayProfile;
}

interface ProfileRow extends ArtifactDisplayProfile {
  username?: string | null;
}

interface PublicationLessonSection {
  duration_seconds?: number;
}

interface PublicationLessonComponentRow {
  assets?: MaterialAssets | null;
  content?: {
    duration_estimate_minutes?: number;
    script?: Pick<VideoScript, "sections">;
  } | null;
  type: string;
}

interface PublicationLessonRow {
  lesson_id: string;
  lesson_title: string;
  material_components?: PublicationLessonComponentRow[] | null;
  module_title: string;
}

interface ArtifactRelationRecord extends ArtifactStageRelation {}

interface SyllabusRelationRecord extends ArtifactTemarioRelation {
  modules?: SyllabusModule[] | null;
}

interface ArtifactRawRecord extends ArtifactViewRecord {
  instructional_plans?: ArtifactRelationRecord | ArtifactRelationRecord[] | null;
  syllabus?: SyllabusRelationRecord | SyllabusRelationRecord[] | null;
}

function normalizeSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function getServiceRoleClient() {
  return createServiceRoleClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  );
}

async function loadDisplayProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options: Pick<ArtifactDetailLoadOptions, "fallbackRole" | "fallbackName">,
): Promise<ArtifactDisplayProfile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bridgeUser = user ? null : await getAuthBridgeUser();
  const userId = user?.id || bridgeUser?.id;

  if (userId) {
    const admin = getServiceRoleClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profile) {
      const typedProfile = profile as ProfileRow;
      return {
        first_name: typedProfile.first_name || typedProfile.username || null,
        email: typedProfile.email || user?.email || bridgeUser?.email,
        platform_role: typedProfile.platform_role || options.fallbackRole,
      };
    }
  }

  return {
    first_name:
      bridgeUser?.first_name ||
      user?.email?.split("@")[0] ||
      options.fallbackName,
    email: bridgeUser?.email || user?.email,
    platform_role: options.fallbackRole,
  };
}

async function loadPublicationLessons(
  client: ReturnType<typeof getServiceRoleClient>,
  materialsId: string,
): Promise<PublicationVideoLesson[]> {
  const { data: rawLessons } = await client
    .from("material_lessons")
    .select(
      `
      lesson_id,
      lesson_title,
      module_title,
      material_components(
        type,
        assets,
        content
      )
    `,
    )
    .eq("materials_id", materialsId)
    .order("lesson_id");

  if (!rawLessons) {
    return [];
  }

  return (rawLessons as PublicationLessonRow[]).map((lesson) => {
    let videoUrl = "";
    let duration = 0;

    if (
      lesson.material_components &&
      Array.isArray(lesson.material_components)
    ) {
      const videoComponent = lesson.material_components.find(
        (component) =>
          component.assets?.final_video_url ||
          component.assets?.video_url ||
          component.type.includes("VIDEO"),
      );

      if (videoComponent) {
        videoUrl =
          videoComponent.assets?.final_video_url ||
          videoComponent.assets?.video_url ||
          "";

        if (videoComponent.content?.script?.sections) {
          duration = videoComponent.content.script.sections.reduce(
            (total: number, section: PublicationLessonSection) =>
              total + (section.duration_seconds || 0),
            0,
          );
        }

        if (duration === 0 && videoComponent.content?.duration_estimate_minutes) {
          duration = Math.round(
            videoComponent.content.duration_estimate_minutes * 60,
          );
        }
      }
    }

    return {
      id: lesson.lesson_id,
      title: lesson.lesson_title,
      module_title: lesson.module_title,
      auto_video_url: videoUrl,
      auto_duration: duration,
    };
  });
}

export async function loadArtifactDetailPageData(
  options: ArtifactDetailLoadOptions,
): Promise<ArtifactDetailPageData | null> {
  const supabase = await createClient();

  // Usar service role client para las consultas de datos del artefacto.
  // El usuario puede estar autenticado via Auth Bridge (JWT custom),
  // cuyo token no es reconocido por las políticas RLS de Supabase.
  // La autorización se controla por el filtro organization_id.
  const admin = getServiceRoleClient();

  let artifactQuery = admin
    .from("artifacts")
    .select("*, syllabus(*), instructional_plans(*)")
    .eq("id", options.artifactId);

  if (options.activeOrganizationId) {
    artifactQuery = artifactQuery.eq(
      "organization_id",
      options.activeOrganizationId,
    );
  }

  const { data: artifactRaw, error } = await artifactQuery.single();
  if (error || !artifactRaw) {
    return null;
  }
  const typedArtifactRaw = artifactRaw as ArtifactRawRecord;

  const [displayProfile, curationResult, materialsResult, publicationResult] =
    await Promise.all([
      loadDisplayProfile(supabase, options),
      admin
        .from("curation")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      admin
        .from("materials")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      admin
        .from("publication_requests")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
    ]);

  const syllabusData = normalizeSingleRelation(typedArtifactRaw.syllabus);
  const instructionalPlanData = normalizeSingleRelation(
    typedArtifactRaw.instructional_plans,
  );
  const curationData = curationResult.data || null;
  const materialsData = materialsResult.data || null;
  const publicationLessons = materialsData
    ? await loadPublicationLessons(admin, materialsData.id)
    : [];

  return {
    artifact: {
      ...typedArtifactRaw,
      temario: syllabusData,
      instructional_plan: instructionalPlanData,
      curation: curationData,
      materials: materialsData,
      syllabus_state: syllabusData?.state,
      syllabus_status: syllabusData?.state,
      plan_state: instructionalPlanData?.state,
      curation_state: curationData?.state,
      materials_state: materialsData?.state,
    },
    publicationRequest: (publicationResult.data as PublicationRequestRecord | null) || null,
    publicationLessons,
    displayProfile,
  };
}
