import { Router } from 'express';
import { ProductionController } from './production.controller';

const router = Router();
const controller = new ProductionController();

router.post('/remotion/render', controller.renderRemotion.bind(controller));
router.get('/remotion/readiness', controller.getRemotionReadiness.bind(controller));
router.post('/remotion/external-preview', controller.getExternalBundlePreview.bind(controller));
router.post('/remotion/template-builds', controller.startTemplateCloudBuild.bind(controller));
router.get('/remotion/template-builds/:buildId/status', controller.getTemplateCloudBuildStatus.bind(controller));
router.get('/remotion/external-preview-renders/:fileName', controller.serveExternalPreviewRender.bind(controller));
router.get('/remotion/workers', controller.listDesktopWorkers.bind(controller));
router.post('/remotion/workers/link-codes', controller.createDesktopWorkerLinkCode.bind(controller));
router.post('/remotion/workers/link', controller.linkDesktopWorker.bind(controller));
router.post('/remotion/workers/register', controller.registerDesktopWorker.bind(controller));
router.post('/remotion/workers/heartbeat', controller.desktopWorkerHeartbeat.bind(controller));
router.post('/remotion/workers/jobs/claim-next', controller.claimNextDesktopWorkerJob.bind(controller));
router.post('/remotion/workers/jobs/:jobId/claim', controller.claimDesktopWorkerJob.bind(controller));
router.post('/remotion/workers/jobs/:jobId/progress', controller.reportDesktopWorkerProgress.bind(controller));
router.post('/remotion/workers/jobs/:jobId/complete', controller.completeDesktopWorkerJob.bind(controller));
router.post('/remotion/workers/jobs/:jobId/fail', controller.failDesktopWorkerJob.bind(controller));
router.get('/jobs/:jobId/status', controller.getJobStatus.bind(controller));

export const productionRoutes = router;
