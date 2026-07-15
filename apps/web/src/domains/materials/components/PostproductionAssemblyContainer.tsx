'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Copy, Download, Film, Layers, Link2, Loader2, Monitor, Play, RefreshCw, Search, Sparkles, Square, Unlink } from 'lucide-react';
import { hasPreviewableAssets } from '@/remotion/buildAssemblyProps';
import { deriveAssemblyTargetDurationSeconds } from '@/remotion/assembly-duration';
import { getTemplatesAction, type RemotionTemplate } from '@/domains/production/actions/templates.actions';
import {
    assembleRemotionVideoAction,
    cancelRemotionAssemblyJobsAction,
    createRenderWorkerLinkCodeAction,
    deleteFinalVideoForPublicationAction,
    getRemotionJobStatusAction,
    getRenderWorkerStatusAction,
    revokeRenderWorkerAction,
    type RenderWorkerStatusView,
} from '../actions/production.actions';
import { useMaterials } from '../hooks/useMaterials';
import { PRODUCTION_THEME } from './production-asset-ui';
import { RemotionExternalPreviewPlayer } from './RemotionExternalPreviewPlayer';
import { RemotionPreviewPlayer } from './RemotionPreviewPlayer';

interface PostproductionAssemblyContainerProps {
    artifactId: string;
    onNext?: () => void;
    profile?: unknown;
}

type AssemblyJobStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING_PROVIDER' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
const ASSEMBLY_JOBS_STORAGE_PREFIX = 'courseforge:remotion-assembly-jobs';

interface AssemblyJobTracker {
    componentId: string;
    jobId: string;
    label: string;
    status: AssemblyJobStatus;
    progress: number;
    finalVideoUrl?: string;
    error?: string;
    errorCode?: string;
    lastLog?: string;
    completedSynced?: boolean;
}

interface RenderWorkerStatusState {
    apiUrl?: string;
    renderProvider?: string | null;
    requiresDesktopWorker: boolean;
    workers: RenderWorkerStatusView[];
}

interface WorkerLinkCodeState {
    code: string;
    apiUrl?: string;
    expiresAt?: string;
}

function isTerminalStatus(status: AssemblyJobStatus) {
    return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';
}

function getComponentLabel(component: any) {
    return component.lessonTitle || (component.content as any)?.title || 'Video';
}

function getAssemblyFailureMessage(job: AssemblyJobTracker) {
    if (job.errorCode === 'OUTPUT_NOT_ACCESSIBLE') {
        return 'El render termino, pero el video final no quedo disponible como URL HTTPS reproducible.';
    }
    if (job.errorCode === 'LAMBDA_TIMEOUT') {
        return 'El render supero el tiempo maximo configurado en Lambda.';
    }
    if (job.errorCode === 'LAMBDA_THROTTLED') {
        return 'AWS limito la concurrencia del render. Reintenta cuando termine la cola o reduce concurrencia.';
    }
    return job.error || 'El ensamblado no se completo. Revisa el ultimo evento del job.';
}

