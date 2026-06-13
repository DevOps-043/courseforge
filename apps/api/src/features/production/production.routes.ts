import { Router } from 'express';
import { ProductionController } from './production.controller';

const router = Router();
const controller = new ProductionController();

router.post('/remotion/render', controller.renderRemotion.bind(controller));
router.get('/jobs/:jobId/status', controller.getJobStatus.bind(controller));

export const productionRoutes = router;
