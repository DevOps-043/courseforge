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
import { Loader2, Clapperboard, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { usePathname, useRouter } from 'next/navigation';
import { PRODUCTION_COMPLETION_RECHECK_DELAY_MS } from '@/shared/constants/timing';
import { PRODUCTION_THEME } from './production-asset-ui';

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
    const router = useRouter();
    const pathname = usePathname();
    const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
    const [productionItems, setProductionItems] = useState<ProductionGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const pendingAssetsRef = useRef<Record<string, Partial<MaterialAssets>>>({});
    const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());

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
                // Process lessons in parallel chunks to avoid blocking but ensure speed
                const promises = materials.lessons.map(async (lesson) => {
                    const components = await getLessonComponents(lesson.id);
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

                const results = await Promise.all(promises);

                // Filter nulls and sort by lesson order (which is preserved in materials.lessons)
                const validItems = results.filter((item): item is ProductionGroup => item !== null);

                // Sort to match original lesson order
                const sortedItems = validItems.sort((a, b) => {
                    const idxA = materials.lessons.findIndex(l => l.id === a.lesson.id);
                    const idxB = materials.lessons.findIndex(l => l.id === b.lesson.id);
                    return idxA - idxB;
                });

                setProductionItems(sortedItems);

            } catch (err) {
                console.error('Error fetching production items:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProductionItems();
    }, [materials, getLessonComponents]);

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
    const handleAssetChange = useCallback((componentId: string, assets: Partial<MaterialAssets>) => {
        pendingAssetsRef.current[componentId] = {
            ...pendingAssetsRef.current[componentId],
            ...assets,
        };

        const activeQueue = saveQueuesRef.current.get(componentId);
        if (activeQueue) return activeQueue;

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
                void refresh().then(() => router.refresh());
            }
        })()
            .catch((error) => {
                console.error('Error auto-saving production assets:', error);
                toast.error('No se pudo guardar automáticamente el cambio');
            })
            .finally(() => {
                saveQueuesRef.current.delete(componentId);
            });

        saveQueuesRef.current.set(componentId, queue);
        return queue;
    }, [refresh, router]);

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
            if (progressStats.percentage === 100 && !assetsComplete) {
                console.log('[Production] Reached 100% of assets. Updating DB...');

                const result = await updateArtifactAssetsCompleteAction(artifactId, true);
                if (result.success) {
                    console.log('[Production] DB updated successfully. Refreshing...');
                    // Notify parent ONLY after DB confirms success
                    if (onStatusChange) onStatusChange(true);
                    router.refresh();
                } else {
                    console.error('[Production] DB update failed:', result.error);
                }
            }
            // If not 100% but marked complete -> Unmark (revert)
            else if (progressStats.percentage < 100 && assetsComplete) {
                console.log(`[Production] Percentage dropped to ${progressStats.percentage}%. Reverting completion...`);

                const result = await updateArtifactAssetsCompleteAction(artifactId, false);
                if (result.success) {
                    if (onStatusChange) onStatusChange(false);
                    router.refresh();
                }
            }
        };

        // Add small delay to allow things to settle after data loads
        const timer = setTimeout(
            checkCompletion,
            PRODUCTION_COMPLETION_RECHECK_DELAY_MS,
        );
        return () => clearTimeout(timer);
    }, [progressStats.percentage, assetsComplete, artifactId, router, productionItems.length, onStatusChange, isLoading]);

    if (isLoading) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Loader2 className="animate-spin text-[#1F5AF6] mb-4" size={32} />
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
            {/* Header / Intro */}
            <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-white to-blue-50 p-6 dark:border-[#6C757D]/10 dark:from-[#151A21] dark:to-[#1F5AF6]/10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h2 className={`text-xl font-bold mb-2 flex items-center gap-3 ${PRODUCTION_THEME.primaryText}`}>
                            {progressStats.percentage === 100 ? (
                                <CheckCircle2 className="text-green-600 dark:text-green-400" />
                            ) : (
                                <Clapperboard className="text-[#1F5AF6]" />
                            )}
                            Produccion Visual
                        </h2>
                        <p className={`text-sm max-w-2xl ${PRODUCTION_THEME.secondaryText}`}>
                            Genera y gestiona los activos visuales finales (Slides, Videos, Screencasts).
                        </p>
                    </div>
                    {/* Progress Stats */}
                    <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white/80 px-4 py-2 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/50">
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
                        <div className="h-6 w-px bg-gray-300 dark:bg-[#6C757D]/30" />
                        <span className={`font-bold ${PRODUCTION_THEME.primaryText}`}>{progressStats.percentage}%</span>
                    </div>
                </div>

                {/* Progress Bar */}
                <div className="relative h-2 bg-gray-200 dark:bg-[#0F1419] rounded-full overflow-hidden">
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
            <div className="space-y-8">
                {productionItems.map((group) => (
                    <div key={group.lesson.id} className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="h-px flex-1 bg-gray-200 dark:bg-[#6C757D]/20"></div>
                            <h3 className="rounded-full border border-gray-200 bg-gray-50 px-4 py-1 font-mono text-xs uppercase tracking-wider text-gray-600 dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-[#6C757D]">
                                {group.lesson.lesson_title}
                            </h3>
                            <div className="h-px flex-1 bg-gray-200 dark:bg-[#6C757D]/20"></div>
                        </div>

                        <div className="grid gap-6">
                            {group.components.map((component) => (
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
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
