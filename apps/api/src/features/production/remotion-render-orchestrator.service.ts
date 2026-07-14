import { getRemotionRenderConfig } from './remotion-render.config';
import { DesktopWorkerProvider } from './desktop-worker.provider';
import { LocalRemotionProvider } from './local-remotion.provider';
import { RemotionLambdaProvider } from './remotion-lambda.provider';
import type { RenderDispatchResult, RenderProvider } from './render-provider.types';

export class RemotionRenderOrchestratorService {
  private readonly provider: RenderProvider;

  constructor() {
    const config = getRemotionRenderConfig();
    if (config.provider === 'lambda') {
      this.provider = new RemotionLambdaProvider();
    } else if (config.provider === 'desktop_worker') {
      this.provider = new DesktopWorkerProvider();
    } else {
      this.provider = new LocalRemotionProvider();
    }
  }

  get providerName() {
    return this.provider.name;
  }

  async dispatch(jobId: string): Promise<RenderDispatchResult> {
    return this.provider.dispatch(jobId);
  }
}

