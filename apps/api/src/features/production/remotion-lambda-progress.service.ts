import { ensureAwsCredentialsEnv } from './aws-credentials-env';
import { getRemotionRenderConfig } from './remotion-render.config';

interface LambdaClientModule {
  getRenderProgress: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface S3ClientModule {
  S3Client: new (params: Record<string, unknown>) => unknown;
  GetObjectCommand: new (params: Record<string, unknown>) => unknown;
}

interface S3PresignerModule {
  getSignedUrl: (client: unknown, command: unknown, params: { expiresIn: number }) => Promise<string>;
}

type ProgressEntry = {
  percent: number;
  message: string;
  timestamp: string;
  stage?: string;
  provider?: string;
  renderId?: string | null;
};

type PlayableOutput = {
  url: string | null;
  expiresAt: string | null;
  storageProvider: 'supabase' | 's3-signed' | 'external' | null;
  storagePath: string | null;
  sourceStoragePath: string | null;
};

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
      const extractedError = this.extractError(progress) || 'Remotion Lambda render failed while polling progress';
      if (this.isThrottleError(extractedError) && this.throttleRetryCount(job) < 3) {
        await this.deferThrottledLambdaJob(supabase, job, extractedError);
        return;
      }

      await this.failLambdaJob(
        supabase,
        job,
        extractedError,
      );
      return;
    }

    if (progress.done === true) {
      const rawOutputUrl = this.readString(progress.outputFile) || this.readString(progress.outputUrl);
      await this.completeLambdaJob(supabase, job, {
        renderId,
        providerJobId: renderId,
        outputUrl: rawOutputUrl || null,
        outputStoragePath:
          this.readString(progress.outputStoragePath) ||
          (rawOutputUrl && rawOutputUrl.startsWith('s3://') ? rawOutputUrl : null) ||
          this.readString(job.output_snapshot?.outputStoragePath) ||
          this.readString(job.input_snapshot?.outputStoragePath),
      });
      return;
    }

    const overallProgress = this.readNumber(progress.overallProgress) ?? this.readNumber(progress.progress);
    const providerActivity = this.describeProviderActivity(progress);
    if (overallProgress === null && !providerActivity.isActive) return;

    const percent = overallProgress === null
      ? providerActivity.fallbackPercent
      : Math.min(95, Math.max(providerActivity.fallbackPercent, Math.round(20 + overallProgress * 75)));
    await supabase
      .from('production_jobs')
      .update({
        status: providerActivity.isActive ? 'RUNNING' : 'WAITING_PROVIDER',
        progress: this.appendProgress(job.progress, {
          percent,
          message: providerActivity.message,
          timestamp: new Date().toISOString(),
          stage: providerActivity.stage,
          provider: 'lambda',
          renderId,
        }),
        output_snapshot: {
          ...(job.output_snapshot || {}),
          renderProvider: 'lambda',
          renderId,
          bucketName,
          lastPolledAt: new Date().toISOString(),
          overallProgress,
          framesRendered: this.readNumber(progress.framesRendered),
          combinedFrames: this.readNumber(progress.combinedFrames),
          lambdasInvoked: this.readNumber(progress.lambdasInvoked),
          chunks: this.readNumber(progress.chunks),
          serveUrlOpened: this.readNumber(progress.serveUrlOpened),
          compositionValidated: this.readNumber(progress.compositionValidated),
          timeToFinish: this.readNumber(progress.timeToFinish),
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
    const output = await this.resolvePlayableOutputUrl({
      supabase,
      componentId,
      outputUrl: result.outputUrl,
      outputStoragePath: result.outputStoragePath,
      bucketName: this.readString(job.output_snapshot?.bucketName) || this.readString(job.input_snapshot?.bucketName),
    });
    const finalVideoUrl = output.url;
    if (!finalVideoUrl) {
      await this.failLambdaJob(
        supabase,
        job,
        'Remotion Lambda completed without a browser-playable HTTPS output URL',
        'OUTPUT_NOT_ACCESSIBLE',
      );
      return;
    }

    const { data: component } = await supabase
      .from('material_components')
      .select(`
        assets,
        material_lessons (
          lesson_id,
          lesson_title,
          module_title
        )
      `)
      .eq('id', componentId)
      .maybeSingle();
    const materialLesson = Array.isArray(component?.material_lessons)
      ? component.material_lessons[0]
      : component?.material_lessons;

    await supabase
      .from('material_components')
      .update({
        assets: {
          ...(component?.assets || {}),
          final_video_url: finalVideoUrl,
          final_video_source: 'remotion_lambda',
          final_video_storage_provider: output.storageProvider,
          final_video_storage_path: output.storagePath || result.outputStoragePath,
          final_video_source_storage_path: output.sourceStoragePath || result.outputStoragePath,
          final_video_url_expires_at: output.expiresAt,
          production_status: 'COMPLETED',
          updated_at: new Date().toISOString(),
        },
      })
      .eq('id', componentId);

    await this.syncFinalVideoToPublicationRequest(supabase, {
      artifactId: this.readString(job.artifact_id),
      lessonId: this.readString(materialLesson?.lesson_id) || this.readString(job.lesson_id),
      lessonTitle: this.readString(materialLesson?.lesson_title) || this.readString(job.lesson_id) || '',
      moduleTitle: this.readString(materialLesson?.module_title) || '',
      finalVideoUrl,
      duration: Number(component?.assets?.video_duration) || 0,
    });

    await supabase
      .from('production_jobs')
      .update({
        status: 'SUCCEEDED',
        completed_at: new Date().toISOString(),
        progress: this.appendProgress(job.progress, {
          percent: 100,
          message: 'Render completado por Remotion Lambda',
          timestamp: new Date().toISOString(),
          stage: 'completed',
          provider: 'lambda',
          renderId: result.renderId,
        }),
        output_snapshot: {
          ...(job.output_snapshot || {}),
          completed: true,
          renderProvider: 'lambda',
          providerJobId: result.providerJobId,
          renderId: result.renderId,
          final_video_url: finalVideoUrl,
          outputUrl: finalVideoUrl,
          outputUrlExpiresAt: output.expiresAt,
          outputStorageProvider: output.storageProvider,
          outputPublicStoragePath: output.storagePath,
          outputStoragePath: result.outputStoragePath,
          sourceStoragePath: output.sourceStoragePath || result.outputStoragePath,
        },
      })
      .eq('id', job.id);
  }

  private async syncFinalVideoToPublicationRequest(
    supabase: any,
    params: {
      artifactId: string | null;
      lessonId: string | null;
      lessonTitle: string;
      moduleTitle: string;
      finalVideoUrl: string;
      duration: number;
    },
  ): Promise<void> {
    if (!params.artifactId || !params.lessonId || !params.finalVideoUrl) return;

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
        lesson_title: params.lessonTitle,
        module_title: params.moduleTitle,
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

  async failLambdaJob(supabase: any, job: any, message: string, code?: string) {
    const safeMessage = this.sanitizeError(message);
    await supabase
      .from('production_jobs')
      .update({
        status: 'FAILED',
        failed_at: new Date().toISOString(),
        provider_error: {
          code: code || this.classifyError(safeMessage),
          message: safeMessage,
          renderProvider: 'lambda',
          stage: 'polling',
          occurredAt: new Date().toISOString(),
        },
        progress: this.appendProgress(job.progress, {
          percent: 95,
          message: `Render Lambda fallido: ${safeMessage}`,
          timestamp: new Date().toISOString(),
          stage: 'failed',
          provider: 'lambda',
          renderId: this.readString(job.input_snapshot?.renderId) || this.readString(job.output_snapshot?.renderId),
        }),
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
      (job?.status === 'WAITING_PROVIDER' || job?.status === 'RUNNING') &&
      (job.input_snapshot?.renderProvider === 'lambda' || job.output_snapshot?.renderProvider === 'lambda')
    );
  }

  private async deferThrottledLambdaJob(supabase: any, job: any, message: string): Promise<void> {
    const safeMessage = this.sanitizeError(message);
    const nextRetryCount = this.throttleRetryCount(job) + 1;
    const renderId = this.readString(job.input_snapshot?.renderId) || this.readString(job.output_snapshot?.renderId);

    await supabase
      .from('production_jobs')
      .update({
        status: 'WAITING_PROVIDER',
        provider_error: {
          code: 'LAMBDA_THROTTLED',
          message: safeMessage,
          renderProvider: 'lambda',
          stage: 'polling_retry',
          retryCount: nextRetryCount,
          occurredAt: new Date().toISOString(),
        },
        progress: this.appendProgress(job.progress, {
          percent: 25,
          message: `AWS limito temporalmente la concurrencia del render. Reintentando polling (${nextRetryCount}/3).`,
          timestamp: new Date().toISOString(),
          stage: 'lambda_throttled_retry',
          provider: 'lambda',
          renderId,
        }),
        output_snapshot: {
          ...(job.output_snapshot || {}),
          renderProvider: 'lambda',
          renderId,
          throttleRetryCount: nextRetryCount,
          lastThrottleAt: new Date().toISOString(),
        },
      })
      .eq('id', job.id);
  }

  private loadLambdaClient(): LambdaClientModule {
    try {
      ensureAwsCredentialsEnv();
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

  private throttleRetryCount(job: any): number {
    const raw = this.readNumber(job.output_snapshot?.throttleRetryCount);
    return raw === null ? 0 : raw;
  }

  private isThrottleError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('throttl') ||
      normalized.includes('rate exceeded') ||
      normalized.includes('concurrency') ||
      normalized.includes('too many requests');
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

  private readNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private describeProviderActivity(progress: Record<string, unknown>): {
    isActive: boolean;
    fallbackPercent: number;
    message: string;
    stage: string;
  } {
    const framesRendered = this.readNumber(progress.framesRendered) || 0;
    const combinedFrames = this.readNumber(progress.combinedFrames) || 0;
    const lambdasInvoked = this.readNumber(progress.lambdasInvoked) || 0;
    const compositionValidated = this.readNumber(progress.compositionValidated);
    const serveUrlOpened = this.readNumber(progress.serveUrlOpened);

    if (combinedFrames > 0) {
      return {
        isActive: true,
        fallbackPercent: 90,
        message: 'Render combinando video final en Remotion Lambda',
        stage: 'lambda_combining',
      };
    }

    if (framesRendered > 0) {
      return {
        isActive: true,
        fallbackPercent: 35,
        message: 'Renderizando frames en Remotion Lambda',
        stage: 'lambda_rendering_frames',
      };
    }

    if (lambdasInvoked > 0) {
      return {
        isActive: true,
        fallbackPercent: 25,
        message: 'Remotion Lambda invoco workers de render',
        stage: 'lambda_workers_invoked',
      };
    }

    if (compositionValidated !== null) {
      return {
        isActive: true,
        fallbackPercent: 23,
        message: 'Composicion validada por Remotion Lambda',
        stage: 'lambda_composition_validated',
      };
    }

    if (serveUrlOpened !== null) {
      return {
        isActive: true,
        fallbackPercent: 22,
        message: 'Bundle abierto por Remotion Lambda',
        stage: 'lambda_serve_url_opened',
      };
    }

    return {
      isActive: false,
      fallbackPercent: 20,
      message: 'Render aceptado; esperando progreso de Remotion Lambda',
      stage: 'lambda_waiting_provider',
    };
  }

  private async resolvePlayableOutputUrl(params: {
    supabase: any;
    componentId: string;
    outputUrl: string | null;
    outputStoragePath: string | null;
    bucketName: string | null;
  }): Promise<PlayableOutput> {
    if (params.outputUrl && /^https?:\/\//i.test(params.outputUrl) && !this.isAwsS3Url(params.outputUrl)) {
      return {
        url: params.outputUrl,
        expiresAt: null,
        storageProvider: 'external',
        storagePath: null,
        sourceStoragePath: params.outputStoragePath,
      };
    }

    const parsedS3Output =
      this.parseS3Output(params.outputStoragePath, params.bucketName) ||
      this.parseS3OutputUrl(params.outputUrl, params.bucketName);

    if (parsedS3Output) {
      const copiedOutput = await this.copyS3OutputToProductionStorage({
        supabase: params.supabase,
        componentId: params.componentId,
        bucketName: parsedS3Output.bucketName,
        key: parsedS3Output.key,
      });

      if (copiedOutput.url) {
        return {
          url: copiedOutput.url,
          expiresAt: null,
          storageProvider: 'supabase',
          storagePath: copiedOutput.storagePath,
          sourceStoragePath: `s3://${parsedS3Output.bucketName}/${parsedS3Output.key}`,
        };
      }
    }

    if (!parsedS3Output) {
      return {
        url: null,
        expiresAt: null,
        storageProvider: null,
        storagePath: null,
        sourceStoragePath: params.outputStoragePath,
      };
    }

    const expiresIn = this.getSignedUrlTtlSeconds();
    try {
      const { S3Client, GetObjectCommand } = this.loadS3Client();
      const { getSignedUrl } = this.loadS3Presigner();
      const client = new S3Client({ region: getRemotionRenderConfig().lambda.region });
      const command = new GetObjectCommand({ Bucket: parsedS3Output.bucketName, Key: parsedS3Output.key });
      const url = await getSignedUrl(client, command, { expiresIn });
      return {
        url,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
        storageProvider: 's3-signed',
        storagePath: null,
        sourceStoragePath: `s3://${parsedS3Output.bucketName}/${parsedS3Output.key}`,
      };
    } catch (error) {
      console.warn('[RemotionLambdaProgressService] Could not create signed S3 URL.', {
        bucketName: parsedS3Output.bucketName,
        key: parsedS3Output.key,
        error: this.sanitizeError(error instanceof Error ? error.message : String(error)),
      });
      return {
        url: null,
        expiresAt: null,
        storageProvider: null,
        storagePath: null,
        sourceStoragePath: `s3://${parsedS3Output.bucketName}/${parsedS3Output.key}`,
      };
    }
  }

  private async copyS3OutputToProductionStorage(params: {
    supabase: any;
    componentId: string;
    bucketName: string;
    key: string;
  }): Promise<{ url: string | null; storagePath: string | null }> {
    try {
      const { S3Client, GetObjectCommand } = this.loadS3Client();
      const client = new S3Client({ region: getRemotionRenderConfig().lambda.region });
      const command = new GetObjectCommand({ Bucket: params.bucketName, Key: params.key });
      const response = await (client as any).send(command);
      const fileBuffer = await this.bodyToBuffer(response?.Body);
      if (!fileBuffer.length) {
        throw new Error('S3 output object is empty.');
      }

      const outputStoragePath = `completed/${params.componentId}.mp4`;
      const { error: uploadError } = await params.supabase.storage
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
      } = params.supabase.storage.from('production-videos').getPublicUrl(outputStoragePath);

      return { url: publicUrl, storagePath: outputStoragePath };
    } catch (error) {
      console.warn('[RemotionLambdaProgressService] Could not copy Lambda output to production-videos.', {
        bucketName: params.bucketName,
        key: params.key,
        componentId: params.componentId,
        error: this.sanitizeError(error instanceof Error ? error.message : String(error)),
      });
      return { url: null, storagePath: null };
    }
  }

  private async bodyToBuffer(body: any): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray());
    }
    if (typeof body.arrayBuffer === 'function') {
      return Buffer.from(await body.arrayBuffer());
    }
    if (typeof body[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    return Buffer.alloc(0);
  }

  private parseS3Output(
    outputStoragePath: string | null,
    fallbackBucketName: string | null,
  ): { bucketName: string; key: string } | null {
    if (!outputStoragePath) return null;

    if (outputStoragePath.startsWith('s3://')) {
      const withoutScheme = outputStoragePath.slice('s3://'.length);
      const slashIndex = withoutScheme.indexOf('/');
      if (slashIndex <= 0) return null;
      return {
        bucketName: withoutScheme.slice(0, slashIndex),
        key: withoutScheme.slice(slashIndex + 1),
      };
    }

    if (fallbackBucketName && !/^https?:\/\//i.test(outputStoragePath)) {
      return {
        bucketName: fallbackBucketName,
        key: outputStoragePath.replace(/^\/+/, ''),
      };
    }

    return null;
  }

  private parseS3OutputUrl(
    outputUrl: string | null,
    fallbackBucketName: string | null,
  ): { bucketName: string; key: string } | null {
    if (!outputUrl || !this.isAwsS3Url(outputUrl)) return null;

    try {
      const url = new URL(outputUrl);
      const hostParts = url.hostname.split('.');
      const pathSegments = url.pathname.split('/').filter(Boolean);

      if (hostParts[0] === 's3' && pathSegments.length >= 2) {
        return {
          bucketName: pathSegments[0],
          key: pathSegments.slice(1).join('/'),
        };
      }

      if (hostParts[1] === 's3' && hostParts[0]) {
        return {
          bucketName: hostParts[0],
          key: pathSegments.join('/'),
        };
      }

      if (fallbackBucketName && pathSegments.length > 0) {
        const key = pathSegments[0] === fallbackBucketName
          ? pathSegments.slice(1).join('/')
          : pathSegments.join('/');
        return { bucketName: fallbackBucketName, key };
      }
    } catch {
      return null;
    }

    return null;
  }

  private isAwsS3Url(value: string): boolean {
    try {
      const url = new URL(value);
      return /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname) ||
        /^s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname) ||
        url.hostname === 's3.amazonaws.com';
    } catch {
      return false;
    }
  }

  private getSignedUrlTtlSeconds(): number {
    const raw = process.env.REMOTION_LAMBDA_OUTPUT_URL_TTL_SECONDS;
    const parsed = raw ? Number(raw) : 60 * 60 * 24 * 7;
    if (!Number.isInteger(parsed) || parsed < 60) return 60 * 60 * 24 * 7;
    return Math.min(parsed, 60 * 60 * 24 * 7);
  }

  private loadS3Client(): S3ClientModule {
    try {
      ensureAwsCredentialsEnv();
      // Loaded lazily so local mode and tests can run without direct AWS setup.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@aws-sdk/client-s3') as S3ClientModule;
    } catch {
      throw new Error('Missing @aws-sdk/client-s3. It is required to sign private Lambda render outputs.');
    }
  }

  private loadS3Presigner(): S3PresignerModule {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@aws-sdk/s3-request-presigner') as S3PresignerModule;
    } catch {
      throw new Error('Missing @aws-sdk/s3-request-presigner. It is required to sign private Lambda render outputs.');
    }
  }

  private appendProgress(currentProgress: unknown, entry: ProgressEntry): ProgressEntry[] {
    const previous = Array.isArray(currentProgress)
      ? currentProgress.filter((item): item is ProgressEntry => Boolean(item && typeof item === 'object'))
      : [];

    return [...previous, entry].slice(-50);
  }

  private classifyError(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('timed out') || normalized.includes('timeout')) return 'LAMBDA_TIMEOUT';
    if (normalized.includes('throttl') || normalized.includes('rate exceeded') || normalized.includes('concurrency')) {
      return 'LAMBDA_THROTTLED';
    }
    if (normalized.includes('output') || normalized.includes('url') || normalized.includes('s3://')) {
      return 'OUTPUT_NOT_ACCESSIBLE';
    }
    if (normalized.includes('props') || normalized.includes('asset')) return 'INVALID_RENDER_PROPS';
    return 'LAMBDA_RENDER_FAILED';
  }

  private sanitizeError(message: string): string {
    return message
      .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=[redacted]')
      .replace(/X-Amz-Signature=[^&\s]+/gi, 'X-Amz-Signature=[redacted]')
      .slice(0, 1000);
  }
}
