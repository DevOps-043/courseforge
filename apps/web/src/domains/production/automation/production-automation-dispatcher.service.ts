import { getErrorMessage } from "@/lib/errors";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import type { AvatarClip, MaterialAssets } from "@/domains/materials/types/materials.types";
import { getHeygenClientForOrganization } from "../providers/heygen/heygen-credential-resolver.service";
import { HeygenScenesService } from "../providers/heygen/heygen-scenes.service";
import { HeygenVideoService } from "../providers/heygen/heygen-video.service";
import type { ProductionAssetRequirement } from "./production-automation.types";
import type {
  ProductionAvatarConfiguration,
  ProductionRunConfiguration,
  ProductionRunItemConfiguration,
} from "./production-automation.types";
import type { SupabaseClient } from "@supabase/supabase-js";

type DispatchableItem = {
  configuration: ProductionRunItemConfiguration | null;
  dispatch_attempts: number;
  id: string;
  material_component_id: string;
  requirements: ProductionAssetRequirement[] | null;
};

type ComponentRow = {
  assets: MaterialAssets | null;
  content: unknown;
  id: string;
  type: string;
};

/**
 * Dispatches source-asset jobs only. It deliberately never creates a
 * composition, initialises the editor, or submits a HyperFrames render.
 */
export class ProductionAutomationDispatcher {
  constructor(private readonly supabase: SupabaseClient<any, "public", any>) {}

  async dispatchRun(params: { organizationId: string; runId: string }) {
    const { data: run, error: runError } = await this.supabase
      .from("production_runs")
      .select("id, created_by, status, configuration")
      .eq("id", params.runId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) throw new Error("Ejecucion de produccion no encontrada.");
    if (run.status === "CANCELLED") return { dispatched: 0, skipped: 0 };
    if ((run.configuration as { approval_state?: unknown } | null)?.approval_state !== "APPROVED") {
      throw new Error("La configuracion de produccion debe aprobarse antes de enviar assets.");
    }

    const { data: items, error: itemsError } = await this.supabase
      .from("production_run_items")
      .select("id, material_component_id, requirements, configuration, dispatch_attempts")
      .eq("production_run_id", params.runId)
      .eq("organization_id", params.organizationId)
      .in("status", ["PLANNED", "FAILED_RETRYABLE"])
      .order("module_order", { ascending: true })
      .order("lesson_order", { ascending: true });
    if (itemsError) throw itemsError;

    let dispatched = 0;
    let skipped = 0;
    for (const item of (items || []) as DispatchableItem[]) {
      const requirements = Array.isArray(item.requirements) ? item.requirements : [];
      // Drafts created before the requirement-inference repair are still video
      // production items, so treat an empty list as an avatar/voice job.
      const requiresAvatar = requirements.length === 0 || requirements.some((requirement) => requirement.kind === "AVATAR_AND_VOICE");
      const requiresSlides = requirements.some((requirement) => requirement.kind === "SLIDES");
      const defaults = resolveItemConfiguration(run.configuration);
      const itemConfiguration: ProductionRunItemConfiguration = {
        ...defaults,
        ...item.configuration,
      };
      if (!requiresAvatar && !requiresSlides) {
        await this.markUnsupported(item.id, "Este componente requiere una automatizacion de slides, B-roll o screencast que aun no ha sido conectada al despachador.");
        skipped += 1;
        continue;
      }

      const configuredAvatar = itemConfiguration.avatar;
      const configuredSlides = itemConfiguration.slides;
      if (!requiresAvatar) {
        if (!configuredSlides) {
          await this.markUnsupported(item.id, "Selecciona y aprueba una plantilla de diapositivas antes de despachar este componente.");
          skipped += 1;
          continue;
        }
        try {
          await this.dispatchSlides({ componentId: item.material_component_id, configuration: configuredSlides, createdBy: run.created_by || "", organizationId: params.organizationId });
          await this.markWaitingProvider(item);
          dispatched += 1;
        } catch (error) { await this.markDispatchFailed(item, error); }
        continue;
      }
      if (configuredAvatar?.generationMode === "single_video" && isConfiguredAvatar(configuredAvatar)) {
        try {
          await this.dispatchAvatarVideo({
            avatar: configuredAvatar,
            componentId: item.material_component_id,
            createdBy: run.created_by || "",
            organizationId: params.organizationId,
          });
          if (requiresSlides && configuredSlides) {
            await this.dispatchSlides({ componentId: item.material_component_id, configuration: configuredSlides, createdBy: run.created_by || "", organizationId: params.organizationId });
          }
          await this.markWaitingProvider(item);
          dispatched += 1;
        } catch (error) {
          await this.markDispatchFailed(item, error);
        }
        continue;
      }

      if (!isConfiguredSceneAvatar(configuredAvatar)) {
        await this.markUnsupported(
          item.id,
          "Selecciona y aprueba avatar, voz y modo de generacion antes de despachar este componente.",
        );
        skipped += 1;
        continue;
      }

      try {
        await this.dispatchAvatarScenes({
          avatar: configuredAvatar,
          componentId: item.material_component_id,
          createdBy: run.created_by || "",
          organizationId: params.organizationId,
        });
        if (requiresSlides && configuredSlides) {
          await this.dispatchSlides({ componentId: item.material_component_id, configuration: configuredSlides, createdBy: run.created_by || "", organizationId: params.organizationId });
        }
        await this.markWaitingProvider(item);
        dispatched += 1;
      } catch (error) {
        await this.markDispatchFailed(item, error);
      }
    }

    await this.supabase
      .from("production_runs")
      .update({ status: dispatched > 0 ? "GENERATING" : "NEEDS_ATTENTION", updated_at: new Date().toISOString() })
      .eq("id", params.runId)
      .eq("organization_id", params.organizationId);
    return { dispatched, skipped };
  }

