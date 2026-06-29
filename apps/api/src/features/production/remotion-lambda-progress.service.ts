import { getRemotionRenderConfig } from './remotion-render.config';

interface LambdaClientModule {
  getRenderProgress: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export class RemotionLambdaProgressService {
  async syncJobProgress(supabase: any, job: any): Promise<void> {
    if (!this.shouldSync(job)) return;

    const config = getRemotionRenderConfig().lambda;
    const renderId = this.readString(job.input_snapshot?.renderId) || this.readString(job.output_snapshot?.renderId);
    const bucketName = this.readString(job.input_snapshot?.bucketName) || this.readString(job.output_snapshot?.bucketName);
    if (!renderId || !bucketName) return;

    const lambdaClient = this.loadLambdaClient();
    const progress = await lambdaClient.getRenderProgress({
      renderId,
      bucketName,
      functionName: config.functionName,
      region: config.region,
    });

    if (progress.fatalErrorEncountered || this.hasErrors(progress.errors)) {
      await this.failLambdaJob(
        supabase,
        job,
        this.extractError(progress) || 'Remotion Lambda render failed while polling progress',
      );
      return;
    }

    if (progress.done === true) {
      await this.completeLambdaJob(supabase, job, {
        renderId,
        providerJobId: renderId,
        outputUrl: this.readString(progress.outputFile) || this.readString(progress.outputUrl),
        outputStoragePath:
          this.readString(progress.outputStoragePath) ||
          this.readString(job.output_snapshot?.outputStoragePath) ||
          this.readString(job.input_snapshot?.outputStoragePath),
      });
      return;
    }

    const overallProgress = typeof progress.overallProgress === 'number'
      ? progress.overallProgress
      : typeof progress.progress === 'number'
        ? progress.progress
        : null;
    if (overallProgress === null) return;

    const percent = Math.min(95, Math.max(20, Math.round(20 + overallProgress * 75)));
    await supabase
      .from('production_jobs')
      .update({
        status: 'WAITING_PROVIDER',
        progress: [{ percent, message: 'Render en progreso en Remotion Lambda', timestamp: new Date().toISOString() }],
        output_snapshot: {
          ...(job.output_snapshot || {}),
          renderProvider: 'lambda',
          renderId,
          bucketName,
          lastPolledAt: new Date().toISOString(),
          overallProgress,
        },
      })
      .eq('id', job.id);
  }

  async completeLambdaJob(
    supabase: any,
    job: any,
    result: {
      renderId: string | null;
      providerJobId: string | null;
      outputUrl: string | null;
      outputStoragePath: string | null;
    },
  ) {
    const componentId = job.material_component_id;
    const finalVideoUrl = result.outputUrl || result.outputStoragePath;
    if (!finalVideoUrl) {
      await this.failLambdaJob(supabase, job, 'Remotion Lambda completed without an output URL or storage path');
      return;
    }

    const { data: component } = await supabase
      .from('material_components')
      .select('assets')
      .eq('id', componentId)
      .maybeSingle();

    await supabase
      .from('material_components')
      .update({
        assets: {
          ...(component?.assets || {}),
          final_video_url: finalVideoUrl,
          final_video_source: 'remotion_lambda',
          production_status: 'COMPLETED',
          updated_at: new Date().toISOString(),
        },
      })
      .eq('id', componentId);

    await supabase
      .from('production_jobs')
      .update({
        status: 'SUCCEEDED',
        completed_at: new Date().toISOString(),
        progress: [{ percent: 100, message: 'Render completado por Remotion Lambda', timestamp: new Date().toISOString() }],
        output_snapshot: {
          ...(job.output_snapshot || {}),
          completed: true,
          renderProvider: 'lambda',
          providerJobId: result.providerJobId,
          renderId: result.renderId,
          final_video_url: finalVideoUrl,
          outputUrl: result.outputUrl,
          outputStoragePath: result.outputStoragePath,
        },
      })
      .eq('id', job.id);
  }

  async failLambdaJob(supabase: any, job: any, message: string) {
    await supabase
      .from('production_jobs')
      .update({
        status: 'FAILED',
        failed_at: new Date().toISOString(),
        provider_error: {
          message: this.sanitizeError(message),
          renderProvider: 'lambda',
        },
      })
      .eq('id', job.id);

    if (job.material_component_id) {
      const { data: component } = await supabase
        .from('material_components')
        .select('assets')
        .eq('id', job.material_component_id)
        .maybeSingle();

      await supabase
        .from('material_components')
        .update({
          assets: {
            ...(component?.assets || {}),
            production_status: 'FAILED',
            updated_at: new Date().toISOString(),
          },
        })
        .eq('id', job.material_component_id);
    }
  }

  private shouldSync(job: any): boolean {
    return (
      job?.status === 'WAITING_PROVIDER' &&
      (job.input_snapshot?.renderProvider === 'lambda' || job.output_snapshot?.renderProvider === 'lambda')
    );
  }

  private loadLambdaClient(): LambdaClientModule {
    try {
      // Loaded lazily so local mode can run without Lambda tooling installed.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@remotion/lambda/client') as LambdaClientModule;
    } catch {
      throw new Error('Missing @remotion/lambda. Install it in apps/api before polling Lambda renders.');
    }
  }

  private hasErrors(errors: unknown): boolean {
    return Array.isArray(errors) && errors.length > 0;
  }

  private extractError(progress: Record<string, unknown>): string | null {
    const errors = progress.errors;
    if (!Array.isArray(errors) || errors.length === 0) return null;
    const firstError = errors[0];
    if (typeof firstError === 'string') return firstError;
    if (firstError && typeof firstError === 'object') {
      const record = firstError as Record<string, unknown>;
      return this.readString(record.message) || this.readString(record.stack);
    }
    return null;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private sanitizeError(message: string): string {
    return message
      .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=[redacted]')
      .slice(0, 1000);
  }
}
