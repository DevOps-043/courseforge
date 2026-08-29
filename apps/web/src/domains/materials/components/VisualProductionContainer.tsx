'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMaterials } from '../hooks/useMaterials';
import { ProductionAssetCard } from './ProductionAssetCard';
import {
    generateVideoPromptsAction,
    saveMaterialAssetsAction,
} from '../actions/production.actions';
import { updateArtifactAssetsCompleteAction } from '@/domains/artifacts/actions/artifact.actions';
import {
    MaterialAssets,
    MaterialComponent,
    MaterialLesson,
    ProductionStatus,
    StoryboardItem,
} from '../types/materials.types';
import { Loader2, Clapperboard, CheckCircle2, Clock, AlertCircle, Layers3, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { usePathname } from 'next/navigation';
import { PRODUCTION_COMPLETION_RECHECK_DELAY_MS } from '@/shared/constants/timing';
import { PRODUCTION_THEME } from './production-asset-ui';
import { ProductionAutomationReviewPanel } from '@/domains/production/automation/ProductionAutomationReviewPanel';
import { LessonProductionSection } from './LessonProductionSection';

interface VisualProductionContainerProps {
    artifactId: string;
    assetsComplete?: boolean;
    onStatusChange?: (isComplete: boolean) => void;
    profile?: unknown;
}

interface ProductionGroup {
    lesson: MaterialLesson;
    components: MaterialComponent[];
}

export function VisualProductionContainer({ artifactId, assetsComplete, onStatusChange }: VisualProductionContainerProps) {
    const pathname = usePathname();
    const { materials, getArtifactComponents, refresh } = useMaterials(artifactId);
    const [productionItems, setProductionItems] = useState<ProductionGroup[]>([]);
    const [expandedLessonIds, setExpandedLessonIds] = useState<Set<string>>(new Set());
    const [mountedLessonIds, setMountedLessonIds] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isAssetsComplete, setIsAssetsComplete] = useState(Boolean(assetsComplete));
    const pendingAssetsRef = useRef<Record<string, Partial<MaterialAssets>>>({});
    const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
    const knownProductionLessonIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        setIsAssetsComplete(Boolean(assetsComplete));
    }, [assetsComplete]);

    const adminBasePath = useMemo(() => {
        const adminIndex = pathname.indexOf('/admin');
        return adminIndex >= 0 ? pathname.slice(0, adminIndex + '/admin'.length) : '/admin';
    }, [pathname]);

    const slideTemplatesHref = `${adminBasePath}/templates`;
    const slideTemplateStudioHref = `${adminBasePath}/slides/templates`;

    const buildSofliaSlidesHref = useCallback((componentId: string) => {
        const params = new URLSearchParams({
            artifactId,
            componentId,
            returnTo: pathname,
        });

        return `${adminBasePath}/slides?${params.toString()}`;
    }, [adminBasePath, artifactId, pathname]);

    useEffect(() => {
        const fetchProductionItems = async () => {
            if (!materials?.lessons) {
                setProductionItems([]);
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            try {
                const artifactComponents = await getArtifactComponents();
                const results = materials.lessons.map((lesson) => {
                    const components = artifactComponents.filter(
                        (component) => component.material_lesson_id === lesson.id,
                    );
                    // Filter for "Produce-able" components
                    // VIDEO types (Theoretical, Demo, Guide) and DEMO_GUIDE (for screencast)
                    const produceable = components.filter(c =>
                        c.type.includes('VIDEO') || c.type === 'DEMO_GUIDE'
                    );

                    if (produceable.length > 0) {
                        return { lesson, components: produceable };
                    }
                    return null;
                });

                // Filter nulls and sort by lesson order (which is preserved in materials.lessons)
                const validItems = results.filter((item): item is ProductionGroup => item !== null);

                // Sort to match original lesson order
                const sortedItems = validItems.sort((a, b) => {
                    const idxA = materials.lessons.findIndex(l => l.id === a.lesson.id);
                    const idxB = materials.lessons.findIndex(l => l.id === b.lesson.id);
                    return idxA - idxB;
                });

                const nextLessonIds = new Set(sortedItems.map((item) => item.lesson.id));
                const previouslyKnownLessonIds = knownProductionLessonIdsRef.current;
                setExpandedLessonIds((current) => {
                    const nextExpandedLessonIds = new Set(
                        [...current].filter((lessonId) => nextLessonIds.has(lessonId)),
                    );
                    if (previouslyKnownLessonIds.size === 0 && sortedItems[0]) {
                        nextExpandedLessonIds.add(sortedItems[0].lesson.id);
                    }
                    return nextExpandedLessonIds;
                });
                setMountedLessonIds((current) => {
                    const nextMountedLessonIds = new Set(
                        [...current].filter((lessonId) => nextLessonIds.has(lessonId)),
                    );
                    if (previouslyKnownLessonIds.size === 0 && sortedItems[0]) {
                        nextMountedLessonIds.add(sortedItems[0].lesson.id);
                    }
                    return nextMountedLessonIds;
                });
                knownProductionLessonIdsRef.current = nextLessonIds;
                setProductionItems(sortedItems);

            } catch (err) {
                console.warn('Could not load production items:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProductionItems();
    }, [materials, getArtifactComponents]);

    const handleGeneratePrompts = async (
        componentId: string,
        storyboard: StoryboardItem[],
    ): Promise<string> => {
        const result = await generateVideoPromptsAction(componentId, storyboard);
        if (!result.success) throw new Error(result.error);

        // Refresh local state (simplified: re-fetch or update local item)
        // For simplicity we just return the prompts so the Card can update its state locally
        // But ideally we should also refresh the global state or Context

        return result.prompts || "";
    };

    // Every section persists automatically. Changes for the same component are
    // coalesced and serialized so a fast delete -> replace sequence cannot be
    // committed out of order.
    const handleAssetChange = useCallback((
        componentId: string,
        assets: Partial<MaterialAssets>,
    ): Promise<void> => {
        pendingAssetsRef.current[componentId] = {
            ...pendingAssetsRef.current[componentId],
            ...assets,
        };

        const activeQueue = saveQueuesRef.current.get(componentId);
        if (activeQueue) {
            return activeQueue.then(async () => {
                const followUpQueue = saveQueuesRef.current.get(componentId);
                if (followUpQueue && followUpQueue !== activeQueue) {
                    await followUpQueue;
                    return;
                }
                if (pendingAssetsRef.current[componentId]) {
                    await handleAssetChange(componentId, {});
                }
            });
        }

        const queue = (async () => {
            let saved = false;

            while (pendingAssetsRef.current[componentId]) {
                const nextAssets = pendingAssetsRef.current[componentId];
                delete pendingAssetsRef.current[componentId];

                const result = await saveMaterialAssetsAction(componentId, nextAssets);
                if (!result.success) {
                    pendingAssetsRef.current[componentId] = {
                        ...nextAssets,
                        ...pendingAssetsRef.current[componentId],
                    };
                    throw new Error(result.error);
                }
                saved = true;
            }

            if (saved) {
                void refresh();
            }
        })().finally(() => {
                saveQueuesRef.current.delete(componentId);
                if (pendingAssetsRef.current[componentId]) {
                    void handleAssetChange(componentId, {});
                }
            });

        void queue.catch((error) => {
            console.error('Error auto-saving production assets:', error);
            toast.error('No se pudo guardar automáticamente el cambio');
        });
        saveQueuesRef.current.set(componentId, queue);
        return queue;
    }, [refresh]);

    // Calculate global production progress
    const progressStats = useMemo(() => {
        const allComponents = productionItems.flatMap(g => g.components);
        const total = allComponents.length;
        if (total === 0) return { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 };

        const completed = allComponents.filter(c =>
            (c.assets?.production_status as ProductionStatus) === 'COMPLETED'
        ).length;
        const inProgress = allComponents.filter(c =>
            (c.assets?.production_status as ProductionStatus) === 'IN_PROGRESS'
        ).length;
        const pending = total - completed - inProgress;
        const percentage = Math.round((completed / total) * 100);

        return { total, completed, inProgress, pending, percentage };
    }, [productionItems]);

    // Auto-complete artifact production status
    useEffect(() => {
        const checkCompletion = async () => {
            // Guard: don't run while still loading or with no items
            if (isLoading || productionItems.length === 0) return;

            console.log(`[Production] Assets Completion Check: ${progressStats.percentage}% (DB: ${assetsComplete})`);

            // If 100% and not marked complete -> Mark complete
            if (progressStats.percentage === 100 && !isAssetsComplete) {
                console.log('[Production] Reached 100% of assets. Updating DB...');

                const result = await updateArtifactAssetsCompleteAction(artifactId, true);
                if (result.success) {
                    console.log('[Production] DB updated successfully. Synchronizing local completion state...');
                    // Notify parent ONLY after DB confirms success
                    setIsAssetsComplete(true);
                    if (onStatusChange) onStatusChange(true);
                } else {
                    console.error('[Production] DB update failed:', result.error);
                }
            }
            // If not 100% but marked complete -> Unmark (revert)
            else if (progressStats.percentage < 100 && isAssetsComplete) {
                console.log(`[Production] Percentage dropped to ${progressStats.percentage}%. Reverting completion...`);

                const result = await updateArtifactAssetsCompleteAction(artifactId, false);
                if (result.success) {
                    setIsAssetsComplete(false);
                    if (onStatusChange) onStatusChange(false);
                }
            }
        };

        // Add small delay to allow things to settle after data loads
        const timer = setTimeout(
            checkCompletion,
            PRODUCTION_COMPLETION_RECHECK_DELAY_MS,
        );
        return () => clearTimeout(timer);
    }, [progressStats.percentage, isAssetsComplete, artifactId, productionItems.length, onStatusChange, isLoading]);

    const allLessonsExpanded = productionItems.every((group) =>
        expandedLessonIds.has(group.lesson.id),
    );
    const allLessonsCollapsed = productionItems.every((group) =>
        !expandedLessonIds.has(group.lesson.id),
    );

    const productionModules = useMemo(() => {
        const modules: Array<{
            id: string;
            title: string;
            lessons: Array<{ group: ProductionGroup; lessonNumber: number }>;
        }> = [];
        const modulesById = new Map<string, (typeof modules)[number]>();

        productionItems.forEach((group, lessonIndex) => {
            const moduleId = group.lesson.module_id || group.lesson.module_title || 'module-without-title';
            let productionModule = modulesById.get(moduleId);

            if (!productionModule) {
                productionModule = {
                    id: moduleId,
                    title: group.lesson.module_title || 'Módulo sin título',
                    lessons: [],
                };
                modulesById.set(moduleId, productionModule);
                modules.push(productionModule);
            }

            productionModule.lessons.push({ group, lessonNumber: lessonIndex + 1 });
        });

        return modules;
    }, [productionItems]);

    const toggleLesson = (lessonId: string) => {
        setExpandedLessonIds((current) => {
            const next = new Set(current);
            if (next.has(lessonId)) next.delete(lessonId);
            else {
                next.add(lessonId);
                setMountedLessonIds((mounted) => new Set(mounted).add(lessonId));
            }
            return next;
        });
    };

    const expandAllLessons = () => {
        const lessonIds = new Set(productionItems.map((group) => group.lesson.id));
        setMountedLessonIds(lessonIds);
        setExpandedLessonIds(lessonIds);
    };

    const collapseAllLessons = () => {
        setExpandedLessonIds(new Set());
    };

    if (isLoading) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Loader2 className="animate-spin text-[var(--engine-info)] mb-4" size={32} />
                <p className={`font-medium ${PRODUCTION_THEME.secondaryText}`}>Cargando items de produccion...</p>
            </div>
        );
    }

    if (productionItems.length === 0) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Clapperboard className={`mb-4 opacity-50 ${PRODUCTION_THEME.secondaryText}`} size={48} />
                <h3 className={`text-lg font-bold mb-2 ${PRODUCTION_THEME.primaryText}`}>No hay material visual para producir</h3>
                <p className={`text-center max-w-md ${PRODUCTION_THEME.secondaryText}`}>
                    No se encontraron componentes de video o guias de demostracion en los materiales generados.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <ProductionAutomationReviewPanel artifactId={artifactId} />
            {/* Header / Intro */}
            <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-white to-blue-50 p-6 dark:border-[var(--engine-muted)]/10 dark:from-[var(--engine-surface-solid)] dark:to-[var(--engine-info)]/10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h2 className={`text-xl font-bold mb-2 flex items-center gap-3 ${PRODUCTION_THEME.primaryText}`}>
                            {progressStats.percentage === 100 ? (
                                <CheckCircle2 className="text-green-600 dark:text-green-400" />
                            ) : (
                                <Clapperboard className="text-[var(--engine-info)]" />
                            )}
                            Produccion Visual
                        </h2>
                        <p className={`text-sm max-w-2xl ${PRODUCTION_THEME.secondaryText}`}>
                            Genera y gestiona los activos visuales finales (Slides, Videos, Screencasts).
                        </p>
                    </div>
                    {/* Progress Stats */}
                    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white/80 px-4 py-2 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-canvas)]/50">
                        <div className="flex items-center gap-2 text-sm">
                            <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                            <span className="text-green-700 dark:text-green-400 font-bold">{progressStats.completed}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Clock size={16} className="text-amber-600 dark:text-yellow-400" />
                            <span className="text-amber-700 dark:text-yellow-400 font-bold">{progressStats.inProgress}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <AlertCircle size={16} className="text-gray-500 dark:text-gray-400" />
                            <span className="text-gray-600 dark:text-gray-400 font-bold">{progressStats.pending}</span>
                        </div>
                        <div className="h-6 w-px bg-gray-300 dark:bg-[var(--engine-muted)]/30" />
                        <span className={`font-bold ${PRODUCTION_THEME.primaryText}`}>{progressStats.percentage}%</span>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="relative h-2 bg-gray-200 dark:bg-[var(--engine-canvas)] rounded-full overflow-hidden">
                    <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
                        style={{ width: `${progressStats.percentage}%` }}
                    />
                    {progressStats.inProgress > 0 && (
                        <div
                            className="absolute inset-y-0 bg-yellow-500/50 transition-all duration-500"
                            style={{
                                left: `${progressStats.percentage}%`,
                                width: `${(progressStats.inProgress / progressStats.total) * 100}%`
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Production List */}
            <div className="space-y-4">
                <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className={`text-sm font-bold ${PRODUCTION_THEME.primaryText}`}>
                            Producción por lección
                        </p>
                        <p className={`text-xs ${PRODUCTION_THEME.secondaryText}`}>
                            {productionItems.length} {productionItems.length === 1 ? 'lección disponible' : 'lecciones disponibles'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={expandAllLessons}
                            disabled={allLessonsExpanded}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-[var(--engine-info)]/30 hover:text-[var(--engine-info)] disabled:cursor-default disabled:opacity-40 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-gray-300"
                        >
                            <Plus size={13} aria-hidden="true" />
                            Expandir todas
                        </button>
                        <button
                            type="button"
                            onClick={collapseAllLessons}
                            disabled={allLessonsCollapsed}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-[var(--engine-info)]/30 hover:text-[var(--engine-info)] disabled:cursor-default disabled:opacity-40 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-gray-300"
                        >
                            <Minus size={13} aria-hidden="true" />
                            Colapsar todas
                        </button>
                    </div>
                </div>

                {productionModules.map((productionModule) => (
                    <section key={productionModule.id} className="space-y-3" aria-labelledby={`production-module-${productionModule.id}`}>
                        <div className="flex items-center gap-3 pt-3">
                            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--engine-info)]/25" />
                            <div className="flex max-w-[min(100%,48rem)] items-center gap-2.5 rounded-full border border-[var(--engine-info)]/20 bg-blue-50/80 px-4 py-2 text-[var(--engine-info)] shadow-sm dark:bg-[var(--engine-info)]/10">
                                <Layers3 size={15} className="shrink-0" aria-hidden="true" />
                                <h3 id={`production-module-${productionModule.id}`} className="truncate text-xs font-bold uppercase tracking-[0.1em]">
                                    {productionModule.title}
                                </h3>
                                <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold tabular-nums dark:bg-[var(--engine-canvas)]">
                                    {productionModule.lessons.length}
                                </span>
                            </div>
                            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--engine-info)]/25" />
                        </div>

                        <div className="space-y-3">
                            {productionModule.lessons.map(({ group, lessonNumber }) => (
                                <LessonProductionSection
                                    key={group.lesson.id}
                                    lesson={group.lesson}
                                    components={group.components}
                                    lessonNumber={lessonNumber}
                                    expanded={expandedLessonIds.has(group.lesson.id)}
                                    onToggle={() => toggleLesson(group.lesson.id)}
                                    componentCards={mountedLessonIds.has(group.lesson.id) ? group.components.map((component) => (
                                        <ProductionAssetCard
                                            key={component.id}
                                            component={component}
                                            lessonTitle={group.lesson.lesson_title}
                                            onGeneratePrompts={handleGeneratePrompts}
                                            onAssetChange={handleAssetChange}
                                            slideTemplatesHref={slideTemplatesHref}
                                            slideTemplateStudioHref={slideTemplateStudioHref}
                                            sofliaSlidesHref={buildSofliaSlidesHref(component.id)}
                                        />
                                    )) : null}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
