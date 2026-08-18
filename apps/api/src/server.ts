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
import { getCorsOptions } from './config/cors';

// Las guardas globales evitan que una excepción o rechazo no manejado derribe
// silenciosamente el API legado de autenticación.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

const app = express();
const PORT = getApiPort();

app.use(helmet());
app.use(cors(getCorsOptions()));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRoutes);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
