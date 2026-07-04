import { createClient } from '@supabase/supabase-js';
import {
  buildAssemblyInputProps,
  resolveInternalCompositionId,
  type AssemblyInputProps,
} from './remotion-assembly-props.service';
import { buildStableHash, getRemotionRenderConfig, type RemotionLambdaConfig } from './remotion-render.config';
import { mergeTemplateRenderConfigs } from './template-render-config.service';
import type { RenderDispatchResult, RenderProvider } from './render-provider.types';
import { resolveExternalLambdaRenderTarget } from './external-lambda-render-target.service';
import { buildExternalTemplateProps } from './external-template-props.service';
import { ensureAwsCredentialsEnv } from './aws-credentials-env';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface LambdaClientModule {
  renderMediaOnLambda: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

type ProductionJobProgressEntry = {
  percent: number;
  message: string;
  timestamp: string;
  stage?: string;
  provider?: string;
  renderId?: string | null;
};

interface ResolvedLambdaRenderInput {
  job: any;
  component: any;
  template: any;
  compositionId: string;
  inputProps: AssemblyInputProps | Record<string, unknown>;
  propsHash: string;
  outputKey: string;
  serveUrl: string;
  templateVersionId?: string | null;
  buildId?: string | null;
  buildHash?: string | null;
  exportMode?: 'component' | 'root';
  renderMode: string;
  propsSource?: string | null;
  propKeys?: string[];
}

export class RemotionLambdaProvider implements RenderProvider {
  readonly name = 'lambda' as const;

  private getSupabaseClient() {
    return createClient(supabaseUrl, supabaseServiceKey);
  }

  async dispatch(jobId: string): Promise<RenderDispatchResult> {
    const config = getRemotionRenderConfig().lambda;
    const supabase = this.getSupabaseClient();

    try {
      const resolvedInput = await this.resolveRenderInput(supabase, jobId, config);
      await this.updateProgress(
        supabase,
        jobId,
        10,
        'Target de render resuelto para Remotion Lambda',
        'render_target_resolved',
        {
          status: 'RUNNING',
          started_at: new Date().toISOString(),
        },
      );

      const lambdaClient = this.loadLambdaClient();
      const tuning = this.resolveLambdaTuning(config);
      const renderRequest = {
        region: config.region,
        functionName: config.functionName,
        serveUrl: resolvedInput.serveUrl,
        composition: resolvedInput.compositionId,
        inputProps: resolvedInput.inputProps as unknown as Record<string, unknown>,
        codec: 'h264',
        privacy: config.outputPrivacy,
        timeoutInMilliseconds: config.timeoutInMilliseconds,
        overwrite: true,
        ...tuning,
        concurrencyPerLambda: config.concurrencyPerLambda,
        outName: {
          bucketName: config.bucketName,
          key: resolvedInput.outputKey,
        },
      };

      console.info('[RemotionLambdaProvider] Dispatching render.', {
        jobId,
        organizationId: resolvedInput.job.organization_id,
        componentId: resolvedInput.job.material_component_id,
        templateId: resolvedInput.job.input_snapshot?.templateId,
        compositionId: resolvedInput.compositionId,
        renderMode: resolvedInput.renderMode,
        templateVersionId: resolvedInput.templateVersionId || null,
        buildId: resolvedInput.buildId || null,
        bucketName: config.bucketName,
        outputKey: resolvedInput.outputKey,
        serveUrl: resolvedInput.serveUrl,
        propsHash: resolvedInput.propsHash,
        propKeys: resolvedInput.propKeys || null,
        overwrite: true,
        timeoutInMilliseconds: config.timeoutInMilliseconds,
        tuning,
        concurrencyPerLambda: config.concurrencyPerLambda,
      });

      await this.updateProgress(
        supabase,
        jobId,
        15,
        'Props externos resueltos; enviando solicitud al proveedor',
        'external_props_resolved',
        {
          provider_error: null,
          input_snapshot: {
            ...(resolvedInput.job.input_snapshot || {}),
            renderProvider: this.name,
            region: config.region,
            siteName: config.siteName,
            serveUrl: resolvedInput.serveUrl,
            renderMode: resolvedInput.renderMode,
            templateVersionId: resolvedInput.templateVersionId || null,
            buildId: resolvedInput.buildId || null,
            buildHash: resolvedInput.buildHash || null,
            compositionId: resolvedInput.compositionId,
            exportMode: resolvedInput.exportMode || 'component',
            propsHash: resolvedInput.propsHash,
            propsSource: resolvedInput.propsSource || null,
            resolvedProps: resolvedInput.inputProps,
            propKeys: resolvedInput.propKeys || [],
            outputStoragePath: `s3://${config.bucketName}/${resolvedInput.outputKey}`,
            lambdaRenderOptions: {
              overwrite: true,
              timeoutInMilliseconds: config.timeoutInMilliseconds,
            },
            lambdaTuning: {
              ...tuning,
              concurrencyPerLambda: config.concurrencyPerLambda,
            },
          },
        },
      );

      const result = await lambdaClient.renderMediaOnLambda(renderRequest);

      const renderId = this.readString(result.renderId) || this.readString(result.providerJobId);
      const bucketName = this.readString(result.bucketName) || config.bucketName;
      const outputStoragePath = `s3://${bucketName}/${resolvedInput.outputKey}`;
      const providerJobId = renderId || `${bucketName}:${resolvedInput.outputKey}`;
      const { data: currentJobBeforeAccepted } = await supabase
        .from('production_jobs')
        .select('progress')
        .eq('id', jobId)
        .maybeSingle();

      await supabase
        .from('production_jobs')
        .update({
          status: 'WAITING_PROVIDER',
          provider: 'remotion-lambda',
          provider_job_id: providerJobId,
          provider_request_id: renderId,
          progress: this.appendProgress(currentJobBeforeAccepted?.progress, {
            percent: 20,
            message: 'Render aceptado por Remotion Lambda',
            timestamp: new Date().toISOString(),
            stage: 'lambda_dispatch_accepted',
            provider: this.name,
            renderId,
          }),
          input_snapshot: {
            ...(resolvedInput.job.input_snapshot || {}),
            renderProvider: this.name,
            providerJobId,
            renderId,
            bucketName,
            region: config.region,
            siteName: config.siteName,
            serveUrl: resolvedInput.serveUrl,
            renderMode: resolvedInput.renderMode,
            templateVersionId: resolvedInput.templateVersionId || null,
            buildId: resolvedInput.buildId || null,
            buildHash: resolvedInput.buildHash || null,
            compositionId: resolvedInput.compositionId,
            exportMode: resolvedInput.exportMode || 'component',
            propsHash: resolvedInput.propsHash,
            propsSource: resolvedInput.propsSource || null,
            resolvedProps: resolvedInput.inputProps,
            propKeys: resolvedInput.propKeys || [],
            outputStoragePath,
            lambdaRenderOptions: {
              overwrite: true,
              timeoutInMilliseconds: config.timeoutInMilliseconds,
            },
            lambdaTuning: {
              ...tuning,
              concurrencyPerLambda: config.concurrencyPerLambda,
            },
          },
          output_snapshot: {
            ...(resolvedInput.job.output_snapshot || {}),
            completed: false,
            renderProvider: this.name,
            providerJobId,
            renderId,
            bucketName,
            region: config.region,
            siteName: config.siteName,
            outputStoragePath,
          },
        })
        .eq('id', jobId);

      console.log('[RemotionLambdaProvider] Render dispatched.', {
        jobId,
        organizationId: resolvedInput.job.organization_id,
        componentId: resolvedInput.job.material_component_id,
        templateId: resolvedInput.job.input_snapshot?.templateId,
        renderId,
        providerJobId,
        renderMode: resolvedInput.renderMode,
        compositionId: resolvedInput.compositionId,
        serveUrl: resolvedInput.serveUrl,
      });

      return {
        provider: this.name,
        status: 'WAITING_PROVIDER',
        providerJobId,
        message: 'Rendering job submitted to Remotion Lambda.',
      };
    } catch (error) {
      const safeMessage = this.sanitizeError(error);
      const { data: currentJobBeforeFailure } = await supabase
        .from('production_jobs')
        .select('progress')
        .eq('id', jobId)
        .maybeSingle();

      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: {
            code: this.classifyError(safeMessage),
            message: safeMessage,
            renderProvider: this.name,
            stage: 'dispatch',
            occurredAt: new Date().toISOString(),
          },
          progress: this.appendProgress(currentJobBeforeFailure?.progress, {
            percent: 20,
            message: `Fallo al enviar render a Remotion Lambda: ${safeMessage}`,
            timestamp: new Date().toISOString(),
            stage: 'dispatch_failed',
            provider: this.name,
          }),
        })
        .eq('id', jobId);

      console.error('[RemotionLambdaProvider] Dispatch failed.', { jobId, error: safeMessage });
      return {
        provider: this.name,
        status: 'FAILED',
        message: safeMessage,
      };
    }
  }

  private async resolveRenderInput(
    supabase: any,
    jobId: string,
    config: RemotionLambdaConfig,
  ): Promise<ResolvedLambdaRenderInput> {
    const { data: job, error: jobError } = await supabase
      .from('production_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Production job not found: ${jobError?.message || 'unknown error'}`);
    }

    const componentId = job.material_component_id;
    const templateId = job.input_snapshot?.templateId;
    if (!componentId || !templateId) {
      throw new Error('Production job is missing componentId or templateId.');
    }

    const { data: component, error: componentError } = await supabase
      .from('material_components')
      .select('*')
      .eq('id', componentId)
      .single();
    if (componentError || !component) {
      throw new Error(`Component not found: ${componentError?.message || 'unknown error'}`);
    }

    const { data: template, error: templateError } = await supabase
      .from('remotion_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    if (templateError || !template) {
      throw new Error(`Template not found: ${templateError?.message || 'unknown error'}`);
    }

    const variables = job.input_snapshot?.variables && typeof job.input_snapshot.variables === 'object'
      ? job.input_snapshot.variables
      : {};
    if (job.input_snapshot?.renderMode === 'EXTERNAL_SANDBOX_PREVIEW_ONLY') {
      throw new Error(
        'EXTERNAL_SANDBOX_NOT_SUPPORTED_IN_LAMBDA: Las plantillas ZIP/sandbox externo solo estan habilitadas para preview en Lambda. Selecciona una plantilla interna para el render final.',
      );
    }
    if (job.input_snapshot?.renderMode === 'EXTERNAL_CLOUD_BUILD_READY') {
      throw new Error(
        'EXTERNAL_CLOUD_BUILD_REQUIRED: La plantilla externa necesita un build cloud BUILT con serveUrl HTTPS antes del render final en Lambda.',
      );
    }

    if (job.input_snapshot?.renderMode === 'EXTERNAL_LAMBDA_SITE_READY') {
      const externalInput = await this.resolveExternalLambdaInput(supabase, {
        job,
        component,
        template,
        variables,
        config,
      });
      return externalInput;
    }

    const compositionId = resolveInternalCompositionId(template.composition_id);
    const templateConfig = mergeTemplateRenderConfigs(template.default_config, variables.templateConfig);
    const inputProps = buildAssemblyInputProps({
      assets: component.assets || {},
      compositionId,
      transitionType: variables.transitionType,
      templateConfig,
    });
    const propsHash = buildStableHash(inputProps);
    const orgSegment = job.organization_id || 'no-org';
    const outputKey = [
      'remotion-renders',
      process.env.NODE_ENV || 'development',
      orgSegment,
      `${jobId}.mp4`,
    ].join('/');

    if (!config.serveUrl) {
      throw new Error('REMOTION_LAMBDA_SERVE_URL is required to render on Lambda.');
    }

    return {
      job,
      component,
      template,
      compositionId,
      inputProps,
      propsHash,
      outputKey,
      serveUrl: config.serveUrl,
      renderMode: job.input_snapshot?.renderMode || 'INTERNAL_LAMBDA',
      exportMode: 'component',
    };
  }

  private async resolveExternalLambdaInput(
    supabase: any,
    params: {
      job: any;
      component: any;
      template: any;
      variables: Record<string, unknown>;
      config: RemotionLambdaConfig;
    },
  ): Promise<ResolvedLambdaRenderInput> {
    const templateVersionId = params.job.input_snapshot?.templateVersionId;
    const buildId = params.job.input_snapshot?.buildId;
    if (!templateVersionId || !buildId) {
      throw new Error('EXTERNAL_CLOUD_BUILD_REQUIRED: Missing templateVersionId or buildId for external Lambda render.');
    }

    const { data: version, error: versionError } = await supabase
      .from('remotion_template_versions')
      .select('*')
      .eq('id', templateVersionId)
      .single();
    if (versionError || !version) {
      throw new Error(`Template version not found for external Lambda render: ${versionError?.message || 'unknown error'}`);
    }

    const { data: build, error: buildError } = await supabase
      .from('remotion_template_builds')
      .select('*')
      .eq('id', buildId)
      .single();
    if (buildError || !build) {
      throw new Error(`Template cloud build not found: ${buildError?.message || 'unknown error'}`);
    }

    const target = resolveExternalLambdaRenderTarget({
      jobSnapshot: params.job.input_snapshot,
      version,
      build,
    });
    const propsResult = buildExternalTemplateProps({
      assets: params.component.assets || {},
      compositionId: target.compositionId,
      templateDefaultConfig: params.template.default_config,
      variables: params.variables,
      bundleDefaultProps: version.default_props,
      propsSchema: version.props_schema,
    });
    const outputKey = this.buildOutputKey(params.job.id, params.job.organization_id);

    return {
      job: params.job,
      component: params.component,
      template: params.template,
      compositionId: target.compositionId,
      inputProps: propsResult.resolvedProps,
      propsHash: propsResult.propsHash,
      outputKey,
      serveUrl: target.serveUrl,
      templateVersionId: target.templateVersionId,
      buildId: target.buildId,
      buildHash: target.buildHash,
      exportMode: target.exportMode,
      renderMode: 'EXTERNAL_LAMBDA_SITE_READY',
      propsSource: propsResult.propsSource,
      propKeys: propsResult.propKeys,
    };
  }

  private buildOutputKey(jobId: string, organizationId: string | null | undefined): string {
    const orgSegment = organizationId || 'no-org';
    return [
      'remotion-renders',
      process.env.NODE_ENV || 'development',
      orgSegment,
      `${jobId}.mp4`,
    ].join('/');
  }

  private loadLambdaClient(): LambdaClientModule {
    try {
      ensureAwsCredentialsEnv();
      // Loaded lazily so local development and tests do not require AWS Lambda tooling.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@remotion/lambda/client') as LambdaClientModule;
    } catch {
      throw new Error(
        'Missing @remotion/lambda. Install it in apps/api before enabling RENDER_PROVIDER=lambda.',
      );
    }
  }

  private resolveLambdaTuning(config: RemotionLambdaConfig): Record<string, number> {
    if (config.concurrency && config.framesPerLambda) {
      throw new Error(
        'Invalid Remotion Lambda tuning: configure only one of REMOTION_LAMBDA_CONCURRENCY or REMOTION_LAMBDA_FRAMES_PER_LAMBDA.',
      );
    }

    if (config.concurrency) {
      return { concurrency: config.concurrency };
    }

    if (config.framesPerLambda) {
      return { framesPerLambda: config.framesPerLambda };
    }

    return { framesPerLambda: 600 };
  }

  private async updateProgress(
    supabase: any,
    jobId: string,
    percent: number,
    message: string,
    stage: string,
    extraFields: Record<string, unknown> = {},
  ): Promise<void> {
    const { data: currentJob } = await supabase
      .from('production_jobs')
      .select('progress')
      .eq('id', jobId)
      .maybeSingle();

    await supabase
      .from('production_jobs')
      .update({
        progress: this.appendProgress(currentJob?.progress, {
          percent,
          message,
          timestamp: new Date().toISOString(),
          stage,
          provider: this.name,
        }),
        ...extraFields,
      })
      .eq('id', jobId);
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || 'Unknown render error');
    return message
      .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
      .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=[redacted]')
      .slice(0, 1000);
  }

  private appendProgress(
    currentProgress: unknown,
    entry: ProductionJobProgressEntry,
  ): ProductionJobProgressEntry[] {
    const previous = Array.isArray(currentProgress)
      ? currentProgress.filter((item): item is ProductionJobProgressEntry => Boolean(item && typeof item === 'object'))
      : [];

    return [...previous, entry].slice(-50);
  }

  private classifyError(message: string): string {
    const normalized = message.toLowerCase();
    if (normalized.includes('external_sandbox_not_supported_in_lambda')) {
      return 'EXTERNAL_SANDBOX_NOT_SUPPORTED_IN_LAMBDA';
    }
    if (normalized.includes('external_cloud_build_required')) {
      return 'EXTERNAL_CLOUD_BUILD_REQUIRED';
    }
    if (normalized.includes('external_build_not_ready')) {
      return 'EXTERNAL_BUILD_NOT_READY';
    }
    if (normalized.includes('external_render_target_incomplete')) {
      return 'EXTERNAL_RENDER_TARGET_INCOMPLETE';
    }
    if (normalized.includes('external_composition_id_missing')) {
      return 'EXTERNAL_COMPOSITION_ID_MISSING';
    }
    if (normalized.includes('external_props_invalid')) {
      return 'EXTERNAL_PROPS_INVALID';
    }
    if (normalized.includes('external_serve_url_mismatch')) {
      return 'EXTERNAL_SERVE_URL_MISMATCH';
    }
    if (normalized.includes('timed out') || normalized.includes('timeout')) {
      return 'LAMBDA_TIMEOUT';
    }
    if (normalized.includes('throttl') || normalized.includes('rate exceeded') || normalized.includes('concurrency')) {
      return 'LAMBDA_THROTTLED';
    }
    if (normalized.includes('props') || normalized.includes('asset')) {
      return 'INVALID_RENDER_PROPS';
    }
    return 'LAMBDA_RENDER_FAILED';
  }
}
