import type { RenderDispatchResult, RenderProvider } from './render-provider.types';
import { createNodeSupabaseClient } from '../../core/supabase-client';

export class DesktopWorkerProvider implements RenderProvider {
  readonly name = 'desktop_worker' as const;

  constructor(
    private readonly supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    private readonly supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  ) {}

  async dispatch(_jobId: string): Promise<RenderDispatchResult> {
    if (this.supabaseUrl && this.supabaseServiceKey) {
      const supabase = createNodeSupabaseClient(this.supabaseUrl, this.supabaseServiceKey);
      const { error } = await supabase
        .from('production_jobs')
        .update({
          status: 'WAITING_PROVIDER',
          provider_job_id: null,
        })
        .eq('id', _jobId);

      if (error) {
        return {
          provider: this.name,
          status: 'FAILED',
          message: `Could not mark job as waiting for desktop worker: ${error.message}`,
        };
      }
    }

    return {
      provider: this.name,
      status: 'WAITING_PROVIDER',
      message: 'Rendering job is waiting for an authorized SofLIA - Engine desktop worker.',
    };
  }
}
