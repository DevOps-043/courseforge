"use server";

import crypto from "crypto";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import type {
  MaterialAssets,
  MaterialComponent,
} from "@/domains/materials/types/materials.types";
import { createClient } from "@/utils/supabase/server";

const STANDALONE_VIDEO_COMPONENT_TYPES = new Set([
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
]);

type StandaloneAssemblyProjectStatus =
  | "DRAFT"
  | "READY"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED"
  | "ARCHIVED";

interface StandaloneProjectRow {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  status: StandaloneAssemblyProjectStatus;
  final_video_url?: string | null;
  backing_artifact_id?: string | null;
  backing_material_id?: string | null;
  backing_lesson_id?: string | null;
  backing_component_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface StandaloneComponentRow {
  id: string;
  material_lesson_id: string;
  type: MaterialComponent["type"];
  content: Record<string, unknown> | null;
  source_refs: string[] | null;
  validation_status: MaterialComponent["validation_status"] | null;
  validation_errors: string[] | null;
  generated_at: string;
  iteration_number: number | null;
  assets: MaterialAssets | null;
  material_lessons?: unknown;
}

export interface StandaloneAssemblyProjectSummary {
  artifactId: string | null;
  componentId: string | null;
  createdAt: string;
  description: string | null;
  finalVideoUrl: string | null;
  id: string;
  productionStatus: MaterialAssets["production_status"] | "PENDING";
  status: StandaloneAssemblyProjectStatus;
  title: string;
  updatedAt: string;
}

export interface StandaloneAssemblyComponentView {
  artifactId: string;
  component: MaterialComponent;
  lessonTitle: string;
  project: StandaloneAssemblyProjectSummary;
  workshopName: string;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

async function requireStandaloneAssemblyAccess() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    return { admin: null, error: "Unauthorized" as const, tenant: null, user: null };
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant?.organizationId) {
    return {
      admin: null,
      error: "Empresa no valida o no autorizada." as const,
      tenant: null,
      user: null,
    };
  }

  const canManageProduction = await canReviewContent(user.userId);
  if (!canManageProduction) {
    return {
      admin: null,
      error: "No tienes permisos para gestionar ensambles." as const,
      tenant: null,
      user: null,
    };
  }

  return {
    admin: getServiceRoleClient(),
    error: null,
    tenant,
    user,
  };
}

function normalizeProjectSummary(
  project: StandaloneProjectRow,
  componentAssets?: MaterialAssets | null,
): StandaloneAssemblyProjectSummary {
  const finalVideoUrl =
    componentAssets?.final_video_url || project.final_video_url || null;

  return {
    artifactId: project.backing_artifact_id || null,
    componentId: project.backing_component_id || null,
    createdAt: project.created_at,
    description: project.description || null,
    finalVideoUrl,
    id: project.id,
    productionStatus: componentAssets?.production_status || "PENDING",
    status: finalVideoUrl ? "COMPLETED" : project.status,
    title: project.title,
    updatedAt: project.updated_at,
  };
}

function normalizeComponent(rawComponent: StandaloneComponentRow): MaterialComponent {
  return {
    id: rawComponent.id,
    material_lesson_id: rawComponent.material_lesson_id,
    type: rawComponent.type,
    content: rawComponent.content || {},
    source_refs: rawComponent.source_refs || [],
    validation_status: rawComponent.validation_status || "PENDING",
    validation_errors: rawComponent.validation_errors || [],
    generated_at: rawComponent.generated_at,
    iteration_number: rawComponent.iteration_number || 1,
    assets: rawComponent.assets || {},
  };
}

async function loadStandaloneProject(projectId: string, organizationId: string) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("standalone_assembly_projects")
    .select(
      "id, organization_id, title, description, status, final_video_url, backing_artifact_id, backing_material_id, backing_lesson_id, backing_component_id, created_at, updated_at",
    )
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .neq("status", "ARCHIVED")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data || null) as StandaloneProjectRow | null;
}

