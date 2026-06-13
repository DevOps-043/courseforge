import dotenv from 'dotenv';
import path from 'path';

// Load environment variables before any other imports are evaluated
dotenv.config({ path: path.join(__dirname, '../../web/.env.local') });
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './core/middleware/errorHandler';
import { getApiPort } from './config/env';
import { authRoutes } from './features/auth/auth.routes';
import { productionRoutes } from './features/production/production.routes';
import { RemotionQueueService } from './features/production/remotion-queue.service';

// Guardas globales: una excepción/rechazo no manejado durante un render de Remotion
// no debe tumbar silenciosamente toda la API (lo que se manifiesta como "fetch failed"
// en el polling del cliente). Registramos y mantenemos el proceso vivo.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

const app = express();
const PORT = getApiPort();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/production', productionRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);

  // Pre-calienta el bundle de Remotion fuera de la ruta de petición para que el
  // primer ensamblado no sature el event-loop ni provoque fallos de polling.
  RemotionQueueService.getInstance()
    .prewarm()
    .catch((err) => console.warn('[API] Fallo al pre-calentar Remotion:', err));
});
