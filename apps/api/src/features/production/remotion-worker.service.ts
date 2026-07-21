import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import {
  buildAssemblyInputProps,
  resolveInternalCompositionId,
  type AssemblyInputProps,
} from './remotion-assembly-props.service';
import { createNodeSupabaseClient } from '../../core/supabase-client';
import { mergeTemplateRenderConfigs } from './template-render-config.service';
import { buildStableHash, resolveLocalRenderTimeoutMs } from './remotion-render.config';
import {
  buildRenderDiagnosticsSnapshot,
  classifyRemotionFailure,
} from './remotion-render-diagnostics.service';

let cachedBundlePromise: Promise<string> | null = null;

export const SHARED_BUNDLE_DIR = path.join(os.tmpdir(), 'courseforge-remotion-bundle');

type RenderMode =
  | 'INTERNAL_COMPOSITION';

export class RemotionWorkerService {
  private supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  private supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  constructor() {
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      console.warn('[RemotionWorker] Supabase URL or Service Key is missing in environment variables.');
    }
  }

  private getSupabaseClient() {
    return createNodeSupabaseClient(this.supabaseUrl, this.supabaseServiceKey);
  }

  public async runRenderJob(jobId: string, serveUrlOverride?: string): Promise<void> {
    const supabase = this.getSupabaseClient();
    console.log(`[RemotionWorker] Starting render job: ${jobId}`);

    const { data: job, error: jobError } = await supabase
      .from('production_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`[RemotionWorker] Error fetching job ${jobId}:`, jobError);
      return;
    }

    if (job.status !== 'PENDING' && job.status !== 'QUEUED') {
      console.log(`[RemotionWorker] Job ${jobId} is already in state: ${job.status}. Skipping.`);
      return;
    }

    await this.updateProgress(supabase, jobId, 0, 'Inicializando render', {
      status: 'RUNNING',
      started_at: new Date().toISOString(),
    });

    const componentId = job.material_component_id;
    const templateId = job.input_snapshot?.templateId;
    const outputDir = path.join(os.tmpdir(), `remotion-out-${jobId}`);
    let outputPath = path.join(outputDir, 'output.mp4');
    let assets: any = {};
    let renderMode: RenderMode = 'INTERNAL_COMPOSITION';
    let templateVersionId: string | null = job.input_snapshot?.templateVersionId || null;
    let bundleHash: string | null = job.input_snapshot?.bundleHash || null;
    let buildHash: string | null = job.input_snapshot?.buildHash || null;
    let propsHash: string | null = null;

    try {
      const { data: component, error: compError } = await supabase
        .from('material_components')
        .select('*')
        .eq('id', componentId)
        .single();

      if (compError || !component) {
        throw new Error(`Componente no encontrado: ${compError?.message || 'Error desconocido'}`);
      }

      const { data: template, error: tplError } = await supabase
        .from('remotion_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (tplError || !template) {
        throw new Error(`Plantilla no encontrada: ${tplError?.message || 'Error desconocido'}`);
      }

      assets = component.assets || {};
      const internalCompositionId = resolveInternalCompositionId(template.composition_id);
      const templateConfig = mergeTemplateRenderConfigs(
        template.default_config,
        job.input_snapshot?.variables?.templateConfig,
      );
      const inputProps = buildAssemblyInputProps({
        assets,
        compositionId: internalCompositionId,
        transitionType: job.input_snapshot?.variables?.transitionType,
        templateConfig,
        layoutOverrides: job.input_snapshot?.variables?.layoutOverrides,
      });
      propsHash = buildStableHash(inputProps);
      const timeoutInMilliseconds = resolveLocalRenderTimeoutMs();
      const renderDiagnostics = buildRenderDiagnosticsSnapshot({
        renderProvider: 'local',
        renderMode,
        inputProps,
        rawAssets: assets,
        templateId,
        templateVersionId,
        bundleHash,
        buildHash,
        compositionId: internalCompositionId,
        propsHash,
        timeoutInMilliseconds,
      });

      await this.updateJobInputSnapshot(supabase, jobId, job.input_snapshot, {
        renderProvider: 'local',
        renderMode,
        compositionId: internalCompositionId,
        propsHash,
        renderDiagnostics,
      });

      console.log('[RemotionWorker] Render configuration resolved.', {
        jobId,
        templateId,
        rawTemplateCompositionId: template.composition_id,
        internalCompositionId,
        inputPropsTemplate: inputProps.template,
        slidesCount: inputProps.slides.length,
        brollClipsCount: inputProps.brollClips.length,
        hasAvatarVideo: Boolean(inputProps.avatarVideoUrl),
        hasVoiceAudio: Boolean(inputProps.voiceAudioUrl),
        totalDurationInFrames: inputProps.totalDurationInFrames,
        fps: inputProps.fps,
      });

      console.log('[RemotionWorker] Rendering internal composition. External ZIP bundles require a render-ready cloud build.', {
        jobId,
        templateId,
        rawTemplateCompositionId: template.composition_id,
        internalCompositionId,
      });

      await this.renderInternalComposition({
        supabase,
        jobId,
        outputDir,
        outputPath,
        serveUrlOverride,
        compositionId: internalCompositionId,
        inputProps,
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error('El renderizador de Remotion no genero el video output.mp4');
      }

      await this.updateProgress(supabase, jobId, 92, 'Guardando video en almacenamiento');
      const fileBuffer = await fsp.readFile(outputPath);
      const outputStoragePath = `completed/${componentId}.mp4`;

      const { error: uploadError } = await supabase.storage
        .from('production-videos')
        .upload(outputStoragePath, fileBuffer, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('production-videos').getPublicUrl(outputStoragePath);

      const updatedAssets = {
        ...assets,
        final_video_url: publicUrl,
        final_video_source: 'upload',
        final_video_layout_stale: false,
        video_duration: Math.round(inputProps.totalDurationInFrames / inputProps.fps),
        production_status: 'COMPLETED',
        updated_at: new Date().toISOString(),
      };

      const { error: dbUpdateError } = await supabase
        .from('material_components')
        .update({ assets: updatedAssets })
        .eq('id', componentId);

      if (dbUpdateError) {
        throw dbUpdateError;
      }

      await this.syncFinalVideoToPublicationRequest(supabase, {
        artifactId: job.artifact_id || null,
        materialLessonId: job.material_lesson_id || null,
        lessonId: job.lesson_id || null,
        finalVideoUrl: publicUrl,
        duration: Math.round(inputProps.totalDurationInFrames / inputProps.fps),
      });

      await supabase
        .from('production_jobs')
        .update({
          status: 'SUCCEEDED',
          progress: [{ percent: 100, message: 'Ensamblado completado exitosamente', timestamp: new Date().toISOString() }],
          completed_at: new Date().toISOString(),
          output_snapshot: {
            final_video_url: publicUrl,
            completed: true,
            renderMode,
            templateVersionId,
            bundleHash,
            buildHash,
            propsHash,
          },
        })
        .eq('id', jobId);

      console.log(`[RemotionWorker] Job ${jobId} completed successfully!`, {
        renderMode,
        templateId,
        templateVersionId,
        bundleHash,
      });
    } catch (err: any) {
      const safeError = this.sanitizeError(err);
      console.error(`[RemotionWorker] Job ${jobId} failed:`, safeError);

      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: {
            code: classifyRemotionFailure(safeError, { provider: 'local', stage: 'render' }),
            message: safeError,
            renderProvider: 'local',
            renderMode,
            templateVersionId,
            bundleHash,
            buildHash,
            propsHash,
          },
        })
        .eq('id', jobId);

      await supabase
        .from('material_components')
        .update({
          assets: { ...assets, production_status: 'FAILED', updated_at: new Date().toISOString() },
        })
        .eq('id', componentId);
    } finally {
      if (fs.existsSync(outputDir)) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
        } catch (cleanError) {
          console.error('[RemotionWorker] Error deleting output directory:', cleanError);
        }
      }
    }
  }

  public async prewarmBundle(): Promise<string | null> {
    try {
      const serveUrl = await this.getBundle(SHARED_BUNDLE_DIR);
      console.log('[RemotionWorker] Bundle de Remotion pre-calentado en:', serveUrl);
      return serveUrl;
    } catch (err) {
      console.warn('[RemotionWorker] No se pudo pre-calentar el bundle (se bundleara en el primer render):', err);
      return null;
    }
  }

  private async renderInternalComposition(params: {
    supabase: any;
    jobId: string;
    outputDir: string;
    outputPath: string;
    serveUrlOverride?: string;
    compositionId: string;
    inputProps: AssemblyInputProps;
  }): Promise<void> {
    const { supabase, jobId, outputDir, outputPath, serveUrlOverride, compositionId, inputProps } = params;

    await this.updateProgress(supabase, jobId, 10, 'Preparando motor de render');
    await ensureBrowser();

    await this.updateProgress(
      supabase,
      jobId,
      20,
      serveUrlOverride ? 'Reutilizando plantillas compiladas' : 'Compilando plantillas de video',
    );
    const serveUrl = serveUrlOverride || (await this.getBundle());

    await this.updateProgress(supabase, jobId, 35, 'Resolviendo composicion');
    const timeoutInMilliseconds = resolveLocalRenderTimeoutMs();
    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps: inputProps as unknown as Record<string, unknown>,
      timeoutInMilliseconds,
    });
    console.log('[RemotionWorker] Internal composition selected.', {
      jobId,
      compositionId,
      timeoutInMilliseconds,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
    });

    fs.mkdirSync(outputDir, { recursive: true });
    let lastReportedPercent = 40;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: inputProps as unknown as Record<string, unknown>,
      timeoutInMilliseconds,
      onProgress: ({ progress }) => {
        const overall = Math.round(40 + progress * 50);
        if (overall > lastReportedPercent) {
          lastReportedPercent = overall;
          this.updateProgress(
            supabase,
            jobId,
            overall,
            `Renderizando fotogramas (${Math.round(progress * 100)}%)`,
          ).catch((err) => {
            console.warn(`[RemotionWorker] No se pudo actualizar progreso del job ${jobId}:`, err);
          });
        }
      },
    });
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || 'Error desconocido');
    return message
      .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
      .replace(/OPENAI_API_KEY=[^\s]+/gi, 'OPENAI_API_KEY=[redacted]')
      .replace(/GOOGLE_GENERATIVE_AI_API_KEY=[^\s]+/gi, 'GOOGLE_GENERATIVE_AI_API_KEY=[redacted]')
      .slice(0, 1000);
  }

  private getBundle(outDir?: string): Promise<string> {
    if (!cachedBundlePromise) {
      const entryPoint = this.resolveEntryPoint();
      const targetDir = outDir || path.join(os.tmpdir(), `courseforge-remotion-bundle-${process.pid}`);
      console.log(`[RemotionWorker] Bundling Remotion entry: ${entryPoint} -> ${targetDir}`);
      cachedBundlePromise = bundle({ entryPoint, outDir: targetDir }).catch((err) => {
        cachedBundlePromise = null;
        throw err;
      });
    }
    return cachedBundlePromise;
  }

  private resolveEntryPoint(): string {
    const fromEnv = process.env.REMOTION_ENTRY_POINT;
    const entryPoint = fromEnv
      ? path.resolve(fromEnv)
      : path.resolve(process.cwd(), '../web/src/remotion/index.ts');

    if (!fs.existsSync(entryPoint)) {
      throw new Error(
        `No se encontro el entry de Remotion en "${entryPoint}". ` +
          'Configura REMOTION_ENTRY_POINT con la ruta a apps/web/src/remotion/index.ts.',
      );
    }
    return entryPoint;
  }

  private async syncFinalVideoToPublicationRequest(
    supabase: any,
    params: {
      artifactId: string | null;
      materialLessonId: string | null;
      lessonId: string | null;
      finalVideoUrl: string;
      duration: number;
    },
  ): Promise<void> {
    if (!params.artifactId || !params.lessonId || !params.finalVideoUrl) return;

    let lessonTitle = params.lessonId;
    let moduleTitle = '';

    if (params.materialLessonId) {
      const { data: lesson } = await supabase
        .from('material_lessons')
        .select('lesson_id, lesson_title, module_title')
        .eq('id', params.materialLessonId)
        .maybeSingle();

      lessonTitle = lesson?.lesson_title || lessonTitle;
      moduleTitle = lesson?.module_title || '';
    }

    const { data: existingRequest } = await supabase
      .from('publication_requests')
      .select('id, lesson_videos')
      .eq('artifact_id', params.artifactId)
      .maybeSingle();

    const currentLessonVideos =
      (existingRequest?.lesson_videos as Record<string, unknown> | null) || {};
    const nextLessonVideos = {
      ...currentLessonVideos,
      [params.lessonId]: {
        lesson_id: params.lessonId,
        lesson_title: lessonTitle,
        module_title: moduleTitle,
        video_provider: 'direct',
        video_id: params.finalVideoUrl,
        duration: params.duration,
      },
    };

    if (existingRequest?.id) {
      await supabase
        .from('publication_requests')
        .update({
          lesson_videos: nextLessonVideos,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRequest.id);
      return;
    }

    await supabase
      .from('publication_requests')
      .insert({
        artifact_id: params.artifactId,
        lesson_videos: nextLessonVideos,
        status: 'DRAFT',
        updated_at: new Date().toISOString(),
      });
  }

  private async updateProgress(
    supabase: any,
    jobId: string,
    percent: number,
    message: string,
    extraFields: Record<string, unknown> = {},
  ): Promise<void> {
    await supabase
      .from('production_jobs')
      .update({
        progress: [{ percent, message, timestamp: new Date().toISOString() }],
        ...extraFields,
      })
      .eq('id', jobId);
  }

  private async updateJobInputSnapshot(
    supabase: any,
    jobId: string,
    currentInputSnapshot: unknown,
    updates: Record<string, unknown>,
  ): Promise<void> {
    const inputSnapshot =
      currentInputSnapshot && typeof currentInputSnapshot === 'object' && !Array.isArray(currentInputSnapshot)
        ? { ...(currentInputSnapshot as Record<string, unknown>) }
        : {};

    await supabase
      .from('production_jobs')
      .update({
        input_snapshot: {
          ...inputSnapshot,
          ...updates,
        },
      })
      .eq('id', jobId);
  }
}