  private async dispatchAvatarScenes(params: {
    avatar: ProductionAvatarConfiguration;
    componentId: string;
    createdBy: string;
    organizationId: string;
  }) {
    if (!params.createdBy) throw new Error("La ejecucion no tiene un usuario creador para registrar los jobs.");
    const { data, error } = await this.supabase
      .from("material_components")
      .select("id, assets, content")
      .eq("id", params.componentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Componente de video no encontrado.");
    const component = data as ComponentRow;
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: this.supabase,
    });
    const service = new HeygenScenesService(this.supabase, auth.client);
    const clips = service.buildSceneClips({
      componentContent: component.content,
      existingClips: component.assets?.avatar_clips,
    });
    const configuredClips = clips.map((clip) => ({
      ...clip,
      // A reviewed clip-level correction wins over the course/lesson profile.
      // Both values are explicit; no provider default is allowed here.
      avatar_preset_id: clip.expected_media_mode === "avatar"
        ? clip.avatar_preset_id || params.avatar.avatarPresetId
        : clip.avatar_preset_id,
      voice_preset_id: clip.voice_preset_id || params.avatar.voicePresetId,
    }));
    const activeClips = configuredClips.filter((clip) => !clip.deleted);
    const unconfiguredClips = activeClips.filter((clip) => !clip.expected_media_mode);
    if (unconfiguredClips.length > 0) {
      throw new Error(
        `Define el medio esperado de las escenas ${unconfiguredClips.map((clip) => clip.order).join(", ")} antes de ejecutar la automatización.`,
      );
    }

    const voiceByClipId = new Map(
      (component.assets?.voice_clips || []).map((voiceClip) => [voiceClip.clip_id, voiceClip]),
    );
    const hasCurrentVoice = (clip: (typeof activeClips)[number]) => {
      const voiceClip = voiceByClipId.get(clip.id);
      return voiceClip?.status === "COMPLETED"
        && Boolean(voiceClip.public_url)
        && (!clip.script_hash || voiceClip.script_hash === clip.script_hash);
    };
    const voiceOnlyClips = activeClips.filter(
      (clip) => (
        clip.expected_media_mode === "voice_only"
        || (clip.expected_media_mode === "avatar" && clip.status === "COMPLETED")
      ) && !hasCurrentVoice(clip),
    );
    const avatarClips = activeClips.filter(
      (clip) => clip.expected_media_mode === "avatar" && clip.status !== "COMPLETED",
    );

