import { createClient } from '@supabase/supabase-js';
import {
  buildAssemblyInputProps,
  resolveInternalCompositionId,
  type AssemblyInputProps,
} from './remotion-assembly-props.service';
import { buildStableHash, getRemotionRenderConfig, type RemotionLambdaConfig } from './remotion-render.config';
import { mergeTemplateRenderConfigs } from './template-render-config.service';
import type { RenderDispatchResult, RenderProvider } from './render-provider.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface LambdaClientModule {
  renderMediaOnLambda: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface ResolvedLambdaRenderInput {
  job: any;
  component: any;
  template: any;
  compositionId: string;
  inputProps: AssemblyInputProps;
  propsHash: string;
  outputKey: string;
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
      await this.updateProgress(supabase, jobId, 10, 'Enviando render a Remotion Lambda', {
        status: 'RUNNING',
        started_at: new Date().toISOString(),
      });

      const lambdaClient = this.loadLambdaClient();
      const result = await lambdaClient.renderMediaOnLambda({
        region: config.region,
        functionName: config.functionName,
        serveUrl: config.serveUrl,
        composition: resolvedInput.compositionId,
        inputProps: resolvedInput.inputProps as unknown as Record<string, unknown>,
        codec: 'h264',
        privacy: config.outputPrivacy,
        outName: {
          bucketName: config.bucketName,
          key: resolvedInput.outputKey,
        },
      });

      const renderId = this.readString(result.renderId) || this.readString(result.providerJobId);
      const bucketName = this.readString(result.bucketName) || config.bucketName;
      const outputStoragePath = `s3://${bucketName}/${resolvedInput.outputKey}`;
      const providerJobId = renderId || `${bucketName}:${resolvedInput.outputKey}`;

      await supabase
        .from('production_jobs')
        .update({
          status: 'WAITING_PROVIDER',
          provider: 'remotion-lambda',
          provider_job_id: providerJobId,
          provider_request_id: renderId,
          progress: [{ percent: 20, message: 'Render aceptado por Remotion Lambda', timestamp: new Date().toISOString() }],
          input_snapshot: {
            ...(resolvedInput.job.input_snapshot || {}),
            renderProvider: this.name,
            providerJobId,
            renderId,
            bucketName,
            region: config.region,
            siteName: config.siteName,
            compositionId: resolvedInput.compositionId,
            propsHash: resolvedInput.propsHash,
            outputStoragePath,
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
      });

      return {
        provider: this.name,
        status: 'WAITING_PROVIDER',
        providerJobId,
        message: 'Rendering job submitted to Remotion Lambda.',
      };
    } catch (error) {
      const safeMessage = this.sanitizeError(error);
      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: {
            message: safeMessage,
            renderProvider: this.name,
          },
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

    return { job, component, template, compositionId, inputProps, propsHash, outputKey };
  }

  private loadLambdaClient(): LambdaClientModule {
    try {
      // Loaded lazily so local development and tests do not require AWS Lambda tooling.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@remotion/lambda/client') as LambdaClientModule;
    } catch {
      throw new Error(
        'Missing @remotion/lambda. Install it in apps/api before enabling RENDER_PROVIDER=lambda.',
      );
    }
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
}
