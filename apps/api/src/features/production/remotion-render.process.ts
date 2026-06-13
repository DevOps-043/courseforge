/**
 * Entry de proceso hijo para renders de Remotion.
 *
 * Se ejecuta en un proceso Node separado (lanzado por `RemotionQueueService`
 * vía `child_process.fork`). Aislar el render aquí garantiza que:
 *  - el bundling/encode CPU-intensivo nunca bloquee el event-loop de la API
 *    (lo que se manifestaba como "fetch failed" en el polling del cliente), y
 *  - un crash del motor de render (Chrome/native) tumbe solo este proceso,
 *    nunca la API.
 *
 * El proceso hereda las variables de entorno de la API (fork las propaga por
 * defecto), por lo que dispone de las credenciales de Supabase sin recargar
 * dotenv. Argumentos: [jobId, serveUrl?].
 *
 * Códigos de salida: 0 = render completado; 1 = render falló (el worker ya
 * marcó el job como FAILED en DB); 2 = argumentos inválidos.
 */
import { RemotionWorkerService } from './remotion-worker.service';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  const serveUrl = process.argv[3] || process.env.REMOTION_SERVE_URL || undefined;

  if (!jobId) {
    console.error('[RemotionRenderProcess] Falta el argumento jobId.');
    process.exit(2);
  }

  const worker = new RemotionWorkerService();
  try {
    await worker.runRenderJob(jobId, serveUrl);
    process.exit(0);
  } catch (err) {
    // runRenderJob captura y persiste sus propios errores; esto es una última
    // red de seguridad ante fallos inesperados fuera de ese try/catch.
    console.error(`[RemotionRenderProcess] Error fatal renderizando job ${jobId}:`, err);
    process.exit(1);
  }
}

void main();