    let workingClips: AvatarClip[] = configuredClips;
    for (const batch of [
      { clips: voiceOnlyClips, generationTarget: "voice_only" as const },
      { clips: avatarClips, generationTarget: "avatar" as const },
    ]) {
      if (batch.clips.length === 0) continue;
      const clipIds = batch.clips.map((clip) => clip.id);
      const queued = await service.queueSceneClips({
        clipIds,
        clips: workingClips,
        componentId: component.id,
        generationTarget: batch.generationTarget,
        organizationId: params.organizationId,
      });
      const generated = await service.generateSceneClips({
        createdBy: params.createdBy,
        options: {
          aspectRatio: params.avatar.aspectRatio,
          caption: params.avatar.caption,
          clipIds,
          clips: queued.clips,
          componentId: component.id,
          engine: params.avatar.engine,
          generationTarget: batch.generationTarget,
          outputFormat: params.avatar.outputFormat,
          requestOrigin: "production_automation",
          resolution: params.avatar.resolution,
          speed: 1,
        },
        organizationId: params.organizationId,
      });
      workingClips = generated.clips;
    }
  }

  private async dispatchAvatarVideo(params: {
    avatar: ProductionAvatarConfiguration;
    componentId: string;
    createdBy: string;
    organizationId: string;
  }) {
    if (!params.createdBy) throw new Error("La ejecucion no tiene un usuario creador para registrar los jobs.");
    const { data, error } = await this.supabase
      .from("material_components")
      .select("id, assets, content, type")
      .eq("id", params.componentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Componente de video no encontrado.");
    const component = data as ComponentRow;
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      organizationId: params.organizationId,
      supabase: this.supabase,
    });
    await new HeygenVideoService(this.supabase, auth.client).createAvatarVideoForComponent({
      componentContent: component.content,
      componentType: component.type,
      createdBy: params.createdBy,
      options: {
        aspectRatio: params.avatar.aspectRatio,
        autoPromote: true,
        avatarPresetId: params.avatar.avatarPresetId,
        caption: params.avatar.caption,
        componentId: component.id,
        engine: params.avatar.engine,
        outputFormat: params.avatar.outputFormat,
        resolution: params.avatar.resolution,
        voicePresetId: params.avatar.voicePresetId,
      },
      organizationId: params.organizationId,
    });
  }

  private async dispatchSlides(params: {
    componentId: string;
    configuration: NonNullable<ProductionRunItemConfiguration["slides"]>;
    createdBy: string;
    organizationId: string;
  }) {
    if (!params.createdBy) throw new Error("La ejecucion no tiene un usuario creador para registrar los jobs.");
    const { POST } = await import("@/app/api/production/slides/generate/route");
    const response = await POST(new Request("http://production-automation.local/api/production/slides/generate", {
      body: JSON.stringify({
        appearance: params.configuration.appearance,
        componentId: params.componentId,
        generateVisuals: params.configuration.generateVisuals,
        locale: params.configuration.locale,
        slideTemplateRunId: params.configuration.slideTemplateRunId,
        template: params.configuration.template,
      }),
      headers: {
        "Content-Type": "application/json",
        "x-production-automation": JSON.stringify(signBackgroundPayload({
          componentId: params.componentId,
          createdBy: params.createdBy,
          organizationId: params.organizationId,
        })),
      },
      method: "POST",
    }));
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(typeof payload.error === "string" ? payload.error : "No se pudieron generar las diapositivas.");
    }
  }

  private async markWaitingProvider(item: DispatchableItem) {
    const { error } = await this.supabase
      .from("production_run_items")
      .update({
        dispatch_attempts: item.dispatch_attempts + 1,
        dispatched_at: new Date().toISOString(),
        last_error: null,
        status: "WAITING_PROVIDER",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (error) throw error;
  }

  private async markDispatchFailed(item: DispatchableItem, error: unknown) {
    const message = getErrorMessage(error, "No se pudieron enviar los assets de avatar.");
    const { error: updateError } = await this.supabase
      .from("production_run_items")
      .update({
        dispatch_attempts: item.dispatch_attempts + 1,
        last_error: { message, source: "production_automation_dispatch" },
        status: "FAILED_RETRYABLE",
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    if (updateError) throw updateError;
  }

  private async markUnsupported(itemId: string, message: string) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_run_items")
      .update({
        last_error: { code: "AUTOMATION_NOT_IMPLEMENTED", message },
        status: "FAILED_RETRYABLE",
        updated_at: now,
      })
      .eq("id", itemId);
    if (error) throw error;
  }
}

type SceneAvatarConfiguration = ProductionAvatarConfiguration & { generationMode: "scene_clips" };

function isConfiguredSceneAvatar(value: ProductionAvatarConfiguration | undefined): value is SceneAvatarConfiguration {
  return Boolean(
    value
    && value.generationMode === "scene_clips"
    && value.avatarPresetId
    && value.aspectRatio
    && value.engine
    && value.outputFormat
    && value.resolution,
  );
}

function isConfiguredAvatar(value: ProductionAvatarConfiguration | undefined): value is ProductionAvatarConfiguration {
  return Boolean(value && value.avatarPresetId && value.voicePresetId && value.aspectRatio && value.engine && value.outputFormat && value.resolution);
}

function resolveItemConfiguration(configuration: unknown): ProductionRunItemConfiguration {
  const run = configuration as ProductionRunConfiguration | null;
  return run?.defaults || {};
}
