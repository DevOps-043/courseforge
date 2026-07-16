import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";
import { normalizeAssemblyAssets } from "@/remotion/assembly-assets.normalizer";
import {
  deriveAssemblyTargetDurationSeconds,
  withAssemblyTargetDuration,
} from "@/remotion/assembly-duration";
import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  renderBatchRequestSchema,
  type RenderBatchItemStatusView,
  type RenderBatchRequest,
  type RenderBatchStatusView,
} from "./render-batch.types";

type SupabaseAdmin = ReturnType<typeof getServiceRoleClient>;

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getComponentLabel(component: any) {
  const lesson = firstRelation(component.material_lessons);
  return lesson?.lesson_title || component.content?.title || "Video";
}

function getProgressPercent(progress: unknown) {
  if (!Array.isArray(progress) || progress.length === 0) return 0;
  const last = progress[progress.length - 1] as { percent?: unknown };
  const percent = Number(last.percent);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
}

function getLastLog(progress: unknown) {
  if (!Array.isArray(progress) || progress.length === 0) return undefined;
  const last = progress[progress.length - 1] as { message?: unknown };
  return typeof last.message === "string" ? last.message : undefined;
}

function hasRenderableAssets(component: any) {
  const currentAssets = (component.assets || {}) as MaterialAssets;
  const targetDurationSeconds = deriveAssemblyTargetDurationSeconds(component.content);
  const renderAssets = withAssemblyTargetDuration(currentAssets, targetDurationSeconds);
  const normalizedAssets = normalizeAssemblyAssets(renderAssets, 30);

  return Boolean(
    normalizedAssets.voiceAudioUrl ||
      normalizedAssets.avatarVideoUrl ||
      normalizedAssets.slides.length > 0 ||
      normalizedAssets.brollClips.length > 0,
  );
}

export class RenderBatchService {
  constructor(
    private readonly supabase: SupabaseAdmin,
    private readonly controlPlane = new DesktopWorkerControlPlane(supabase),
  ) {}