export function PostproductionAssemblyContainer({ artifactId, onNext }: PostproductionAssemblyContainerProps) {
    const router = useRouter();
    const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
    const assemblyJobsStorageKey = `${ASSEMBLY_JOBS_STORAGE_PREFIX}:${artifactId}`;
    const [templates, setTemplates] = useState<RemotionTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [isAssembling, setIsAssembling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [loadingComponents, setLoadingComponents] = useState(true);
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [videoComponents, setVideoComponents] = useState<any[]>([]);
    const [activePreviewId, setActivePreviewId] = useState<string>('');
    const [templateSearch, setTemplateSearch] = useState('');
    const [assemblyJobs, setAssemblyJobs] = useState<AssemblyJobTracker[]>([]);
    const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
    const [stoppingAssembly, setStoppingAssembly] = useState(false);
    const [workerStatus, setWorkerStatus] = useState<RenderWorkerStatusState | null>(null);
    const [workerStatusError, setWorkerStatusError] = useState<string | null>(null);
    const [loadingWorkerStatus, setLoadingWorkerStatus] = useState(true);
    const [workerLinkCode, setWorkerLinkCode] = useState<WorkerLinkCodeState | null>(null);
    const [creatingWorkerLink, setCreatingWorkerLink] = useState(false);
    const [revokingWorkerId, setRevokingWorkerId] = useState<string | null>(null);
    const [copiedWorkerCode, setCopiedWorkerCode] = useState(false);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollingInFlightRef = useRef(false);
    const pollFailuresRef = useRef(0);
    const assemblyJobsRef = useRef<AssemblyJobTracker[]>([]);
    const hydratedAssemblyJobsRef = useRef(false);
    const POLL_INTERVAL_MS = 1500;
    const MAX_CONSECUTIVE_POLL_FAILURES = 40;
    const workerDownloadUrl = process.env.NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_URL || '';
    const workerDownloadHref = workerDownloadUrl || '/downloads';

    const persistTrackedJobs = (jobs: AssemblyJobTracker[]) => {
        if (typeof window === 'undefined') return;

        const activeJobs = jobs.filter((job) => !isTerminalStatus(job.status));
        if (activeJobs.length === 0) {
            window.sessionStorage.removeItem(assemblyJobsStorageKey);
            return;
        }

        window.sessionStorage.setItem(
            assemblyJobsStorageKey,
            JSON.stringify({
                artifactId,
                savedAt: new Date().toISOString(),
                jobs: activeJobs,
            }),
        );
    };

    const setTrackedJobs = (updater: (jobs: AssemblyJobTracker[]) => AssemblyJobTracker[]) => {
        const nextJobs = updater(assemblyJobsRef.current);
        assemblyJobsRef.current = nextJobs;
        setAssemblyJobs(nextJobs);
        persistTrackedJobs(nextJobs);

        if (nextJobs.length > 0) {
            const totalProgress = nextJobs.reduce((sum, job) => sum + job.progress, 0);
            setProgress(Math.round(totalProgress / nextJobs.length));
        }
    };

    const stopPolling = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        pollingInFlightRef.current = false;
    };

    const clearPersistedAssemblyJobs = () => {
        if (typeof window === 'undefined') return;
        window.sessionStorage.removeItem(assemblyJobsStorageKey);
    };

    const loadWorkerStatus = async () => {
        setLoadingWorkerStatus(true);
        const result = await getRenderWorkerStatusAction(artifactId);
        if (result.success) {
            setWorkerStatus({
                apiUrl: result.apiUrl,
                renderProvider: result.renderProvider,
                requiresDesktopWorker: Boolean(result.requiresDesktopWorker),
                workers: result.workers || [],
            });
            setWorkerStatusError(null);
        } else {
            setWorkerStatusError(result.error || 'No se pudo consultar el worker local.');
        }
        setLoadingWorkerStatus(false);
    };

    const handleCreateWorkerLinkCode = async () => {
        setCreatingWorkerLink(true);
        const result = await createRenderWorkerLinkCodeAction(artifactId);
        if (result.success && result.code) {
            setWorkerLinkCode({
                code: result.code,
                apiUrl: result.apiUrl,
                expiresAt: result.expiresAt,
            });
            setWorkerStatusError(null);
        } else {
            setWorkerStatusError(result.error || 'No se pudo crear el codigo de vinculacion.');
        }
        setCreatingWorkerLink(false);
    };

    const handleRevokeWorker = async (workerId: string) => {
        setRevokingWorkerId(workerId);
        const result = await revokeRenderWorkerAction(artifactId, workerId);
        if (result.success) {
            setWorkerStatusError(null);
            await loadWorkerStatus();
        } else {
            setWorkerStatusError(result.error || 'No se pudo desvincular el worker.');
        }
        setRevokingWorkerId(null);
    };

    const handleCopyWorkerCode = async () => {
        if (!workerLinkCode?.code) return;
        try {
            await navigator.clipboard.writeText(workerLinkCode.code);
            setCopiedWorkerCode(true);
            setTimeout(() => setCopiedWorkerCode(false), 1800);
        } catch {
            setWorkerStatusError('No se pudo copiar el codigo. Seleccionalo manualmente.');
        }
    };

    const handleStopAssembly = async () => {
        const activeJobIds = assemblyJobsRef.current
            .filter((job) => !isTerminalStatus(job.status) && !job.jobId.startsWith('failed-trigger-'))
            .map((job) => job.jobId);

        if (activeJobIds.length === 0) {
            stopPolling();
            setIsAssembling(false);
            return;
        }

        setStoppingAssembly(true);
        const result = await cancelRemotionAssemblyJobsAction(artifactId, activeJobIds);
        if (result.success) {
            stopPolling();
            setIsAssembling(false);
            setProgress(0);
            setTrackedJobs((jobs) =>
                jobs.map((job) =>
                    activeJobIds.includes(job.jobId)
                        ? {
                            ...job,
                            status: 'CANCELLED',
                            error: 'El ensamblado fue detenido desde SofLIA - Engine.',
                            errorCode: 'USER_CANCELLED',
                        }
                        : job,
                ),
            );
            await refresh();
            router.refresh();
        } else {
            setWorkerStatusError(result.error || 'No se pudo detener el ensamblado.');
        }
        setStoppingAssembly(false);
    };

    useEffect(() => {
        void loadWorkerStatus();
        const interval = setInterval(() => {
            void loadWorkerStatus();
        }, 15000);
        return () => clearInterval(interval);
    }, [artifactId]);

    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, []);

    useEffect(() => {
        if (videoComponents.length > 0 && !activePreviewId) {
            const firstWithVideo = videoComponents.find((component) => component.assets?.final_video_url);
            setActivePreviewId(firstWithVideo?.id || videoComponents[0].id);
        }
    }, [videoComponents, activePreviewId]);

    useEffect(() => {
        const fetchTemplates = async () => {
            setLoadingTemplates(true);
            try {
                const result = await getTemplatesAction();
                if (result.success && result.templates) {
                    setTemplates(result.templates);
                    if (result.templates.length > 0) {
                        setSelectedTemplate(result.templates[0].id);
                    }
                }
            } catch (err) {
                console.error('Error fetching templates:', err);
            } finally {
                setLoadingTemplates(false);
            }
        };
        fetchTemplates();
    }, []);

    useEffect(() => {
        const fetchVideoComponents = async () => {
            if (!materials?.lessons) return;
            setLoadingComponents(true);
            try {
                const allCompPromises = materials.lessons.map(async (lesson) => {
                    const comps = await getLessonComponents(lesson.id);
                    return comps
                        .filter((component) => component.type.includes('VIDEO'))
                        .map((component) => ({
                            ...component,
                            lessonTitle: lesson.lesson_title,
                        }));
                });
                const results = await Promise.all(allCompPromises);
                setVideoComponents(results.flat());
            } catch (err) {
                console.error('Error fetching video components:', err);
            } finally {
                setLoadingComponents(false);
            }
        };
        fetchVideoComponents();
    }, [materials, getLessonComponents]);

    const pollAssemblyJobs = () => {
        stopPolling();

        const handleTransientFailure = (detail: unknown) => {
            pollFailuresRef.current += 1;
            setIsReconnecting(true);
            if (pollFailuresRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
                stopPolling();
                setIsAssembling(false);
                setIsReconnecting(false);
                alert(
                    'Se perdio la conexion con el motor de render por demasiado tiempo. ' +
                    'El ensamblado puede seguir en curso en segundo plano: refresca la pagina en unos minutos para ver el resultado.',
                );
                return;
            }
            console.warn(
                `[Remotion] Poll de estado fallo (intento ${pollFailuresRef.current}/${MAX_CONSECUTIVE_POLL_FAILURES}). Reintentando...`,
                detail,
            );
        };

        const pollInterval = setInterval(async () => {
            if (pollingInFlightRef.current) return;
            pollingInFlightRef.current = true;

            try {
                const nextJobs = [...assemblyJobsRef.current];

                for (let index = 0; index < nextJobs.length; index += 1) {
                    const trackedJob = nextJobs[index];
                    if (isTerminalStatus(trackedJob.status)) continue;

                    const statusResult = await getRemotionJobStatusAction(trackedJob.jobId);
                    if (!statusResult.success || !statusResult.job) {
                        handleTransientFailure(statusResult.error);
                        continue;
                    }

                    pollFailuresRef.current = 0;
                    setIsReconnecting(false);

                    const job = statusResult.job;
                    const status = job.status as AssemblyJobStatus;
                    let jobProgress = trackedJob.progress;
                    if (Array.isArray(job.progress) && job.progress.length > 0) {
                        const lastProgress = job.progress[job.progress.length - 1];
                        if (typeof lastProgress?.percent === 'number') {
                            jobProgress = lastProgress.percent;
                        }
                    }
                    const lastLog = Array.isArray(job.progress) && job.progress.length > 0
                        ? job.progress[job.progress.length - 1]?.message
                        : trackedJob.lastLog;

                    const finalVideoUrl = job.output_snapshot?.final_video_url || trackedJob.finalVideoUrl;
                    nextJobs[index] = {
                        ...trackedJob,
                        status,
                        progress: status === 'SUCCEEDED' ? 100 : jobProgress,
                        finalVideoUrl,
                        lastLog: typeof lastLog === 'string' ? lastLog : trackedJob.lastLog,
                        error: job.provider_error?.message || trackedJob.error,
                        errorCode: job.provider_error?.code || trackedJob.errorCode,
                    };
                }

                setTrackedJobs(() => nextJobs);

                const allFinished = nextJobs.every((job) => isTerminalStatus(job.status));
                if (allFinished) {
                    stopPolling();
                    await refresh();
                    router.refresh();
                    setIsAssembling(false);
                    setIsReconnecting(false);

                    const failedJobs = nextJobs.filter((job) => job.status === 'FAILED' || job.status === 'CANCELLED');
                    if (failedJobs.length > 0) {
                        alert(`${failedJobs.length} ensamblado(s) no se completaron. ${getAssemblyFailureMessage(failedJobs[0])}`);
                    }
                }
            } catch (pollErr) {
                handleTransientFailure(pollErr);
            } finally {
                pollingInFlightRef.current = false;
            }
        }, POLL_INTERVAL_MS);

        pollIntervalRef.current = pollInterval;
    };

    useEffect(() => {
        if (hydratedAssemblyJobsRef.current || loadingComponents) return;
        hydratedAssemblyJobsRef.current = true;

        try {
            const rawPersistedJobs = window.sessionStorage.getItem(assemblyJobsStorageKey);
            if (!rawPersistedJobs) return;

            const parsed = JSON.parse(rawPersistedJobs) as {
                artifactId?: string;
                jobs?: AssemblyJobTracker[];
            };
            const persistedJobs = Array.isArray(parsed.jobs)
                ? parsed.jobs.filter((job) => job?.jobId && !isTerminalStatus(job.status))
                : [];

            if (parsed.artifactId !== artifactId || persistedJobs.length === 0) {
                clearPersistedAssemblyJobs();
                return;
            }

            const hydratedJobs = persistedJobs.map((job) => {
                const currentComponent = videoComponents.find((component) => component.id === job.componentId);
                return {
                    ...job,
                    label: currentComponent ? getComponentLabel(currentComponent) : job.label,
                };
            });

            setIsAssembling(true);
            setIsReconnecting(false);
            pollFailuresRef.current = 0;
            setTrackedJobs(() => hydratedJobs);
            pollAssemblyJobs();
        } catch (error) {
            console.warn('[Remotion] No se pudo restaurar el progreso de ensamblado.', error);
            clearPersistedAssemblyJobs();
        }
    }, [artifactId, assemblyJobsStorageKey, loadingComponents, videoComponents]);

    const availableDesktopWorkers = workerStatus?.workers.filter((worker) =>
        worker.status === 'ONLINE' || worker.status === 'BUSY',
    ) || [];
    const visibleDesktopWorkers = workerStatus?.workers.filter((worker) => worker.status !== 'REVOKED') || [];
    const workerGateBlocked = Boolean(workerStatus?.requiresDesktopWorker && availableDesktopWorkers.length === 0);
    const workerGateMessage = 'Vincula y enciende un worker local antes de ensamblar con desktop_worker.';

    const startAssemblyForComponents = async (targets: any[]) => {
        if (targets.length === 0) return;
        if (workerGateBlocked) {
            alert(workerGateMessage);
            return;
        }
        setIsAssembling(true);
        setProgress(0);
        setIsReconnecting(false);
        stopPolling();
        pollFailuresRef.current = 0;
        assemblyJobsRef.current = [];
        setAssemblyJobs([]);

        try {
            const startedJobs: AssemblyJobTracker[] = [];

            for (const component of targets) {
                const triggerResult = await assembleRemotionVideoAction(component.id, selectedTemplate, {
                    template: selectedTemplate,
                    videoComponentsCount: targets.length,
                    componentTitle: getComponentLabel(component),
                    templateConfig: selectedTemplateConfig?.default_config || {},
                    transitionType: selectedTemplateConfig?.default_config?.transitionType,
                });

                if (!triggerResult.success || !triggerResult.jobId) {
                    startedJobs.push({
                        componentId: component.id,
                        jobId: `failed-trigger-${component.id}`,
                        label: getComponentLabel(component),
                        status: 'FAILED',
                        progress: 0,
                        error: triggerResult.error || 'Error desconocido al iniciar el job',
                        errorCode: (triggerResult as any).code,
                    });
                    continue;
                }

                startedJobs.push({
                    componentId: component.id,
                    jobId: triggerResult.jobId,
                    label: getComponentLabel(component),
                    status: (triggerResult.status as AssemblyJobStatus) || 'PENDING',
                    progress: 5,
                });
            }

            setTrackedJobs(() => startedJobs);
            const hasRunnableJobs = startedJobs.some((job) => !job.jobId.startsWith('failed-trigger-'));

            if (!hasRunnableJobs) {
                setIsAssembling(false);
                const firstError = startedJobs.find((job) => job.error)?.error;
                alert(
                    firstError
                        ? `No se pudo iniciar ningun ensamblado. ${firstError}`
                        : 'No se pudo iniciar ningun ensamblado.',
                );
                return;
            }

            pollAssemblyJobs();
        } catch (err) {
            console.error(err);
            setIsAssembling(false);
        }
    };

    const componentsToAssemble = videoComponents.filter((component) => !component.assets?.final_video_url);
    const selectedTemplateConfig = templates.find((template) => template.id === selectedTemplate);
    const selectedTemplateSlug = selectedTemplateConfig?.render_composition_id ?? selectedTemplateConfig?.composition_id ?? null;
    const selectedTemplateUsesExternalBundle = selectedTemplateConfig?.render_mode === 'EXTERNAL_BUNDLE_PENDING'
        || selectedTemplateConfig?.render_mode === 'INTERNAL_WITH_EXTERNAL_REFERENCE';
    const selectedTemplateUsesCloudBundle = selectedTemplateConfig?.render_mode === 'EXTERNAL_LAMBDA_SITE_READY';
    const selectedTemplateUsesExternalPreview = selectedTemplateUsesCloudBundle;
    const selectedCloudPreviewData = useMemo(() => {
        if (!selectedTemplateUsesCloudBundle || !selectedTemplateConfig?.cloud_build_serve_url) {
            return null;
        }

        const compositionId = selectedTemplateConfig.cloud_build_composition_id
            || selectedTemplateConfig.render_composition_id
            || selectedTemplateConfig.composition_id;

        if (!compositionId) {
            return null;
        }

        return {
            serveUrl: selectedTemplateConfig.cloud_build_serve_url,
            compositionId,
            exportMode: 'component' as const,
            resolvedProps: {},
            propsHash: selectedTemplateConfig.cloud_build_id || `${selectedTemplateConfig.id}:${compositionId}`,
            buildHash: null,
            buildId: selectedTemplateConfig.cloud_build_id || null,
            templateVersionId: selectedTemplateConfig.cloud_build_id || selectedTemplateConfig.id,
            bundleHash: null,
            previewVideoUrl: null,
            previewPosterUrl: null,
            previewDurationSeconds: null,
            previewFrames: null,
            compositionDurationSeconds: null,
            compositionFrames: null,
        };
    }, [
        selectedTemplateConfig?.cloud_build_composition_id,
        selectedTemplateConfig?.cloud_build_id,
        selectedTemplateConfig?.cloud_build_serve_url,
        selectedTemplateConfig?.composition_id,
        selectedTemplateConfig?.id,
        selectedTemplateConfig?.render_composition_id,
        selectedTemplateUsesCloudBundle,
    ]);
    const selectedTemplateNeedsCloudBuild = selectedTemplateConfig?.render_mode === 'EXTERNAL_CLOUD_BUILD_READY'
        || selectedTemplateConfig?.render_mode === 'EXTERNAL_CLOUD_BUILD_FAILED';
    const selectedTemplateBlocksFinalRender = selectedTemplateNeedsCloudBuild;
    const activePreview = videoComponents.find((component) => component.id === activePreviewId) || videoComponents[0];
    const activePreviewTargetDurationSeconds = deriveAssemblyTargetDurationSeconds(activePreview?.content);
    const activePreviewPending = Boolean(activePreview && !activePreview.assets?.final_video_url);
    const hasRequiredAssets = videoComponents.length > 0;
    const hasComponentsToAssemble = componentsToAssemble.length > 0;
    const isCompleted = videoComponents.length > 0 && componentsToAssemble.length === 0;
    const activeAssemblyJobs = assemblyJobs.filter((job) => !isTerminalStatus(job.status));
    const showGlobalAssemblyProgress = isAssembling || activeAssemblyJobs.length > 0;
    const currentAssemblyLabel = activeAssemblyJobs.length === 1
        ? activeAssemblyJobs[0].label
        : `${activeAssemblyJobs.length || assemblyJobs.length} videos`;
    const filteredTemplates = useMemo(() => {
        const search = templateSearch.trim().toLowerCase();

        return templates.filter((tpl) => {
            if (!search) return true;

            const searchableText = [
                tpl.name,
                tpl.description,
                tpl.composition_id,
                tpl.render_composition_id,
                tpl.render_status_label,
                tpl.bundle_status,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            return searchableText.includes(search);
        });
    }, [templates, templateSearch]);
    const basicTemplates = filteredTemplates.filter((tpl) => !tpl.storage_path && !tpl.is_external_bundle_supported);
    const advancedTemplates = filteredTemplates.filter((tpl) => tpl.storage_path || tpl.is_external_bundle_supported);
    const hasFilteredTemplates = filteredTemplates.length > 0;
    const externalPreviewVariables = useMemo(() => {
        if (!activePreview || !selectedTemplateUsesExternalPreview) {
            return {};
        }

        return {
            template: selectedTemplate,
            componentTitle: getComponentLabel(activePreview),
            templateConfig: selectedTemplateConfig?.default_config || {},
            transitionType: selectedTemplateConfig?.default_config?.transitionType,
        };
    }, [
        activePreview,
        selectedTemplate,
        selectedTemplateConfig?.default_config,
        selectedTemplateUsesExternalPreview,
    ]);

    const handleAssembleSelected = async () => {
        if (!activePreview || !activePreviewPending) {
            alert('Selecciona un video pendiente de ensamblado.');
            return;
        }
        if (selectedTemplateBlocksFinalRender) {
            alert('Esta plantilla solo permite preview externo por ahora. Selecciona una plantilla basica interna para ensamblar el video final.');
            return;
        }
        await startAssemblyForComponents([activePreview]);
    };

    const handleAssembleAll = async () => {
        if (selectedTemplateBlocksFinalRender) {
            alert('Esta plantilla solo permite preview externo por ahora. Selecciona una plantilla basica interna para ensamblar videos finales.');
            return;
        }
        await startAssemblyForComponents(componentsToAssemble);
    };

    const handleDeleteFinalVideo = async (component: any) => {
        if (!component?.id || !component.assets?.final_video_url) return;

        const confirmed = window.confirm(
            'Esto eliminara el video final de esta leccion y quitara el mapping de publicacion. Podras volver a ensamblarlo despues. Deseas continuar?',
        );
        if (!confirmed) return;

        setDeletingVideoId(component.id);
        try {
            const result = await deleteFinalVideoForPublicationAction(component.id);
            if (!result.success) {
                alert(result.error || 'No se pudo eliminar el video final.');
                return;
            }

            await refresh();
            router.refresh();
        } catch (error) {
            console.error(error);
            alert('No se pudo eliminar el video final.');
        } finally {
            setDeletingVideoId(null);
        }
    };

    const renderTemplateCard = (tpl: RemotionTemplate) => (
        <button
            key={tpl.id}
            onClick={() => setSelectedTemplate(tpl.id)}
            disabled={isAssembling}
            className={`flex min-h-[132px] flex-col rounded-xl border p-4 text-left transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5 ${
                selectedTemplate === tpl.id
                    ? 'border-purple-500 bg-purple-500/5 ring-1 ring-purple-500/30'
                    : 'border-gray-200 bg-transparent dark:border-[#6C757D]/10'
            }`}
        >
            <span className="mb-2 text-2xl">{tpl.thumbnail_url || 'Template'}</span>
            <span className="mb-1 line-clamp-2 text-sm font-semibold text-gray-900 dark:text-white">{tpl.name}</span>
            <span className="line-clamp-3 text-xs leading-snug text-gray-500 dark:text-gray-400">{tpl.description}</span>
            <span
                className={`mt-auto inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    tpl.render_mode === 'EXTERNAL_BUNDLE_PENDING'
                        ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300'
                }`}
            >
                {tpl.render_mode === 'EXTERNAL_BUNDLE_PENDING' ? <AlertTriangle size={10} /> : <Play size={10} />}
                {tpl.render_mode === 'EXTERNAL_LAMBDA_SITE_READY' ? 'Bundle cloud' : tpl.render_mode === 'EXTERNAL_CLOUD_BUILD_READY' ? 'Build cloud pendiente' : tpl.storage_path ? 'ZIP referencia' : tpl.render_composition_id}
            </span>
        </button>
    );

    const renderTemplateGroup = (title: string, items: RemotionTemplate[]) => (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-normal text-gray-500 dark:text-gray-400">{title}</h4>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-white/10 dark:text-gray-300">
                    {items.length}
                </span>
            </div>
            {items.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                    {items.map(renderTemplateCard)}
                </div>
            ) : (
                <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500 dark:border-[#6C757D]/20 dark:text-gray-400">
                    No hay plantillas en esta categoria.
                </div>
            )}
        </div>
    );

    if (loadingComponents || loadingTemplates) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Loader2 className="animate-spin text-[#1F5AF6] mb-4" size={32} />
                <p className={`font-medium ${PRODUCTION_THEME.secondaryText}`}>Cargando datos del ensamblado...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            {showGlobalAssemblyProgress && (
                <div className="sticky top-3 z-30 rounded-xl border border-purple-500/30 bg-white/95 p-4 shadow-lg shadow-purple-500/10 backdrop-blur dark:bg-[#151A21]/95">
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-purple-500" />
                            <span className="truncate">
                                Ensamblando {currentAssemblyLabel} con Remotion
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{progress}%</span>
                            <button
                                type="button"
                                onClick={() => void handleStopAssembly()}
                                disabled={stoppingAssembly}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
                            >
                                {stoppingAssembly ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                                Detener
                            </button>
                        </div>
                    </div>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                            {activeAssemblyJobs.length || assemblyJobs.length} job(s) activo(s). Puedes permanecer en esta pantalla mientras se actualiza el progreso.
                        </span>
                        {assemblyJobs[0]?.lastLog && (
                            <span className="truncate sm:max-w-[45%]">{assemblyJobs[0].lastLog}</span>
                        )}
                    </div>
                </div>
            )}
            <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-white to-purple-50 p-6 dark:border-[#6C757D]/10 dark:from-[#151A21] dark:to-purple-500/10 shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-bold mb-2 flex items-center gap-3 text-gray-900 dark:text-white">
                            <Film className="text-purple-500" size={24} />
                            Fase 7: Postproduccion (Ensamblado Remotion)
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
                            Unifica diapositivas, locucion, avatar, musica y B-roll en videos finales renderizados con Remotion.
                        </p>
                    </div>
                    {isCompleted && (
                        <div className="flex items-center gap-2 rounded-full bg-green-500/15 border border-green-500/30 px-4 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckCircle2 size={14} />
                            Videos Ensamblados
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 space-y-4 shadow-sm">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                            <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Play className="text-purple-500" size={18} />
                                Previsualizacion
                            </h3>

                            {videoComponents.length > 1 && (
                                <div className="w-full space-y-1.5 xl:max-w-md">
                                    <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                        Seleccionar Video para Preview:
                                    </label>
                                    <select
                                        value={activePreviewId}
                                        onChange={(event) => setActivePreviewId(event.target.value)}
                                        className="w-full text-sm rounded-xl border border-gray-200 bg-white p-2 dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
                                    >
                                        {videoComponents.map((component, index) => (
                                            <option key={component.id} value={component.id}>
                                                {component.lessonTitle || `Leccion ${index + 1}`} - {(component.content as any)?.title || 'Video'} ({component.assets?.final_video_url ? 'Disponible' : 'Pendiente'})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {(() => {
                            const previewUrl = activePreview?.assets?.final_video_url;

                            if (previewUrl) {
                                return (
                                    <div className="space-y-4">
                                        <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner group">
                                            <video
                                                key={previewUrl}
                                                src={previewUrl}
                                                controls
                                                className="w-full h-full object-contain"
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center justify-center gap-3">
                                            <a
                                                href={previewUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-xs font-semibold text-purple-700 hover:underline dark:text-purple-300"
                                            >
                                                Abrir video final
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteFinalVideo(activePreview)}
                                                disabled={deletingVideoId === activePreview?.id || isAssembling}
                                                className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                                            >
                                                {deletingVideoId === activePreview?.id ? 'Eliminando...' : 'Borrar video final'}
                                            </button>
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                            Video: {activePreview.lessonTitle || 'Leccion'} - {(activePreview.content as any)?.title || 'Video'}. Listo para envio final.
                                        </div>
                                    </div>
                                );
                            }

                            if (activePreview && selectedTemplateUsesExternalPreview) {
                                return (
                                    <div className="space-y-4">
                                        <RemotionExternalPreviewPlayer
                                            key={`${activePreview.id}-${selectedTemplate}-external`}
                                            templateId={selectedTemplate}
                                            componentId={hasPreviewableAssets(activePreview.assets) ? activePreview.id : null}
                                            initialPreviewData={selectedCloudPreviewData}
                                            variables={externalPreviewVariables}
                                        />
                                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                            Preview del bundle externo usando el build cloud aprobado.
                                        </div>
                                    </div>
                                );
                            }

                            if (activePreview && hasPreviewableAssets(activePreview.assets)) {
                                return (
                                    <div className="space-y-4">
                                        <RemotionPreviewPlayer
                                            key={`${activePreview.id}-${selectedTemplateSlug ?? 'default'}`}
                                            assets={activePreview.assets}
                                            templateSlug={selectedTemplateSlug}
                                            templateConfig={selectedTemplateConfig?.default_config}
                                            targetDurationSeconds={activePreviewTargetDurationSeconds}
                                        />
                                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                            Previsualizacion en vivo del ensamblado. El video final se generara al iniciar Remotion.
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8 text-center dark:border-[#6C757D]/20 dark:bg-[#0F1419]/30">
                                    <Film className="mb-3 h-12 w-12 text-gray-300 dark:text-gray-600" />
                                    <p className="max-w-md text-sm font-medium text-gray-500 dark:text-gray-400">
                                        Sube assets (voz, slides, avatar o B-roll) en la Fase 6 para ver aqui la previsualizacion.
                                    </p>
                                </div>
                            );
                        })()}
                    </div>

                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 space-y-6 shadow-sm">
                        <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Sparkles className="text-yellow-500" size={18} />
                            Motor de Render Remotion
                        </h3>

                        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/50">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                                        <Monitor className="h-4 w-4 text-[#1F5AF6]" />
                                        Worker local
                                    </div>
                                    {loadingWorkerStatus ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">Consultando estado...</p>
                                    ) : workerStatusError ? (
                                        <p className="text-xs text-red-600 dark:text-red-400">{workerStatusError}</p>
                                    ) : workerStatus?.requiresDesktopWorker ? (
                                        availableDesktopWorkers.length > 0 ? (
                                            <p className="text-xs text-green-700 dark:text-green-400">
                                                Vinculado: {availableDesktopWorkers[0].device_name || 'SofLIA Render Worker'} · {availableDesktopWorkers[0].status}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-amber-700 dark:text-amber-400">
                                                Worker local no vinculado o sin heartbeat reciente.
                                            </p>
                                        )
                                    ) : (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Provider activo: {workerStatus?.renderProvider || 'no detectado'}.
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href={workerDownloadHref}
                                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-white dark:border-[#6C757D]/20 dark:text-gray-200 dark:hover:bg-[#151A21]"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Descargar app
                                    </a>
                                    <button
                                        type="button"
                                        onClick={() => void loadWorkerStatus()}
                                        disabled={loadingWorkerStatus}
                                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6C757D]/20 dark:text-gray-200 dark:hover:bg-[#151A21]"
                                    >
                                        <RefreshCw className={`h-3.5 w-3.5 ${loadingWorkerStatus ? 'animate-spin' : ''}`} />
                                        Actualizar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCreateWorkerLinkCode}
                                        disabled={creatingWorkerLink}
                                        className="inline-flex items-center gap-2 rounded-lg bg-[#1F5AF6] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1647C8] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {creatingWorkerLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                                        Vincular worker
                                    </button>
                                </div>
                            </div>

                            {visibleDesktopWorkers.length ? (
                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                    {visibleDesktopWorkers.slice(0, 4).map((worker) => (
                                        <div key={worker.id} className="rounded-lg border border-gray-200 bg-white p-2 dark:border-[#6C757D]/10 dark:bg-[#151A21]">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate font-semibold text-gray-800 dark:text-gray-100">
                                                    {worker.device_name || 'SofLIA Render Worker'}
                                                </span>
                                                <span className="shrink-0 font-bold text-gray-500 dark:text-gray-400">{worker.status}</span>
                                            </div>
                                            <p className="mt-1 text-gray-500 dark:text-gray-400">
                                                {[worker.platform, worker.arch, worker.app_version].filter(Boolean).join(' · ') || 'Sin metadata'} · heartbeat {worker.last_heartbeat_at ? new Date(worker.last_heartbeat_at).toLocaleString() : 'pendiente'}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => void handleRevokeWorker(worker.id)}
                                                disabled={revokingWorkerId === worker.id}
                                                className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
                                            >
                                                {revokingWorkerId === worker.id ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <Unlink className="h-3 w-3" />
                                                )}
                                                Desvincular
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {workerLinkCode && (
                                <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-100">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="font-semibold">Codigo temporal</div>
                                            <div className="mt-1 inline-flex items-center gap-2 rounded-md bg-white/80 px-2 py-1 font-mono text-sm font-bold tracking-wide text-gray-950 dark:bg-[#0F1419] dark:text-white">
                                                <span>{workerLinkCode.code}</span>
                                                <button
                                                    type="button"
                                                    onClick={handleCopyWorkerCode}
                                                    className="inline-flex items-center gap-1 rounded border border-blue-500/20 px-2 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-500/10 dark:text-blue-200"
                                                >
                                                    {copiedWorkerCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                                    {copiedWorkerCode ? 'Copiado' : 'Copiar'}
                                                </button>
                                            </div>
                                        </div>
                                        {workerLinkCode.expiresAt && (
                                            <span className="shrink-0">Expira {new Date(workerLinkCode.expiresAt).toLocaleTimeString()}</span>
                                        )}
                                    </div>
                                    <div className="mt-3 rounded-md bg-white/80 p-2 text-[11px] leading-relaxed text-gray-900 dark:bg-[#0F1419] dark:text-gray-100">
                                        <>
                                            No tienes el worker?{' '}
                                            <a
                                                href={workerDownloadHref}
                                                className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-300"
                                            >
                                                Descargalo aqui
                                            </a>
                                            . Luego abre la app, pega el codigo y dejala encendida para renderizar desde esta computadora.
                                        </>
                                        {workerLinkCode.apiUrl ? (
                                            <div className="mt-1 text-gray-500 dark:text-gray-400">
                                                API URL: {workerLinkCode.apiUrl}
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            )}

                            {workerGateBlocked && (
                                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                                    {workerGateMessage}
                                </div>
                            )}
                        </div>

                        {!hasRequiredAssets ? (
                            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                                No se encontraron componentes de video para ensamblar.
                            </div>
                        ) : !hasComponentsToAssemble ? (
                            <div className="space-y-4">
                                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm">
                                    Todos los videos del curso ya cuentan con video final. No es necesario ensamblar por Remotion.
                                </div>
                                {activePreview && (
                                    <button
                                        onClick={() => startAssemblyForComponents([activePreview])}
                                        disabled={isAssembling || workerGateBlocked}
                                        className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Reensamblar seleccionado
                                    </button>
                                )}
                                {onNext && (
                                    <button
                                        onClick={onNext}
                                        className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-green-600 hover:bg-green-500 text-white transition-all shadow-lg shadow-green-500/25"
                                    >
                                        Avanzar a Publicacion
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                    Hay {componentsToAssemble.length} de {videoComponents.length} componente(s) pendientes. Puedes ensamblar solo el video seleccionado o encolar todos los pendientes.
                                </p>

                                {isAssembling ? (
                                    <div className="space-y-4">
                                        <div className="space-y-3">
                                            <div className="flex justify-between items-center text-xs">
                                                <span className={`font-semibold flex items-center gap-1.5 animate-pulse ${isReconnecting ? 'text-amber-600 dark:text-amber-400' : 'text-purple-600 dark:text-purple-400'}`}>
                                                    <Loader2 className="animate-spin" size={12} />
                                                    {isReconnecting
                                                        ? 'Render en curso (reconectando con el motor)...'
                                                        : 'Ensamblando assets con Remotion...'}
                                                </span>
                                                <span className="font-bold text-gray-900 dark:text-white">{progress}%</span>
                                            </div>
                                            <div className="relative h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                                <div
                                                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                                                    style={{ width: `${progress}%` }}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => void handleStopAssembly()}
                                                disabled={stoppingAssembly}
                                                className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10"
                                            >
                                                {stoppingAssembly ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                                                Detener ensamblado
                                            </button>
                                        </div>

                                        {assemblyJobs.length > 0 && (
                                            <div className="space-y-2">
                                                {assemblyJobs.map((job) => (
                                                    <div
                                                        key={job.jobId}
                                                        className="rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/70 dark:bg-[#0F1419]/50 p-3"
                                                    >
                                                        <div className="flex items-center justify-between gap-3 text-xs">
                                                            <span className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                                                                {job.label}
                                                            </span>
                                                            <span className={
                                                                job.status === 'SUCCEEDED'
                                                                    ? 'text-green-600 dark:text-green-400 font-bold'
                                                                    : job.status === 'FAILED' || job.status === 'CANCELLED'
                                                                        ? 'text-red-600 dark:text-red-400 font-bold'
                                                                        : 'text-purple-600 dark:text-purple-400 font-bold'
                                                            }>
                                                                {job.status} · {job.progress}%
                                                            </span>
                                                        </div>
                                                        {job.error && (
                                                            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                                                {job.errorCode ? `${job.errorCode}: ` : ''}{getAssemblyFailureMessage(job)}
                                                            </p>
                                                        )}
                                                        {job.lastLog && (
                                                            <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                                                                {job.lastLog}
                                                            </p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-4">
                                        <button
                                            onClick={handleAssembleSelected}
                                            disabled={!activePreviewPending || selectedTemplateBlocksFinalRender || workerGateBlocked}
                                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-purple-500/25 transition-all active:scale-[0.98]"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            Ensamblar seleccionado
                                        </button>
                                        <button
                                            onClick={handleAssembleAll}
                                            disabled={selectedTemplateBlocksFinalRender || workerGateBlocked}
                                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            Encolar todos ({componentsToAssemble.length})
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="min-h-0">
                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-7rem)] flex min-h-[420px] flex-col overflow-hidden">
                        <div className="space-y-4 border-b border-gray-200 p-5 dark:border-[#6C757D]/10">
                            <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <Layers className="text-[#1F5AF6]" size={18} />
                                Plantillas de Ensamble
                            </h3>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="search"
                                    value={templateSearch}
                                    onChange={(event) => setTemplateSearch(event.target.value)}
                                    placeholder="Buscar plantillas"
                                    className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
                                />
                            </div>
                        </div>

                        <div className="flex-1 space-y-6 overflow-y-auto p-5">
                            {templates.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-[#6C757D]/20">
                                    No hay plantillas disponibles. Sube una en el Panel Administrativo.
                                </div>
                            ) : !hasFilteredTemplates ? (
                                <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-[#6C757D]/20">
                                    No encontramos plantillas con esa busqueda.
                                </div>
                            ) : (
                                <>
                                    {renderTemplateGroup('Basicas', basicTemplates)}
                                    {renderTemplateGroup('Avanzadas', advancedTemplates)}
                                </>
                            )}
                        </div>

                        {(selectedTemplateConfig && (selectedTemplateUsesExternalBundle || selectedTemplateNeedsCloudBuild || selectedTemplateConfig.render_mode === 'EXTERNAL_LAMBDA_SITE_READY')) && (
                            <div className="border-t border-gray-200 p-5 dark:border-[#6C757D]/10">
                                {selectedTemplateUsesExternalBundle && (
                                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                                        <span>
                                            Esta plantilla tiene un ZIP guardado como referencia. Por seguridad, el render actual usa la composicion interna {selectedTemplateConfig.render_composition_id}.
                                        </span>
                                    </div>
                                )}
                                {selectedTemplateNeedsCloudBuild && (
                                    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                                        <span>
                                            Esta plantilla externa necesita un build cloud validado antes de ensamblar el video final.
                                        </span>
                                    </div>
                                )}
                                {selectedTemplateConfig.render_mode === 'EXTERNAL_LAMBDA_SITE_READY' && (
                                    <div className="flex items-start gap-2 rounded-xl border border-green-500/20 bg-green-500/10 p-3 text-xs leading-relaxed text-green-700 dark:text-green-300">
                                        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                                        <span>
                                            Bundle cloud listo. El render final usara el site aprobado con el provider activo.
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
