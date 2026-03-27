import { createClient as createServiceRoleClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getAuthBridgeUser } from "@/utils/auth/session";

type PlatformRole = "ADMIN" | "CONSTRUCTOR" | "ARQUITECTO";

interface ArtifactDetailLoadOptions {
  artifactId: string;
  activeOrganizationId?: string | null;
  fallbackRole: PlatformRole;
  fallbackName: string;
}

interface PublicationLesson {
  id: string;
  title: string;
  module_title: string;
  auto_video_url: string;
  auto_duration: number;
}

interface ArtifactDetailPageData {
  artifact: any;
  publicationRequest: any;
  publicationLessons: PublicationLesson[];
  displayProfile: any;
}

function normalizeSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function getServiceRoleClient() {
  return createServiceRoleClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function loadDisplayProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  options: Pick<ArtifactDetailLoadOptions, "fallbackRole" | "fallbackName">,
) {
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
      return profile;
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
  supabase: Awaited<ReturnType<typeof createClient>>,
  materialsId: string,
): Promise<PublicationLesson[]> {
  const { data: rawLessons } = await supabase
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

  return rawLessons.map((lesson: any) => {
    let videoUrl = "";
    let duration = 0;

    if (
      lesson.material_components &&
      Array.isArray(lesson.material_components)
    ) {
      const videoComponent = lesson.material_components.find(
        (component: any) =>
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
            (total: number, section: any) =>
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
  let artifactQuery = supabase
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

  const [displayProfile, curationResult, materialsResult, publicationResult] =
    await Promise.all([
      loadDisplayProfile(supabase, options),
      supabase
        .from("curation")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      supabase
        .from("materials")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
      supabase
        .from("publication_requests")
        .select("*")
        .eq("artifact_id", options.artifactId)
        .maybeSingle(),
    ]);

  const syllabusData = normalizeSingleRelation(artifactRaw.syllabus);
  const instructionalPlanData = normalizeSingleRelation(
    artifactRaw.instructional_plans,
  );
  const curationData = curationResult.data || null;
  const materialsData = materialsResult.data || null;
  const publicationLessons = materialsData
    ? await loadPublicationLessons(supabase, materialsData.id)
    : [];

  return {
    artifact: {
      ...artifactRaw,
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
    publicationRequest: publicationResult.data || null,
    publicationLessons,
    displayProfile,
  };
}