  async createBatch(input: RenderBatchRequest, context: { userId: string; organizationIds: string[] }) {
    const request = renderBatchRequestSchema.parse(input);
    const { data: artifact, error: artifactError } = await this.supabase
      .from("artifacts")
      .select("id, organization_id")
      .eq("id", request.artifactId)
      .maybeSingle();

    if (artifactError || !artifact) throw new Error("ARTIFACT_NOT_FOUND");
    if (!context.organizationIds.includes(artifact.organization_id)) {
      throw new Error("FORBIDDEN_ARTIFACT_ORGANIZATION");
    }

    const componentIds = request.items.map((item) => item.componentId);
    const templateIds = Array.from(new Set([
      request.defaultTemplateId,
      ...request.items.map((item) => item.templateId).filter((value): value is string => Boolean(value)),
    ]));
    const preferredWorkerIds = Array.from(new Set(
      request.items
        .map((item) => item.preferredWorkerId)
        .filter((value): value is string => Boolean(value)),
    ));

    const [{ data: components }, { data: templates }, { data: workers }] = await Promise.all([
      this.supabase
        .from("material_components")
        .select(`
          id, assets, content, type, material_lesson_id,
          material_lessons (
            id, lesson_id, lesson_title, module_title, module_id,
            materials ( artifact_id )
          )
        `)
        .in("id", componentIds),
      this.supabase
        .from("remotion_templates")
        .select("id, organization_id")
        .in("id", templateIds),
      preferredWorkerIds.length > 0
        ? this.supabase
            .from("render_workers")
            .select("id, organization_id, status")
            .in("id", preferredWorkerIds)
        : Promise.resolve({ data: [] }),
    ]);

    const componentsById = new Map((components || []).map((component: any) => [component.id, component]));
    const templatesById = new Map((templates || []).map((template: any) => [template.id, template]));
    const workersById = new Map((workers || []).map((worker: any) => [worker.id, worker]));

    for (const item of request.items) {
      const component = componentsById.get(item.componentId);
      if (!component) throw new Error(`COMPONENT_NOT_FOUND: ${item.componentId}`);
      const lesson = firstRelation(component.material_lessons);
      const material = firstRelation(lesson?.materials);
      if (material?.artifact_id !== request.artifactId) {
        throw new Error(`COMPONENT_FORBIDDEN_FOR_BATCH: ${item.componentId}`);
      }
      if (!hasRenderableAssets(component)) {
        throw new Error(`COMPONENT_NOT_RENDERABLE: ${getComponentLabel(component)}`);
      }

      const template = templatesById.get(item.templateId || request.defaultTemplateId);
      if (!template) throw new Error(`TEMPLATE_NOT_FOUND: ${item.templateId || request.defaultTemplateId}`);
      if (template.organization_id && !context.organizationIds.includes(template.organization_id)) {
        throw new Error(`FORBIDDEN_TEMPLATE_ORGANIZATION: ${template.id}`);
      }

      if (item.preferredWorkerId) {
        const worker = workersById.get(item.preferredWorkerId);
        if (!worker || worker.organization_id !== artifact.organization_id || worker.status === "REVOKED") {
          throw new Error(`WORKER_NOT_AVAILABLE_FOR_BATCH: ${item.preferredWorkerId}`);
        }
      }
    }

    const now = new Date().toISOString();
    const { data: batch, error: batchError } = await this.supabase
      .from("production_render_batches")
      .insert({
        organization_id: artifact.organization_id,
        artifact_id: request.artifactId,
        created_by: context.userId,
        status: "QUEUED",
        assignment_mode: request.assignmentMode,
        default_template_id: request.defaultTemplateId,
        total_items: request.items.length,
        metadata: {
          requestedItems: request.items.length,
          createdVia: "postproduction_assembly",
        },
      })
      .select("*")
      .single();

    if (batchError || !batch) throw new Error(`BATCH_CREATE_FAILED: ${batchError?.message || "Unknown error"}`);

    const itemRows: any[] = [];
    const startedJobs: RenderBatchItemStatusView[] = [];

    for (const item of request.items) {
      const component = componentsById.get(item.componentId);
      const templateId = item.templateId || request.defaultTemplateId;
      const preferredWorkerId = item.preferredWorkerId || null;
      const variables = {
        ...item.variables,
        renderBatchId: batch.id,
        componentTitle: getComponentLabel(component),
      };

      const jobResult = await this.controlPlane.createDesktopRenderJob({
        componentId: item.componentId,
        templateId,
        variables,
        userId: context.userId,
        organizationIds: context.organizationIds,
        renderBatchId: batch.id,
        preferredWorkerId,
        assignedStrategy: preferredWorkerId ? "MANUAL" : "AUTO",
      });

      itemRows.push({
        batch_id: batch.id,
        organization_id: artifact.organization_id,
        artifact_id: request.artifactId,
        material_component_id: item.componentId,
        template_id: templateId,
        preferred_worker_id: preferredWorkerId,
        production_job_id: jobResult.jobId,
        status: jobResult.status || "WAITING_PROVIDER",
        variables,
        updated_at: now,
      });

      startedJobs.push({
        componentId: item.componentId,
        jobId: jobResult.jobId,
        label: getComponentLabel(component),
        status: jobResult.status || "WAITING_PROVIDER",
        progress: 5,
        templateId,
        preferredWorkerId,
      });
    }

    const { error: itemsError } = await this.supabase
      .from("production_render_batch_items")
      .upsert(itemRows, { onConflict: "batch_id,material_component_id" });

    if (itemsError) throw new Error(`BATCH_ITEMS_CREATE_FAILED: ${itemsError.message}`);

    await this.supabase
      .from("production_render_batches")
      .update({ status: "RUNNING", updated_at: now })
      .eq("id", batch.id);

    return {
      batchId: batch.id as string,
      status: "RUNNING",
      items: startedJobs,
    };
  }

  async getBatchStatus(batchId: string, organizationIds: string[]): Promise<RenderBatchStatusView> {
    const { data: batch, error } = await this.supabase
      .from("production_render_batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();

    if (error || !batch) throw new Error("BATCH_NOT_FOUND");
    if (!organizationIds.includes(batch.organization_id)) throw new Error("FORBIDDEN_BATCH_ORGANIZATION");

    const { data: rows } = await this.supabase
      .from("production_render_batch_items")
      .select(`
        id, material_component_id, template_id, preferred_worker_id, status, error_sanitized,
        production_jobs (
          id, status, progress, output_snapshot, provider_error, worker_id
        ),
        material_components (
          content,
          material_lessons ( lesson_title )
        )
      `)
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });

    const items = (rows || []).map((row: any): RenderBatchItemStatusView => {
      const job = firstRelation(row.production_jobs);
      const component = firstRelation(row.material_components);
      const lesson = firstRelation(component?.material_lessons);
      const providerError = job?.provider_error || {};

      return {
        componentId: row.material_component_id,
        jobId: job?.id || null,
        label: lesson?.lesson_title || component?.content?.title || "Video",
        status: job?.status || row.status,
        progress: getProgressPercent(job?.progress),
        finalVideoUrl: job?.output_snapshot?.final_video_url,
        error: row.error_sanitized || providerError.message,
        errorCode: providerError.code,
        lastLog: getLastLog(job?.progress),
        templateId: row.template_id,
        preferredWorkerId: row.preferred_worker_id,
        workerId: job?.worker_id || null,
      };
    });

    return {
      id: batch.id,
      status: batch.status,
      assignmentMode: batch.assignment_mode,
      totalItems: batch.total_items,
      completedItems: batch.completed_items,
      failedItems: batch.failed_items,
      items,
    };
  }
}
