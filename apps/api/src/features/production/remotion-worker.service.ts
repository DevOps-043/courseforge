import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { createClient } from '@supabase/supabase-js';
import { ExternalTemplateSandboxRunner } from './external-template-sandbox-runner.service';
import {
  buildAssemblyInputProps,
  resolveExternalCompositionId,
  resolveInternalCompositionId,
  type AssemblyInputProps,
} from './remotion-assembly-props.service';
import { buildResolvedProps } from './resolved-props.service';
import { SandboxBuildService } from './sandbox-build.service';
import { mergeTemplateRenderConfigs } from './template-render-config.service';

let cachedBundlePromise: Promise<string> | null = null;

export const SHARED_BUNDLE_DIR = path.join(os.tmpdir(), 'courseforge-remotion-bundle');
const DEFAULT_RENDER_TIMEOUT_MS = 180 * 1000;

type RenderMode =
  | 'INTERNAL_COMPOSITION'
  | 'EXTERNAL_SANDBOX'
  | 'EXTERNAL_SANDBOX_FALLBACK_INTERNAL';

interface ApprovedSandboxVersion {
  id: string;
  organization_id?: string | null;
  bundle_hash: string | null;
  build_hash?: string | null;
  entry_point: string | null;
  storage_path: string;
  template_type?: 'simple' | 'custom_bundle' | null;
  export_mode?: 'component' | 'root' | null;
  composition_id?: string | null;
  default_props?: Record<string, unknown> | null;
  default_duration_frames?: number | null;
  default_fps?: number | null;
  default_width?: number | null;
  default_height?: number | null;
}

interface ResolvedSandboxBuild {
  buildId: string | null;
  serveUrl: string;
  buildHash: string | null;
  compositionId: string;
  exportMode: 'component' | 'root';
  cacheHit: boolean;
}

