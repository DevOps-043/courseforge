import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getAuthBridgeUser } from "@/utils/auth/session";
import type {
  ArtifactStageRelation,
  ArtifactDisplayProfile,
  ArtifactTemarioRelation,
  ArtifactViewRecord,
} from "@/app/admin/artifacts/[id]/artifact-view.types";
import {
  hasVideoComponent,
  sortLessonsNaturally,
} from "@/domains/publication/lib/publication-payload-builders";
import type {
  PublicationComponent,
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
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

interface PublicationLessonRow {
  lesson_id: string;
  lesson_title: string;
  material_components?: PublicationComponent[] | null;
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

const PROFILE_SELECT = "id, username, first_name, email, platform_role";
const ARTIFACT_DETAIL_SELECT = `
  id,
  course_id,
  created_at,
  descripcion,
  generation_metadata,
  idea_central,
  nombres,
  objetivos,
  production_complete,
  state,
  validation_report,
  syllabus(
    id,
    state,
    qa,
    modules
  ),
  instructional_plans(
    id,
    state,
    approvals,
    final_status
  )
`;
const CURATION_DETAIL_SELECT = `
  id,
  state,
  qa_decision,
  upstream_dirty,
  upstream_dirty_source
`;
const MATERIALS_DETAIL_SELECT = `
  id,
  state,
  qa_decision,
  upstream_dirty,
  upstream_dirty_source
`;
const PUBLICATION_REQUEST_SELECT = `
  id,
  artifact_id,
  category,
  level,
  instructor_email,
  thumbnail_url,
  slug,
  price,
  lesson_videos,
  status,
  soflia_course_id,
  soflia_response,
  sent_at,
  response_at,
  rejection_reason,
  created_at,
  updated_at,
  selected_lessons,
  upstream_dirty,
  upstream_dirty_source
`;

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
  const admin = getServiceRoleClient();

  // Auth Bridge es el método de autenticación primario de esta app.
  // Se consulta primero para evitar que una sesión GoTrue residual
  // (con un rol distinto, ej. CONSTRUCTOR) enmascare el perfil real del usuario.
  const bridgeUser = await getAuthBridgeUser();
  if (bridgeUser?.id) {
    const { data: profile } = await admin
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", bridgeUser.id)
      .maybeSingle();

    if (profile) {
      const typedProfile = profile as ProfileRow;
      return {
        first_name: typedProfile.first_name || typedProfile.username || null,
        email: typedProfile.email || bridgeUser.email,
        platform_role: typedProfile.platform_role || options.fallbackRole,
      };
    }

    // Bridge user válido pero sin perfil en DB aún
    return {
      first_name: bridgeUser.first_name || bridgeUser.email?.split("@")[0] || options.fallbackName,
      email: bridgeUser.email,
      platform_role: options.fallbackRole,
    };
  }

  // Fallback: sesión GoTrue (usuarios que no usan Auth Bridge)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) {
    const { data: profile } = await admin
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", user.id)
      .maybeSingle();

    if (profile) {
      const typedProfile = profile as ProfileRow;
      return {
        first_name: typedProfile.first_name || typedProfile.username || null,
        email: typedProfile.email || user.email,
        platform_role: typedProfile.platform_role || options.fallbackRole,
      };
    }
  }

  return {
    first_name: user?.email?.split("@")[0] || options.fallbackName,
    email: user?.email,
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
    .eq("materials_id", materialsId);

  if (!rawLessons) {
    return [];
  }

  const sorted = sortLessonsNaturally(rawLessons as PublicationLessonRow[]);

  return sorted
    .filter((lesson) => hasVideoComponent(lesson.material_components))
    .map((lesson) => {
      let videoUrl = "";
      let duration = 0;

      const videoComponent = (lesson.material_components || []).find(
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

        const content = videoComponent.content as {
          duration_estimate_minutes?: number;
          script?: { sections?: PublicationLessonSection[] };
        } | null;

        if (content?.script?.sections) {
          duration = content.script.sections.reduce(
            (total: number, section: PublicationLessonSection) =>
              total + (section.duration_seconds || 0),
            0,
          );
        }

        if (duration === 0 && content?.duration_estimate_minutes) {
          duration = Math.round(content.duration_estimate_minutes * 60);
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
    .select(ARTIFACT_DETAIL_SELECT)
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
        .select(CURATION_DETAIL_SELECT)
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      admin
        .from("materials")
        .select(MATERIALS_DETAIL_SELECT)
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      admin
        .from("publication_requests")
        .select(PUBLICATION_REQUEST_SELECT)
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
