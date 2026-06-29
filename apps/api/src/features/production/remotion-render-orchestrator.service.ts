import { getRemotionRenderConfig } from './remotion-render.config';
import { LocalRemotionProvider } from './local-remotion.provider';
import { RemotionLambdaProvider } from './remotion-lambda.provider';
import type { RenderDispatchResult, RenderProvider } from './render-provider.types';

export class RemotionRenderOrchestratorService {
  private readonly provider: RenderProvider;

  constructor() {
    const config = getRemotionRenderConfig();
    this.provider = config.provider === 'lambda'
      ? new RemotionLambdaProvider()
      : new LocalRemotionProvider();
  }

  get providerName() {
    return this.provider.name;
  }

  async dispatch(jobId: string): Promise<RenderDispatchResult> {
    return this.provider.dispatch(jobId);
  }
}

