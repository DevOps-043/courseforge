'use client';

import { useState, useEffect } from 'react';
import { useMaterials } from '../hooks/useMaterials';
import { ProductionAssetCard } from './ProductionAssetCard';
import { generateVideoPromptsAction, saveMaterialAssetsAction } from '@/app/admin/artifacts/actions';
import { MaterialComponent, MaterialLesson } from '../types/materials.types';
import { Loader2, Clapperboard } from 'lucide-react';

interface VisualProductionContainerProps {
    artifactId: string;
}

interface ProductionGroup {
    lesson: MaterialLesson;
    components: MaterialComponent[];
}

export function VisualProductionContainer({ artifactId }: VisualProductionContainerProps) {
    const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
    const [productionItems, setProductionItems] = useState<ProductionGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchProductionItems = async () => {
            if (!materials?.lessons) return;

            setIsLoading(true);
            try {
                const items: ProductionGroup[] = [];

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

    const handleGeneratePrompts = async (componentId: string, storyboard: any[]) => {
        const result = await generateVideoPromptsAction(componentId, storyboard);
        if (!result.success) throw new Error(result.error);

        // Refresh local state (simplified: re-fetch or update local item)
        // For simplicity we just return the prompts so the Card can update its state locally
        // But ideally we should also refresh the global state or Context

        return result.prompts;
    };

    const handleSaveAssets = async (componentId: string, assets: any) => {
        const result = await saveMaterialAssetsAction(componentId, assets);
        if (!result.success) throw new Error(result.error);
        // Silent success or toast handled by Card
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-[#151A21] rounded-2xl border border-[#6C757D]/10">
                <Loader2 className="animate-spin text-[#1F5AF6] mb-4" size={32} />
                <p className="text-[#6C757D] font-medium">Cargando ítems de producción...</p>
            </div>
        );
    }

    if (productionItems.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-[#151A21] rounded-2xl border border-[#6C757D]/10">
                <Clapperboard className="text-[#6C757D] mb-4 opacity-50" size={48} />
                <h3 className="text-white font-bold text-lg mb-2">No hay material visual para producir</h3>
                <p className="text-[#6C757D] text-center max-w-md">
                    No se encontraron componentes de video o guías de demostración en los materiales generados.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-12">
            {/* Header / Intro */}
            <div className="bg-gradient-to-r from-[#151A21] to-[#1F5AF6]/10 p-6 rounded-2xl border border-[#6C757D]/10">
                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-3">
                    <Clapperboard className="text-[#1F5AF6]" /> Producción Visual
                </h2>
                <p className="text-[#E9ECEF] text-sm max-w-2xl">
                    Genera y gestiona los activos visuales finales (Slides, Videos, Screencasts).
                    Usa las herramientas de IA para crear prompts de B-roll o copia la estructura para Gamma.
                </p>
            </div>

            {/* Production List */}
            <div className="space-y-8">
                {productionItems.map((group) => (
                    <div key={group.lesson.id} className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="h-px flex-1 bg-[#6C757D]/20"></div>
                            <h3 className="text-[#6C757D] font-mono text-xs uppercase tracking-wider bg-[#0F1419] px-4 py-1 rounded-full border border-[#6C757D]/20">
                                {group.lesson.lesson_title}
                            </h3>
                            <div className="h-px flex-1 bg-[#6C757D]/20"></div>
                        </div>

                        <div className="grid gap-6">
                            {group.components.map((component) => (
                                <ProductionAssetCard
                                    key={component.id}
                                    component={component}
                                    lessonTitle={group.lesson.lesson_title}
                                    onGeneratePrompts={handleGeneratePrompts}
                                    onSaveAssets={handleSaveAssets}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
