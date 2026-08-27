import type { SupabaseClient } from "@supabase/supabase-js";
import { getHeygenClientForOrganization } from "../providers/heygen/heygen-credential-resolver.service";
import { HeygenScenesService } from "../providers/heygen/heygen-scenes.service";
import { HeygenVideoService } from "../providers/heygen/heygen-video.service";
import {
  deriveProductionAssetRequirements,
  evaluateProductionItemReadiness,
} from "./production-automation-readiness.service";
import type {
  ProductionAutomationComponent,
  ProductionRunItemConfiguration,
  ProductionRunConfiguration,
  ProductionRunItemStatus,
  ProductionRunStatus,
} from "./production-automation.types";

type ComponentRow = {
  assets: ProductionAutomationComponent["assets"];
  content: ProductionAutomationComponent["content"];
  id: string;
  material_lesson_id: string;
  type: ProductionAutomationComponent["componentType"];
  material_lessons: {
    lesson_id: string;
    module_id: string | null;
    materials: { artifact_id: string } | { artifact_id: string }[] | null;
  } | { lesson_id: string; module_id: string | null; materials: { artifact_id: string } | { artifact_id: string }[] | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value || null;
}

export class ProductionAutomationRunError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Plans and evaluates asset readiness only. Rendering remains an editor action. */
export class ProductionAutomationRunService {
  constructor(private readonly supabase: SupabaseClient<any, "public", any>) {}

  async createRun(params: { artifactId: string; createdBy: string; organizationId: string }) {
    const components = await this.loadVideoComponents(params);
    if (components.length === 0) {
      throw new ProductionAutomationRunError("El curso no tiene componentes de video para automatizar.", 409);
    }

    const { data: run, error: runError } = await this.supabase
      .from("production_runs")
      .insert({
        artifact_id: params.artifactId,
        configuration: { approval_state: "DRAFT", render_mode: "MANUAL_ONLY", version: 1 },
        created_by: params.createdBy,
        organization_id: params.organizationId,
        status: "PLANNING",
      })
      .select("id")
      .single();
    if (runError || !run) {
      if (runError?.code === "23505") {
        throw new ProductionAutomationRunError("Ya existe una automatizacion de produccion activa para este curso.", 409);
      }
      throw runError || new Error("No se pudo crear la ejecucion de produccion.");
    }

    const itemRows = components.map((component) => {
      const requirements = deriveProductionAssetRequirements(component.content?.storyboard);
      // Every video component belongs in the pre-production review, even when
      // its storyboard has not yet been enriched with narration text.
      if (!requirements.some((requirement) => requirement.kind === "AVATAR_AND_VOICE")) {
        requirements.unshift({
          kind: "AVATAR_AND_VOICE",
          reason: "Componente de video incluido en la configuracion de produccion.",
        });
      }
      const readiness = evaluateProductionItemReadiness({ assets: component.assets, requirements });
      return {
        artifact_id: params.artifactId,
        component_type: component.componentType,
        configuration: {},
        material_component_id: component.id,
        material_lesson_id: component.materialLessonId,
        module_id: component.moduleId,
        module_order: component.moduleOrder,
        lesson_order: component.lessonOrder,
        organization_id: params.organizationId,
        production_run_id: run.id,
        readiness,
        ready_for_assembly_at: readiness.complete ? readiness.evaluatedAt : null,
        requirements,
        status: readiness.complete ? "READY_FOR_ASSEMBLY" : "PLANNED",
      };
    });
    const { error: itemError } = await this.supabase.from("production_run_items").insert(itemRows);
    if (itemError) throw itemError;

    return { runId: run.id as string, status: "PLANNING" as const, totalItems: itemRows.length };
  }

  async refreshRun(runId: string, organizationId: string) {
    const { data: run, error: runLookupError } = await this.supabase
      .from("production_runs")
      .select("configuration")
      .eq("id", runId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (runLookupError) throw runLookupError;
    if (!run) throw new ProductionAutomationRunError("Ejecucion de produccion no encontrada.", 404);
    const defaults = (run.configuration as ProductionRunConfiguration | null)?.defaults;
    const { data: items, error } = await this.supabase
      .from("production_run_items")
      .select("id, material_component_id, requirements, configuration, status")
      .eq("production_run_id", runId)
      .eq("organization_id", organizationId);
    if (error) throw error;

    for (const item of items || []) {
      const requirements = Array.isArray(item.requirements) ? item.requirements : [];
      if (item.status === "WAITING_PROVIDER" && requirements.some((requirement: { kind?: string }) => requirement.kind === "AVATAR_AND_VOICE")) {
        const configuration = item.configuration as ProductionRunItemConfiguration | null;
        const avatar = configuration?.avatar || defaults?.avatar;
        if (avatar?.generationMode === "single_video") {
          await this.refreshAvatarVideoStatus({ componentId: item.material_component_id, organizationId });
        } else {
          await this.refreshAvatarSceneStatuses({
            componentId: item.material_component_id,
            organizationId,
          });
        }
      }
      const component = await this.loadComponentAssets(item.material_component_id, organizationId);
      const readiness = evaluateProductionItemReadiness({ assets: component.assets, requirements });
      const nextStatus: ProductionRunItemStatus = readiness.complete
        ? "READY_FOR_ASSEMBLY"
        : item.status === "WAITING_PROVIDER" && hasFailedAvatarGeneration(component.assets)
          ? "FAILED_RETRYABLE"
        : item.status === "READY_FOR_ASSEMBLY" || item.status === "IN_ASSEMBLY"
          ? "STALE"
          : item.status;
      const { error: updateError } = await this.supabase
        .from("production_run_items")
        .update({
          readiness,
          ready_for_assembly_at: readiness.complete ? readiness.evaluatedAt : null,
          status: nextStatus,
          updated_at: readiness.evaluatedAt,
        })
        .eq("id", item.id);
      if (updateError) throw updateError;
    }

    const { data: refreshed, error: refreshedError } = await this.supabase
      .from("production_run_items")
      .select("status")
      .eq("production_run_id", runId)
      .eq("organization_id", organizationId);
    if (refreshedError) throw refreshedError;
    const statuses = (refreshed || []).map((item) => item.status as ProductionRunItemStatus);
    const status: ProductionRunStatus = statuses.every((value) => value === "READY_FOR_ASSEMBLY" || value === "IN_ASSEMBLY")
      ? "READY_FOR_ASSEMBLY"
      : statuses.some((value) => value === "READY_FOR_ASSEMBLY" || value === "IN_ASSEMBLY")
        ? "PARTIALLY_READY"
        : statuses.some((value) => value === "FAILED" || value === "STALE")
          ? "NEEDS_ATTENTION"
          : "GENERATING";
    const now = new Date().toISOString();
    const { error: runError } = await this.supabase
      .from("production_runs")
      .update({
        completed_at: status === "READY_FOR_ASSEMBLY" ? now : null,
        progress: {
          ready_items: statuses.filter((value) => value === "READY_FOR_ASSEMBLY" || value === "IN_ASSEMBLY").length,
          total_items: statuses.length,
        },
        started_at: now,
        status,
        updated_at: now,
      })
      .eq("id", runId)
      .eq("organization_id", organizationId);
    if (runError) throw runError;
    return { runId, status, totalItems: statuses.length };
  }

  async reconcileActiveRuns() {
    const { data, error } = await this.supabase
      .from("production_runs")
      .select("id, organization_id")
      .in("status", ["GENERATING", "PARTIALLY_READY"])
      .order("updated_at", { ascending: true })
      .limit(20);
    if (error) throw error;

    const results = await Promise.allSettled(
      (data || []).map((run) => this.refreshRun(run.id, run.organization_id)),
    );
    return {
      failed: results.filter((result) => result.status === "rejected").length,
      reconciled: results.filter((result) => result.status === "fulfilled").length,
    };
  }

  async getRun(runId: string, organizationId: string) {
    const { data: run, error: runError } = await this.supabase
      .from("production_runs")
      .select("id, artifact_id, status, configuration, progress, created_at, started_at, completed_at")
      .eq("id", runId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) throw new ProductionAutomationRunError("Ejecucion de produccion no encontrada.", 404);

    const { data: items, error: itemsError } = await this.supabase
      .from("production_run_items")
      .select("id, module_id, module_order, lesson_order, material_component_id, component_type, status, requirements, configuration, readiness, last_error, ready_for_assembly_at")
      .eq("production_run_id", runId)
      .eq("organization_id", organizationId)
      .order("module_order", { ascending: true })
      .order("lesson_order", { ascending: true });
    if (itemsError) throw itemsError;
    return { ...run, items: items || [] };
  }

  private async loadVideoComponents(params: { artifactId: string; organizationId: string }) {
    const { data, error } = await this.supabase
      .from("material_components")
      .select("id, assets, content, material_lesson_id, type, material_lessons!inner(lesson_id, module_id, materials!inner(artifact_id))")
      .in("type", ["VIDEO_THEORETICAL", "VIDEO_DEMO", "VIDEO_GUIDE"]);
    if (error) throw error;
    return (data || [])
      .flatMap((row) => {
        const component = this.toAutomationComponent(row as ComponentRow);
        return component ? [component] : [];
      })
      .filter((component) => component.artifactId === params.artifactId)
      .sort((left, right) => left.moduleOrder - right.moduleOrder || left.lessonOrder - right.lessonOrder);
  }

  private async refreshAvatarSceneStatuses(params: { componentId: string; organizationId: string }) {
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: this.supabase,
    });
    await new HeygenScenesService(this.supabase, auth.client).refreshSceneClipStatuses({
      componentId: params.componentId,
      organizationId: params.organizationId,
    });
  }

  private async refreshAvatarVideoStatus(params: { componentId: string; organizationId: string }) {
    const { data: job, error } = await this.supabase
      .from("production_jobs")
      .select("id")
      .eq("material_component_id", params.componentId)
      .eq("organization_id", params.organizationId)
      .eq("job_type", "HEYGEN_AVATAR_VIDEO")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!job) return;
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: this.supabase,
    });
    await new HeygenVideoService(this.supabase, auth.client).getAvatarVideoJobStatus({
      autoPromote: true,
      jobId: job.id,
      organizationId: params.organizationId,
    });
  }

  private toAutomationComponent(row: ComponentRow): (ProductionAutomationComponent & { artifactId: string }) | null {
    const lesson = first(row.material_lessons);
    const materials = first(lesson?.materials);
    if (!lesson || !materials?.artifact_id) return null;
    return {
      artifactId: materials.artifact_id,
      assets: row.assets,
      componentType: row.type,
      content: row.content,
      id: row.id,
      lessonId: lesson.lesson_id,
      lessonOrder: sequenceOrder(lesson.lesson_id),
      materialLessonId: row.material_lesson_id,
      moduleId: lesson.module_id,
      moduleOrder: moduleOrder(lesson.module_id),
    };
  }

  private async loadComponentAssets(componentId: string, organizationId: string) {
    const { data, error } = await this.supabase
      .from("material_components")
      .select("assets, material_lessons!inner(materials!inner(artifacts!inner(organization_id)))")
      .eq("id", componentId)
      .maybeSingle();
    if (error) throw error;
    const lesson = first(data?.material_lessons as unknown as ComponentRow["material_lessons"]);
    const materials = first(lesson?.materials);
    const artifact = first((materials as { artifacts?: { organization_id?: string } | { organization_id?: string }[] } | null)?.artifacts);
    if (!data || artifact?.organization_id !== organizationId) {
      throw new ProductionAutomationRunError("Componente de produccion no encontrado para esta empresa.", 404);
    }
    return { assets: data.assets };
  }
}

function moduleOrder(moduleId: string | null) {
  const match = moduleId?.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function sequenceOrder(value: string | null) {
  const match = value?.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function hasFailedAvatarGeneration(assets: unknown) {
  const value = assets as { avatar_clips?: Array<{ status?: string }>; avatar_video?: { sync_status?: string } } | null;
  return Boolean(
    value?.avatar_clips?.some((clip) => clip.status === "FAILED")
    || value?.avatar_video?.sync_status === "FAILED",
  );
}