async function syncProjectFromAssets(params: {
  componentId: string;
  organizationId: string;
  projectId: string;
}) {
  const admin = getServiceRoleClient();
  const { data: component } = await admin
    .from("material_components")
    .select("assets")
    .eq("id", params.componentId)
    .maybeSingle();

  const assets = ((component as { assets?: MaterialAssets | null } | null)?.assets ||
    {}) as MaterialAssets;
  const finalVideoUrl = assets.final_video_url || null;
  const status: StandaloneAssemblyProjectStatus = finalVideoUrl
    ? "COMPLETED"
    : assets.production_status === "IN_PROGRESS"
      ? "RENDERING"
      : "READY";

  await admin
    .from("standalone_assembly_projects")
    .update({
      final_video_url: finalVideoUrl,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.projectId)
    .eq("organization_id", params.organizationId);
}

export async function listStandaloneAssemblyProjectsAction(query = "") {
  const access = await requireStandaloneAssemblyAccess();
  if (access.error || !access.tenant || !access.admin) {
    return { success: false, error: access.error || "Unauthorized" };
  }

  try {
    const projectQuery = access.admin
      .from("standalone_assembly_projects")
      .select(
        "id, organization_id, title, description, status, final_video_url, backing_artifact_id, backing_material_id, backing_lesson_id, backing_component_id, created_at, updated_at",
      )
      .eq("organization_id", access.tenant.organizationId)
      .neq("status", "ARCHIVED")
      .order("updated_at", { ascending: false })
      .limit(80);

    const { data, error } = await projectQuery;
    if (error) {
      throw new Error(error.message);
    }

    const normalizedQuery = query.trim().toLowerCase();
    const projects = ((data || []) as StandaloneProjectRow[])
      .filter((project) => project.backing_component_id)
      .filter((project) => {
        if (!normalizedQuery) return true;
        return `${project.title} ${project.description || ""}`
          .toLowerCase()
          .includes(normalizedQuery);
      });
    const componentIds = projects
      .map((project) => project.backing_component_id)
      .filter(Boolean) as string[];
    const componentAssets = new Map<string, MaterialAssets | null>();

    if (componentIds.length > 0) {
      const { data: components, error: componentError } = await access.admin
        .from("material_components")
        .select("id, assets")
        .in("id", componentIds);

      if (componentError) {
        throw new Error(componentError.message);
      }

      (components || []).forEach((component) => {
        const row = component as { assets?: MaterialAssets | null; id: string };
        componentAssets.set(row.id, row.assets || null);
      });
    }

    return {
      success: true,
      projects: projects.map((project) =>
        normalizeProjectSummary(
          project,
          project.backing_component_id
            ? componentAssets.get(project.backing_component_id)
            : null,
        ),
      ),
    };
  } catch (error: unknown) {
    console.error("[StandaloneAssembly] Project list failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function createStandaloneAssemblyProjectAction(input: {
  description?: string;
  title: string;
}) {
  const access = await requireStandaloneAssemblyAccess();
  if (access.error || !access.tenant || !access.user || !access.admin) {
    return { success: false, error: access.error || "Unauthorized" };
  }

  const title = input.title.trim();
  if (!title) {
    return { success: false, error: "El titulo del video es requerido." };
  }

  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  const lessonId = `standalone-assembly-${projectId}`;
  const baseContent = {
    duration_estimate_minutes: 1,
    script: {
      sections: [],
      title,
    },
    storyboard: [],
    title,
  };

  try {
    const { data: artifact, error: artifactError } = await access.admin
      .from("artifacts")
      .insert({
        created_by: access.user.userId,
        descripcion: {
          mode: "standalone_assembly",
          source: "admin_assembly_studio",
          text: input.description?.trim() || null,
        },
        generation_metadata: {
          standalone_assembly: true,
          standalone_assembly_project_id: projectId,
        },
        idea_central: `[Ensamble] ${title}`,
        nombres: [],
        objetivos: [],
        organization_id: access.tenant.organizationId,
        state: "DRAFT",
      })
      .select("id")
      .single();

    if (artifactError || !artifact?.id) {
      throw new Error(artifactError?.message || "No se pudo crear el respaldo del artefacto.");
    }

    const { data: material, error: materialError } = await access.admin
      .from("materials")
      .insert({
        artifact_id: artifact.id,
        dod: { automatic_checks: [], checklist: [] },
        global_blockers: [],
        lessons: [],
        package: null,
        prompt_version: "standalone-assembly",
        qa_decision: null,
        state: "PHASE3_APPROVED",
        version: 1,
      })
      .select("id")
      .single();

    if (materialError || !material?.id) {
      throw new Error(materialError?.message || "No se pudo crear el respaldo de materiales.");
    }

    const { data: lesson, error: lessonError } = await access.admin
      .from("material_lessons")
      .insert({
        dod: {},
        expected_components: ["VIDEO_THEORETICAL"],
        lesson_id: lessonId,
        lesson_title: title,
        materials_id: material.id,
        max_iterations: 1,
        module_id: "standalone-assembly",
        module_title: "Ensamble independiente",
        oa_text: "Video independiente creado desde el estudio de ensamble.",
        quiz_spec: null,
        requires_demo_guide: false,
        state: "APPROVABLE",
      })
      .select("id")
      .single();

    if (lessonError || !lesson?.id) {
      throw new Error(lessonError?.message || "No se pudo crear la leccion de respaldo.");
    }

    const { data: component, error: componentError } = await access.admin
      .from("material_components")
      .insert({
        assets: {
          production_status: "PENDING",
          updated_at: now,
        },
        content: baseContent,
        generated_at: now,
        iteration_number: 1,
        material_lesson_id: lesson.id,
        source_refs: [],
        type: "VIDEO_THEORETICAL",
        validation_errors: [],
        validation_status: "PASS",
      })
      .select("id")
      .single();

    if (componentError || !component?.id) {
      throw new Error(componentError?.message || "No se pudo crear el componente de video.");
    }

    const { data: project, error: projectError } = await access.admin
      .from("standalone_assembly_projects")
      .insert({
        backing_artifact_id: artifact.id,
        backing_component_id: component.id,
        backing_lesson_id: lesson.id,
        backing_material_id: material.id,
        created_by: access.user.userId,
        description: input.description?.trim() || null,
        id: projectId,
        organization_id: access.tenant.organizationId,
        status: "READY",
        title,
      })
      .select(
        "id, organization_id, title, description, status, final_video_url, backing_artifact_id, backing_material_id, backing_lesson_id, backing_component_id, created_at, updated_at",
      )
      .single();

    if (projectError || !project) {
      throw new Error(projectError?.message || "No se pudo crear el proyecto de ensamble.");
    }

    return {
      success: true,
      project: normalizeProjectSummary(project as StandaloneProjectRow, {
        production_status: "PENDING",
      }),
    };
  } catch (error: unknown) {
    console.error("[StandaloneAssembly] Project creation failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getStandaloneAssemblyProjectAction(projectId: string) {
  if (!projectId) {
    return { success: false, error: "projectId es requerido" };
  }

  const access = await requireStandaloneAssemblyAccess();
  if (access.error || !access.tenant || !access.admin) {
    return { success: false, error: access.error || "Unauthorized" };
  }

  try {
    const project = await loadStandaloneProject(
      projectId,
      access.tenant.organizationId,
    );

    if (!project?.backing_component_id || !project.backing_artifact_id) {
      return {
        success: false,
        error: "El proyecto no tiene un componente de ensamble vinculado.",
      };
    }

    const { data, error } = await access.admin
      .from("material_components")
      .select(
        `
          id,
          material_lesson_id,
          type,
          content,
          source_refs,
          validation_status,
          validation_errors,
          generated_at,
          iteration_number,
          assets,
          material_lessons!inner (
            lesson_title,
            materials!inner (
              artifact_id,
              artifacts!inner (
                idea_central
              )
            )
          )
        `,
      )
      .eq("id", project.backing_component_id)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message || "No se encontro el componente de ensamble.",
      };
    }

    const rawComponent = data as StandaloneComponentRow;
    if (!STANDALONE_VIDEO_COMPONENT_TYPES.has(rawComponent.type)) {
      return {
        success: false,
        error: "Este proyecto no tiene un componente de video valido.",
      };
    }

    const lessonRelation = firstRelation(
      rawComponent.material_lessons as
        | { lesson_title?: string; materials?: unknown }
        | { lesson_title?: string; materials?: unknown }[]
        | null,
    );
    const materialsRelation = firstRelation(
      lessonRelation?.materials as
        | { artifact_id?: string; artifacts?: unknown }
        | { artifact_id?: string; artifacts?: unknown }[]
        | null,
    );
    const artifactRelation = firstRelation(
      materialsRelation?.artifacts as
        | { idea_central?: string }
        | { idea_central?: string }[]
        | null,
    );
    const component = normalizeComponent(rawComponent);

    if (component.assets.final_video_url !== project.final_video_url) {
      await syncProjectFromAssets({
        componentId: component.id,
        organizationId: access.tenant.organizationId,
        projectId: project.id,
      });
    }

    return {
      success: true,
      data: {
        artifactId: materialsRelation?.artifact_id || project.backing_artifact_id,
        component,
        lessonTitle: lessonRelation?.lesson_title || project.title,
        project: normalizeProjectSummary(project, component.assets),
        workshopName:
          artifactRelation?.idea_central?.replace(/^\[Ensamble\]\s*/i, "") ||
          "Ensamble independiente",
      } satisfies StandaloneAssemblyComponentView,
    };
  } catch (error: unknown) {
    console.error("[StandaloneAssembly] Project fetch failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function syncStandaloneAssemblyProjectAction(projectId: string) {
  const access = await requireStandaloneAssemblyAccess();
  if (access.error || !access.tenant) {
    return { success: false, error: access.error || "Unauthorized" };
  }

  try {
    const project = await loadStandaloneProject(
      projectId,
      access.tenant.organizationId,
    );
    if (!project?.backing_component_id) {
      return { success: false, error: "Proyecto de ensamble no encontrado." };
    }

    await syncProjectFromAssets({
      componentId: project.backing_component_id,
      organizationId: access.tenant.organizationId,
      projectId,
    });

    return { success: true };
  } catch (error: unknown) {
    console.error("[StandaloneAssembly] Project sync failed:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}
