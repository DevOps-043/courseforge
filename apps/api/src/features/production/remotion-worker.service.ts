import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';

/**
 * FPS del ensamblado. DEBE coincidir con ASSEMBLY_FPS del contrato compartido
 * en apps/web/src/remotion/types.ts (las <Composition> se registran con ese fps).
 */
const ASSEMBLY_FPS = 30;
/** Duración fallback (segundos) cuando ningún asset reporta su duración. */
const FALLBACK_DURATION_SECONDS = 10;
/** Duración por defecto (segundos) de clips/slides sin metadato. */
const DEFAULT_CLIP_SECONDS = 5;
const DEFAULT_SLIDE_SECONDS = 5;
/** Composición por defecto si la plantilla no especifica composition_id. */
const DEFAULT_COMPOSITION_ID = 'full-slides';
const VALID_COMPOSITION_IDS = new Set(['full-slides', 'split-avatar', 'avatar-focus']);

/**
 * Forma de inputProps que consumen las composiciones Remotion. Espejo del
 * contrato `AssemblyInputProps` (apps/web/src/remotion/types.ts). Se mantiene
 * local porque apps/api no puede importar apps/web (rootDir + split zod 3/4).
 */
interface AssemblyInputProps {
  template: string;
  fps: number;
  totalDurationInFrames: number;
  voiceAudioUrl?: string;
  bgMusicUrl?: string;
  bgMusicVolume: number;
  avatarVideoUrl?: string;
  slides: { index: number; url: string }[];
  brollClips: { url: string; durationInFrames: number; order: number }[];
  transitionType: 'fade' | 'slide' | 'none';
}

/**
 * Bundle Remotion cacheado a nivel de módulo: empaquetar es costoso, así que se
 * hace una sola vez por proceso y se reutiliza en todos los renders.
 */
