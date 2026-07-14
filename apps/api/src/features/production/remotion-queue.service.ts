import { fork } from 'child_process';
import * as path from 'path';
import { RemotionWorkerService } from './remotion-worker.service';
import { createNodeSupabaseClient } from '../../core/supabase-client';
import { classifyRemotionFailure } from './remotion-render-diagnostics.service';

/** Estados terminales: si el job ya está en uno, no lo tocamos como "huérfano". */
const TERMINAL_JOB_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/**
 * Cola secuencial de renders de Remotion.
 *
 * Cada render se ejecuta en un **proceso hijo aislado** (`remotion-render.process`)
 * vía `child_process.fork`, de modo que el bundling/encode pesado nunca bloquee
 * el event-loop de la API y un crash del motor de render no tumbe la API. La cola
 * procesa un job a la vez para acotar el consumo de CPU/memoria.
 */
export class RemotionQueueService {
  private static instance: RemotionQueueService | null = null;
  private queue: string[] = [];
  private isProcessing = false;
  private worker = new RemotionWorkerService();
  private supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  private supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  /** Bundle pre-calentado por la API; se pasa a los hijos para evitar re-bundlear. */
  private serveUrl: string | null = null;

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
    return createNodeSupabaseClient(this.supabaseUrl, this.supabaseServiceKey);
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

  /**
   * Pre-calienta el bundle de Remotion una sola vez en el proceso de la API y
   * guarda el `serveUrl` resultante para reutilizarlo en los procesos hijo, de
   * forma que ningún render pague el costo de bundling dentro de su ventana.
   */
  public async prewarm(): Promise<void> {
    this.serveUrl = await this.worker.prewarmBundle();
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
          await this.spawnRenderProcess(jobId);
        } catch (jobError) {
          console.error(`[RemotionQueue] Uncaught error running job ${jobId}:`, jobError);
          await this.failJobIfUnfinished(jobId, 'Error inesperado al orquestar el render');
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Lanza el render en un proceso hijo aislado y resuelve cuando el hijo termina.
   * El hijo persiste su propio resultado (SUCCEEDED/FAILED) en DB; aquí solo
   * cubrimos el caso de muerte inesperada marcando el job como FAILED.
   */
  private spawnRenderProcess(jobId: string): Promise<void> {
    return new Promise((resolve) => {
      const childModule = this.resolveChildModulePath();
      const execArgv = this.resolveChildExecArgv(childModule);
      const args = this.serveUrl ? [jobId, this.serveUrl] : [jobId];

      const child = fork(childModule, args, {
        execArgv,
        // Hereda env (credenciales Supabase) y propaga logs del hijo a la consola.
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      });

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      child.on('exit', async (code) => {
        if (code !== 0) {
          console.error(`[RemotionQueue] Render process for job ${jobId} exited with code ${code}.`);
          await this.failJobIfUnfinished(jobId, `El proceso de render terminó con código ${code}`);
        } else {
          console.log(`[RemotionQueue] Render process for job ${jobId} finished cleanly.`);
        }
        settle();
      });

      child.on('error', async (err) => {
        console.error(`[RemotionQueue] Failed to spawn render process for job ${jobId}:`, err);
        await this.failJobIfUnfinished(jobId, `No se pudo lanzar el proceso de render: ${err.message}`);
        settle();
      });
    });
  }

  /**
   * Ruta al entry del proceso hijo. En dev corre como `.ts` (bajo ts-node-dev);
   * en producción como `.js` compilado en `dist`. `__filename` revela cuál.
   */
  private resolveChildModulePath(): string {
    const isTs = __filename.endsWith('.ts');
    return path.join(__dirname, `remotion-render.process.${isTs ? 'ts' : 'js'}`);
  }

  /**
   * En dev hay que registrar ts-node en el hijo para ejecutar TypeScript. Se
   * resuelve el `register` que trae ts-node-dev (garantizado en dev) para no
   * añadir dependencias. En producción (.js) no se requiere ningún loader.
   */
  private resolveChildExecArgv(childModule: string): string[] {
    if (!childModule.endsWith('.ts')) {
      return [];
    }

    const searchPaths = [process.cwd(), __dirname];
    try {
      searchPaths.push(path.dirname(require.resolve('ts-node-dev')));
    } catch {
      // ts-node-dev no resoluble; intentaremos con los paths por defecto.
    }

    for (const candidate of ['ts-node/register/transpile-only', 'ts-node/register']) {
      try {
        const registerPath = require.resolve(candidate, { paths: searchPaths });
        return ['-r', registerPath];
      } catch {
        // probar siguiente candidato
      }
    }

    console.warn('[RemotionQueue] No se encontró ts-node para el proceso hijo; el render podría fallar en dev.');
    return [];
  }

  /**
   * Marca un job como FAILED solo si no quedó en estado terminal. Cubre la muerte
   * inesperada del proceso hijo (crash/kill) para que el cliente deje de hacer
   * polling indefinidamente y reciba un estado de error claro.
   */
  private async failJobIfUnfinished(jobId: string, message: string): Promise<void> {
    try {
      const supabase = this.getSupabaseClient();
      const { data: job } = await supabase
        .from('production_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) {
        return;
      }

      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: {
            code: classifyRemotionFailure(message, { provider: 'local', stage: 'process' }),
            message,
            renderProvider: 'local',
            stage: 'process',
          },
        })
        .eq('id', jobId);
    } catch (err) {
      console.error(`[RemotionQueue] No se pudo marcar el job ${jobId} como FAILED:`, err);
    }
  }
}
