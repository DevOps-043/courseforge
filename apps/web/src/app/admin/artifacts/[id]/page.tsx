import { createClient } from "@/utils/supabase/server";
import {
  getActiveOrganizationId,
  getAuthBridgeUser,
} from "@/utils/auth/session";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ArtifactClientView from "./ArtifactClientView";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function ArtifactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const activeOrgId = await getActiveOrganizationId();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bridgeUser = user ? null : await getAuthBridgeUser();
  const userId = user?.id || bridgeUser?.id;

  let displayProfile: any = null;
  if (userId) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    displayProfile =
      profile ||
      (bridgeUser
        ? {
            first_name: bridgeUser.first_name,
            email: bridgeUser.email,
            platform_role: "ADMIN",
          }
        : user
          ? {
              first_name: user.email?.split("@")[0] || "Admin",
              email: user.email,
              platform_role: "ADMIN",
            }
          : null);
  }

  let artifactQuery = supabase
    .from("artifacts")
    .select("*, syllabus(*), instructional_plans(*)")
    .eq("id", id);
  if (activeOrgId)
    artifactQuery = artifactQuery.eq("organization_id", activeOrgId);
  const { data: artifactRaw, error } = await artifactQuery.single();

  if (error || !artifactRaw) {
    notFound();
  }

  const { data: curationRaw } = await supabase
    .from("curation")
    .select("*")
    .eq("artifact_id", id)
    .maybeSingle();

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

  const { data: publicationRequest } = await supabase
    .from("publication_requests")
    .select("*")
    .eq("artifact_id", id)
    .maybeSingle();

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

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link
          href="/admin/artifacts"
          className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver a Artefactos
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
      />
    </div>
  );
}
