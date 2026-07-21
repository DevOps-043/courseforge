export type RemotionRenderProviderName = 'local' | 'desktop_worker';

export interface RenderDispatchResult {
  provider: RemotionRenderProviderName;
  status: 'QUEUED' | 'WAITING_PROVIDER' | 'FAILED';
  providerJobId?: string | null;
  message: string;
}

export interface RenderProvider {
  readonly name: RemotionRenderProviderName;
  dispatch(jobId: string): Promise<RenderDispatchResult>;
}

