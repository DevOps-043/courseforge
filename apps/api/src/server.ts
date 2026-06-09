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
});