export class RemotionWorkerService {
  private supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  private supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  constructor() {
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      console.warn('[RemotionWorker] Supabase URL or Service Key is missing in environment variables.');
    }
  }

  private getSupabaseClient() {
    return createClient(this.supabaseUrl, this.supabaseServiceKey);
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
      });
      const sandboxVersion = await this.getApprovedSandboxVersion(supabase, template.id);
      const sandboxCompositionId = sandboxVersion
        ? resolveExternalCompositionId(
            sandboxVersion.composition_id || template.composition_id,
            internalCompositionId,
          )
        : internalCompositionId;

      console.log('[RemotionWorker] Render configuration resolved.', {
        jobId,
        templateId,
        rawTemplateCompositionId: template.composition_id,
        internalCompositionId,
        sandboxCompositionId,
        inputPropsTemplate: inputProps.template,
        slidesCount: inputProps.slides.length,
        brollClipsCount: inputProps.brollClips.length,
        hasAvatarVideo: Boolean(inputProps.avatarVideoUrl),
        hasVoiceAudio: Boolean(inputProps.voiceAudioUrl),
        totalDurationInFrames: inputProps.totalDurationInFrames,
        fps: inputProps.fps,
      });

      const sandboxRunner = new ExternalTemplateSandboxRunner();
      const sandboxEnabled = sandboxRunner.isEnabled();

      console.log('[RemotionWorker] External sandbox decision.', {
        jobId,
        templateId,
        sandboxEnabled,
        hasApprovedSandboxVersion: Boolean(sandboxVersion),
        sandboxVersionId: sandboxVersion?.id || null,
        sandboxBundleHash: sandboxVersion?.bundle_hash || null,
        sandboxEntryPoint: sandboxVersion?.entry_point || template.entry_point || 'src/index.tsx',
        sandboxCommandConfigured: Boolean(process.env.EXTERNAL_TEMPLATE_SANDBOX_COMMAND),
        fallbackInternal: process.env.EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL === 'true',
      });

      if (sandboxVersion && sandboxEnabled) {
        templateVersionId = sandboxVersion.id;
        bundleHash = sandboxVersion.bundle_hash;
        await this.updateProgress(supabase, jobId, 15, 'Enviando render a sandbox externo');
        const resolvedBuild = await this.getOrCreateSandboxBuild(supabase, {
          sandboxVersion,
          fallbackCompositionId: sandboxCompositionId,
          organizationId: sandboxVersion.organization_id || job.organization_id,
        });
        buildHash = resolvedBuild.buildHash;
        const usesResolvedProps = sandboxVersion.template_type !== 'simple';
        const resolvedPropsResult = usesResolvedProps
          ? buildResolvedProps({
              bundleDefaultProps: sandboxVersion.default_props,
              courseProps: inputProps as unknown as Record<string, unknown>,
              userOverrides: this.extractExternalTemplateOverrides(job.input_snapshot?.variables),
            })
          : null;
        const sandboxInputProps = resolvedPropsResult?.resolvedProps ?? inputProps;
        propsHash = resolvedPropsResult?.propsHash ?? null;

        if (resolvedPropsResult) {
          await this.updateJobInputSnapshot(supabase, jobId, job.input_snapshot, {
            templateVersionId,
            bundleHash,
            buildHash,
            compositionId: resolvedBuild.compositionId,
            exportMode: resolvedBuild.exportMode,
            propsHash,
            resolvedProps: sandboxInputProps,
          });
        }

        console.log('[RemotionWorker] Sandbox build resolved.', {
          jobId,
          templateId,
          templateVersionId,
          bundleHash,
          buildId: resolvedBuild.buildId,
          buildHash,
          serveUrl: resolvedBuild.serveUrl,
          sandboxCompositionId: resolvedBuild.compositionId,
          buildCacheHit: resolvedBuild.cacheHit,
          propsMode: usesResolvedProps ? 'resolved' : 'assembly',
          propsHash,
        });

        const sandboxResult = await sandboxRunner.render({
          jobId,
          templateVersionId: sandboxVersion.id,
          bundleHash: sandboxVersion.bundle_hash || '',
          serveUrl: resolvedBuild.serveUrl,
          compositionId: resolvedBuild.compositionId,
          exportMode: resolvedBuild.exportMode,
          defaultDurationInFrames: sandboxVersion.default_duration_frames || undefined,
          defaultFps: sandboxVersion.default_fps || undefined,
          defaultWidth: sandboxVersion.default_width || undefined,
          defaultHeight: sandboxVersion.default_height || undefined,
          propsMode: usesResolvedProps ? 'resolved' : 'assembly',
          inputProps: sandboxInputProps,
          assetAllowlist: this.collectAssetUrls(sandboxInputProps),
        });

        if (sandboxResult.success && sandboxResult.outputPath) {
          renderMode = 'EXTERNAL_SANDBOX';
          outputPath = sandboxResult.outputPath;
          console.log('[RemotionWorker] Sandbox render selected as final output.', {
            jobId,
            templateId,
            templateVersionId,
            bundleHash,
            buildHash,
            outputPath,
            metrics: sandboxResult.metrics,
            propsHash,
          });
          await this.updateProgress(supabase, jobId, 90, 'Sandbox externo genero el video');
        } else if (process.env.EXTERNAL_TEMPLATE_SANDBOX_FALLBACK_INTERNAL === 'true') {
          renderMode = 'EXTERNAL_SANDBOX_FALLBACK_INTERNAL';
          console.warn('[RemotionWorker] Sandbox failed; falling back to internal composition.', {
            jobId,
            templateId,
            templateVersionId,
            reason: sandboxResult.error,
            buildHash,
            propsHash,
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
        } else {
          throw new Error(sandboxResult.error || 'El runner sandbox externo no pudo completar el render.');
        }
      } else {
        if (sandboxVersion) {
          templateVersionId = sandboxVersion.id;
          bundleHash = sandboxVersion.bundle_hash;
          console.log('[RemotionWorker] Sandbox version available but feature flag is disabled; using internal composition.', {
            jobId,
            templateId,
            templateVersionId,
          });
        } else {
          console.log('[RemotionWorker] No approved sandbox version found; using internal composition.', {
            jobId,
            templateId,
            rawTemplateCompositionId: template.composition_id,
            internalCompositionId,
          });
        }

        await this.renderInternalComposition({
          supabase,
          jobId,
          outputDir,
          outputPath,
          serveUrlOverride,
          compositionId: internalCompositionId,
          inputProps,
        });
      }

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
        final_video_source: renderMode === 'EXTERNAL_SANDBOX' ? 'external_template_sandbox' : 'upload',
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
            message: safeError,
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
    const timeoutInMilliseconds = Number(
      process.env.REMOTION_RENDER_TIMEOUT_MS ||
        process.env.EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS ||
        DEFAULT_RENDER_TIMEOUT_MS,
    );
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

  private async getApprovedSandboxVersion(supabase: any, templateId: string): Promise<ApprovedSandboxVersion | null> {
    const { data, error } = await supabase
      .from('remotion_template_versions')
      .select(
        'id, organization_id, bundle_hash, build_hash, entry_point, storage_path, template_type, export_mode, composition_id, default_props, default_duration_frames, default_fps, default_width, default_height',
      )
      .eq('template_id', templateId)
      .eq('status', 'APPROVED_FOR_SANDBOX')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[RemotionWorker] No se pudo consultar version sandbox aprobada:', error);
      return null;
    }

    return data;
  }

  private async getOrCreateSandboxBuild(
    supabase: any,
    params: {
      sandboxVersion: ApprovedSandboxVersion;
      fallbackCompositionId: string;
      organizationId: string | null;
    },
  ): Promise<ResolvedSandboxBuild> {
    const { sandboxVersion, fallbackCompositionId, organizationId } = params;
    const bundleHash = sandboxVersion.bundle_hash || '';
    const compositionId = resolveExternalCompositionId(
      sandboxVersion.composition_id,
      fallbackCompositionId,
    );
    const exportMode = sandboxVersion.export_mode || 'component';

    if (!bundleHash) {
      throw new Error('La version sandbox aprobada no tiene bundle_hash.');
    }

    if (!organizationId) {
      throw new Error('No se pudo resolver organization_id para registrar el build sandbox.');
    }

    const { data: existingBuild, error: existingBuildError } = await supabase
      .from('remotion_template_builds')
      .select('id, serve_url, build_hash, composition_id, export_mode')
      .eq('template_version_id', sandboxVersion.id)
      .eq('bundle_hash', bundleHash)
      .eq('composition_id', compositionId)
      .eq('export_mode', exportMode)
      .eq('status', 'BUILT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBuildError) {
      console.warn('[RemotionWorker] No se pudo consultar build sandbox existente:', existingBuildError);
    }

    if (
      existingBuild?.serve_url &&
      (existingBuild.serve_url.startsWith('http') || fs.existsSync(existingBuild.serve_url))
    ) {
      return {
        buildId: existingBuild.id,
        serveUrl: existingBuild.serve_url,
        buildHash: existingBuild.build_hash || sandboxVersion.build_hash || null,
        compositionId: existingBuild.composition_id || compositionId,
        exportMode: existingBuild.export_mode === 'root' ? 'root' : 'component',
        cacheHit: true,
      };
    }

    const buildService = new SandboxBuildService(supabase);
    const buildResult = await buildService.buildFromZip({
      templateVersionId: sandboxVersion.id,
      bundleZipPath: sandboxVersion.storage_path,
      bundleHash,
      organizationId,
    });

    if (!buildResult.success || !buildResult.serveUrl) {
      throw new Error(`Build del bundle fallo: ${buildResult.error || 'error desconocido'}`);
    }

    return {
      buildId: buildResult.buildId || null,
      serveUrl: buildResult.serveUrl,
      buildHash: buildResult.buildHash || null,
      compositionId: buildResult.compositionId || compositionId,
      exportMode: buildResult.exportMode || exportMode,
      cacheHit: false,
    };
  }

  private extractExternalTemplateOverrides(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const variables = value as Record<string, unknown>;
    const candidate =
      variables.resolvedProps ??
      variables.customTemplateProps ??
      variables.templateProps;

    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null;
    }

    return candidate as Record<string, unknown>;
  }

  private resolveBundleStorageLocation(storagePath: string): { bucket: string; path: string } {
    const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const separatorIndex = normalized.indexOf('/');

    if (separatorIndex === -1) {
      return { bucket: 'template-bundles', path: normalized };
    }

    const bucket = normalized.slice(0, separatorIndex);
    const objectPath = normalized.slice(separatorIndex + 1);
    return { bucket, path: objectPath };
  }

  private async downloadSandboxBundle(
    supabase: any,
    version: ApprovedSandboxVersion,
    outputDir: string,
  ): Promise<string> {
    const { bucket, path: objectPath } = this.resolveBundleStorageLocation(version.storage_path);
    const { data, error } = await supabase.storage.from(bucket).download(objectPath);

    if (error || !data) {
      throw new Error(`No se pudo descargar el bundle aprobado para sandbox: ${error?.message || 'archivo no encontrado'}`);
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const bundleZipPath = path.join(outputDir, `template-${version.id}.zip`);
    const buffer = Buffer.from(await data.arrayBuffer());
    await fsp.writeFile(bundleZipPath, buffer);
    return bundleZipPath;
  }

  private collectAssetUrls(value: unknown): string[] {
    const urls = new Set<string>();
    const visit = (node: unknown) => {
      if (!node) return;
      if (typeof node === 'string') {
        if (/^https?:\/\//.test(node)) {
          urls.add(node);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node === 'object') {
        Object.values(node as Record<string, unknown>).forEach(visit);
      }
    };

    visit(value);
    return Array.from(urls).slice(0, 200);
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
