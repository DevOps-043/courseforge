import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import ArtifactClientView from "@/app/admin/artifacts/[id]/ArtifactClientView";
import { getAuthBridgeUser } from "@/utils/auth/session";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function ConstructorArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // UUID Validation
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return (
      <div className="p-8 pb-32 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl shadow-sm text-center">
          <h2 className="text-lg font-semibold mb-2">
            ID de Artefacto Inválido
          </h2>
          <p>El identificador proporcionado no tiene un formato válido.</p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();

  // Obtener Perfil del Usuario Actual
  let {
    data: { user },
  } = await supabase.auth.getUser();
  let bridgeUser = null;
  if (!user) {
    bridgeUser = await getAuthBridgeUser();
  }
  const userId = user?.id || bridgeUser?.id;

  let profile = null;
  if (userId) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    profile = data;
  }

  // Fetch Artifact con Syllabus e Instructional Plans relacionados
  const { data: artifactRaw, error } = await supabase
    .from("artifacts")
    .select("*, syllabus(*), instructional_plans(*)")
    .eq("id", id)
    .single();

  if (error || !artifactRaw) {
    redirect("/builder/artifacts");
  }

  // Fetch Curation separadamente
  const { data: curationRaw } = await supabase
    .from("curation")
    .select("*")
    .eq("artifact_id", id)
    .maybeSingle();

  // Fetch Materials separadamente
  let materialsRaw = null;
  try {
    const { data } = await supabase
      .from("materials")
      .select("*")
      .eq("artifact_id", id)
      .maybeSingle();
    materialsRaw = data;
  } catch {
    console.log("Materials table not found or query failed");
  }

  // Aplanar estructura para el cliente
  const syllabusData = Array.isArray(artifactRaw.syllabus)
    ? artifactRaw.syllabus[0]
    : artifactRaw.syllabus;
  const instructionalPlanData = Array.isArray(artifactRaw.instructional_plans)
    ? artifactRaw.instructional_plans[0]
    : artifactRaw.instructional_plans;
  const curationData = curationRaw || null;
  const materialsData = materialsRaw || null;

  const artifact = {
    ...artifactRaw,
    temario: syllabusData || null,
    instructional_plan: instructionalPlanData || null,
    curation: curationData,
    materials: materialsData,
    syllabus_state: syllabusData?.state,
    syllabus_status: syllabusData?.state,
    plan_state: instructionalPlanData?.state,
    curation_state: curationData?.state,
    materials_state: materialsData?.state,
  };

  // Fetch Publication Request
  const { data: publicationRequest } = await supabase
    .from("publication_requests")
    .select("*")
    .eq("artifact_id", id)
    .maybeSingle();

  // Fetch Lessons for publication map
  let publicationLessons: any[] = [];
  if (materialsData) {
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
      .eq("materials_id", materialsData.id)
      .order("lesson_id");

    if (rawLessons) {
      publicationLessons = rawLessons.map((l: any) => {
        let videoUrl = "";
        let duration = 0;

        if (l.material_components && Array.isArray(l.material_components)) {
          const videoComp = l.material_components.find(
            (c: any) =>
              c.assets?.final_video_url ||
              c.assets?.video_url ||
              c.type.includes("VIDEO"),
          );

          if (videoComp) {
            videoUrl =
              videoComp.assets?.final_video_url ||
              videoComp.assets?.video_url ||
              "";
            if (videoComp.content) {
              const content = videoComp.content;
              if (content.script?.sections) {
                duration = content.script.sections.reduce(
                  (acc: number, sec: any) => acc + (sec.duration_seconds || 0),
                  0,
                );
              }
              if (duration === 0 && content.duration_estimate_minutes) {
                duration = Math.round(content.duration_estimate_minutes * 60);
              }
            }
          }
        }
        return {
          id: l.lesson_id,
          title: l.lesson_title,
          module_title: l.module_title,
          auto_video_url: videoUrl,
          auto_duration: duration,
        };
      });
    }
  }

  const displayProfile = profile || {
    first_name:
      bridgeUser?.first_name || user?.email?.split("@")[0] || "Constructor",
    email: bridgeUser?.email || user?.email,
    platform_role: "CONSTRUCTOR",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      {/* Top Navigation */}
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link
          href="/builder/artifacts"
          className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver a Mis Asignaciones
        </Link>
        <span className="text-gray-300 dark:text-[#6C757D]">/</span>
        <span className="text-gray-900 dark:text-white truncate max-w-xs">
          {artifact.idea_central}
        </span>
      </div>

      <ArtifactClientView
        artifact={artifact}
        publicationRequest={publicationRequest}
        publicationLessons={publicationLessons}
        profile={displayProfile}
        basePath="/builder"
      />
    </div>
  );
}
