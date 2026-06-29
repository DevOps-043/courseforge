import { RemotionQueueService } from './remotion-queue.service';
import type { RenderDispatchResult, RenderProvider } from './render-provider.types';

export class LocalRemotionProvider implements RenderProvider {
  readonly name = 'local' as const;

  constructor(private readonly queueService = RemotionQueueService.getInstance()) {}

  async dispatch(jobId: string): Promise<RenderDispatchResult> {
    this.queueService.enqueue(jobId);

    return {
      provider: this.name,
      status: 'QUEUED',
      message: 'Rendering job queued in the local Remotion worker.',
    };
  }
}

