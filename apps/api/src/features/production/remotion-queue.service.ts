import { RemotionWorkerService } from './remotion-worker.service';
import { createClient } from '@supabase/supabase-js';

export class RemotionQueueService {
  private static instance: RemotionQueueService | null = null;
  private queue: string[] = [];
  private isProcessing = false;
  private worker = new RemotionWorkerService();
  private supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  private supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  private constructor() {
    // Automatically load unfinished jobs on startup
    this.initQueue().catch((err) => {
      console.error('[RemotionQueue] Failed to initialize queue from DB:', err);
    });
  }

  public static getInstance(): RemotionQueueService {
    if (!RemotionQueueService.instance) {
      RemotionQueueService.instance = new RemotionQueueService();
    }
    return RemotionQueueService.instance;
  }

  private getSupabaseClient() {
    return createClient(this.supabaseUrl, this.supabaseServiceKey);
  }

  private async initQueue() {
    const supabase = this.getSupabaseClient();
    const { data: pendingJobs, error } = await supabase
      .from('production_jobs')
      .select('id')
      .in('status', ['PENDING', 'QUEUED'])
      .eq('job_type', 'REMOTION_RENDER')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[RemotionQueue] Error fetching pending jobs on startup:', error);
      return;
    }

    if (pendingJobs && pendingJobs.length > 0) {
      console.log(`[RemotionQueue] Found ${pendingJobs.length} pending jobs on startup. Enqueueing them...`);
      for (const job of pendingJobs) {
        this.queue.push(job.id);
      }
      this.processQueue();
    }
  }

  public enqueue(jobId: string) {
    if (this.queue.includes(jobId)) {
      console.log(`[RemotionQueue] Job ${jobId} is already in the queue.`);
      return;
    }
    this.queue.push(jobId);
    console.log(`[RemotionQueue] Job ${jobId} enqueued. Queue length: ${this.queue.length}`);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        const jobId = this.queue.shift();
        if (!jobId) continue;

        console.log(`[RemotionQueue] Starting job: ${jobId}. Remaining in queue: ${this.queue.length}`);
        
        try {
          // Set status to RUNNING via the worker
          await this.worker.runRenderJob(jobId);
        } catch (jobError) {
          console.error(`[RemotionQueue] Uncaught error running job ${jobId}:`, jobError);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