let cachedBundlePromise: Promise<string> | null = null;

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

  public async runRenderJob(jobId: string): Promise<void> {
    const supabase = this.getSupabaseClient();
    console.log(`[RemotionWorker] Starting render job: ${jobId}`);

    // 1. Fetch job details
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

    await this.updateProgress(supabase, jobId, 0, 'Inicializando render', { status: 'RUNNING', started_at: new Date().toISOString() });

    const componentId = job.material_component_id;
    const templateId = job.input_snapshot?.templateId;
    const outputDir = path.join(os.tmpdir(), `remotion-out-${jobId}`);
    const outputPath = path.join(outputDir, 'output.mp4');
    let assets: any = {};

    try {
      // 2. Fetch component and template
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

      const compositionId = this.resolveCompositionId(template.composition_id);
      const inputProps = this.buildInputProps(
        assets,
        compositionId,
        job.input_snapshot?.variables?.transitionType,
      );

      // 3. Ensure headless browser is available (downloads on first run if needed)
      await this.updateProgress(supabase, jobId, 10, 'Preparando motor de render');
      await ensureBrowser();

      // 4. Bundle compositions (cached across jobs)
      await this.updateProgress(supabase, jobId, 20, 'Compilando plantillas de video');
      const serveUrl = await this.getBundle();

      // 5. Resolve composition metadata (runs calculateMetadata -> duration/fps)
      await this.updateProgress(supabase, jobId, 35, 'Resolviendo composición');
      const composition = await selectComposition({
        serveUrl,
        id: compositionId,
        inputProps: inputProps as unknown as Record<string, unknown>,
      });

      // 6. Render to a temporary mp4, streaming progress 40% -> 90%
      fs.mkdirSync(outputDir, { recursive: true });
      let lastReportedPercent = 40;
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: outputPath,
        inputProps: inputProps as unknown as Record<string, unknown>,
        onProgress: ({ progress }) => {
          const overall = Math.round(40 + progress * 50);
          if (overall > lastReportedPercent) {
            lastReportedPercent = overall;
            void this.updateProgress(
              supabase,
              jobId,
              overall,
              `Renderizando fotogramas (${Math.round(progress * 100)}%)`,
            );
          }
        },
      });

      if (!fs.existsSync(outputPath)) {
        throw new Error('El renderizador de Remotion no generó el video output.mp4');
      }

      // 7. Upload compiled video to Supabase Storage
      await this.updateProgress(supabase, jobId, 92, 'Guardando video en almacenamiento');
      const fileBuffer = fs.readFileSync(outputPath);
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

      const { data: { publicUrl } } = supabase.storage
        .from('production-videos')
        .getPublicUrl(outputStoragePath);

      // 8. Update material component assets in DB
      const updatedAssets = {
        ...assets,
        final_video_url: publicUrl,
        final_video_source: 'upload',
        video_duration: Math.round(composition.durationInFrames / composition.fps),
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

      // 9. Mark job SUCCEEDED
      await supabase
        .from('production_jobs')
        .update({
          status: 'SUCCEEDED',
          progress: [{ percent: 100, message: 'Ensamblado completado exitosamente', timestamp: new Date().toISOString() }],
          completed_at: new Date().toISOString(),
          output_snapshot: { final_video_url: publicUrl, completed: true },
        })
        .eq('id', jobId);

      console.log(`[RemotionWorker] Job ${jobId} completed successfully!`);

    } catch (err: any) {
      console.error(`[RemotionWorker] Job ${jobId} failed:`, err);

      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: { message: err.message || 'Error desconocido', stack: err.stack },
        })
        .eq('id', jobId);

      await supabase
        .from('material_components')
        .update({
          assets: { ...assets, production_status: 'FAILED', updated_at: new Date().toISOString() },
        })
        .eq('id', componentId);

    } finally {
      // 10. Clean up temp output directory
      if (fs.existsSync(outputDir)) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
        } catch (cleanError) {
          console.error('[RemotionWorker] Error deleting output directory:', cleanError);
        }
      }
    }
  }

  /** Bundles the Remotion entry once and reuses the serve URL across jobs. */
  private getBundle(): Promise<string> {
    if (!cachedBundlePromise) {
      const entryPoint = this.resolveEntryPoint();
      console.log(`[RemotionWorker] Bundling Remotion entry: ${entryPoint}`);
      cachedBundlePromise = bundle({ entryPoint }).catch((err) => {
        // Reset cache so a later job can retry bundling after a transient failure.
        cachedBundlePromise = null;
        throw err;
      });
    }
    return cachedBundlePromise;
  }

  /**
   * Resuelve la ruta al entry de las composiciones (apps/web). Configurable vía
   * REMOTION_ENTRY_POINT; por defecto relativo al cwd de apps/api.
   */
  private resolveEntryPoint(): string {
    const fromEnv = process.env.REMOTION_ENTRY_POINT;
    const entryPoint = fromEnv
      ? path.resolve(fromEnv)
      : path.resolve(process.cwd(), '../web/src/remotion/index.ts');

    if (!fs.existsSync(entryPoint)) {
      throw new Error(
        `No se encontró el entry de Remotion en "${entryPoint}". ` +
          'Configura REMOTION_ENTRY_POINT con la ruta a apps/web/src/remotion/index.ts.',
      );
    }
    return entryPoint;
  }

  private resolveCompositionId(rawCompositionId: unknown): string {
    if (typeof rawCompositionId === 'string' && VALID_COMPOSITION_IDS.has(rawCompositionId)) {
      return rawCompositionId;
    }
    return DEFAULT_COMPOSITION_ID;
  }

  /**
   * Mapea `material_components.assets` al contrato de inputProps. Espejo de
   * `buildAssemblyProps` (apps/web/src/remotion/buildAssemblyProps.ts): si una
   * cambia, actualizar la otra.
   */
  private buildInputProps(
    assets: any,
    compositionId: string,
    transitionType: unknown,
  ): AssemblyInputProps {
    const fps = ASSEMBLY_FPS;
    const secondsToFrames = (seconds: number) => Math.max(1, Math.round(seconds * fps));

    const slides: { index: number; url: string }[] = (assets.slides?.images ?? [])
      .filter((img: any) => Boolean(img?.public_url))
      .map((img: any) => ({ index: img.slide_index, url: img.public_url }));

    const brollClips = (assets.b_roll_clips ?? [])
      .filter((clip: any) => Boolean(clip?.public_url))
      .map((clip: any, i: number) => ({
        url: clip.public_url,
        durationInFrames: secondsToFrames(clip.duration ?? DEFAULT_CLIP_SECONDS),
        order: clip.order ?? i + 1,
      }));

    const brollTotalSeconds = brollClips.reduce(
      (sum: number, clip: { durationInFrames: number }) => sum + clip.durationInFrames / fps,
      0,
    );

    let totalSeconds = assets.voice_audio?.duration ?? assets.avatar_video?.duration ?? 0;
    if (totalSeconds <= 0 && brollTotalSeconds > 0) totalSeconds = brollTotalSeconds;
    if (totalSeconds <= 0 && slides.length > 0) totalSeconds = slides.length * DEFAULT_SLIDE_SECONDS;
    if (totalSeconds <= 0) totalSeconds = FALLBACK_DURATION_SECONDS;

    const transition =
      transitionType === 'slide' || transitionType === 'none' ? transitionType : 'fade';

    return {
      template: compositionId,
      fps,
      totalDurationInFrames: secondsToFrames(totalSeconds),
      voiceAudioUrl: assets.voice_audio?.public_url || undefined,
      bgMusicUrl: assets.background_music?.public_url || undefined,
      bgMusicVolume: assets.background_music?.volume_multiplier ?? 0.15,
      avatarVideoUrl: assets.avatar_video?.public_url || undefined,
      slides,
      brollClips,
      transitionType: transition,
    };
  }

  /**
   * Updates the job progress (and optionally other fields) in a single write.
   * `supabase` se tipa laxo: el genérico de SupabaseClient es frágil y este es
   * un helper interno (consistente con el resto del worker).
   */
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
}