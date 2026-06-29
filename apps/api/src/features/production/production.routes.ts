import { Router } from 'express';
import { ProductionController } from './production.controller';

const router = Router();
const controller = new ProductionController();

router.post('/remotion/render', controller.renderRemotion.bind(controller));
router.get('/remotion/readiness', controller.getRemotionReadiness.bind(controller));
router.post('/remotion/external-preview', controller.getExternalBundlePreview.bind(controller));
router.get('/remotion/external-preview-renders/:fileName', controller.serveExternalPreviewRender.bind(controller));
router.get('/remotion/external-preview-bundles/:buildId/*', controller.serveExternalPreviewBundle.bind(controller));
router.get('/remotion/external-preview-bundles/:buildId', controller.serveExternalPreviewBundle.bind(controller));
router.get('/jobs/:jobId/status', controller.getJobStatus.bind(controller));

export const productionRoutes = router;
