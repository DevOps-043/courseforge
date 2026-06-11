import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import {
  buildAssemblyInputProps,
  resolveCompositionId,
} from './remotion-assembly-props.service';

let cachedBundlePromise: Promise<string> | null = null;

export const SHARED_BUNDLE_DIR = path.join(os.tmpdir(), 'courseforge-remotion-bundle');

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
    const outputPath = path.join(outputDir, 'output.mp4');
    let assets: any = {};

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
      const compositionId = resolveCompositionId(template.composition_id);
      const inputProps = buildAssemblyInputProps({
        assets,
        compositionId,
        transitionType: job.input_snapshot?.variables?.transitionType,
      });

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
      const composition = await selectComposition({
        serveUrl,
        id: compositionId,
        inputProps: inputProps as unknown as Record<string, unknown>,
      });

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

      if (!fs.existsSync(outputPath)) {
        throw new Error('El renderizador de Remotion no generó el video output.mp4');
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

      const { data: { publicUrl } } = supabase.storage
        .from('production-videos')
        .getPublicUrl(outputStoragePath);

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
      console.warn('[RemotionWorker] No se pudo pre-calentar el bundle (se bundleará en el primer render):', err);
      return null;
    }
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
        `No se encontró el entry de Remotion en "${entryPoint}". ` +
          'Configura REMOTION_ENTRY_POINT con la ruta a apps/web/src/remotion/index.ts.',
      );
    }
    return entryPoint;
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
}
