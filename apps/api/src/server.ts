import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { errorHandler } from './core/middleware/errorHandler';
import { getApiPort } from './config/env';
import { authRoutes } from './features/auth/auth.routes';

dotenv.config();

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

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
