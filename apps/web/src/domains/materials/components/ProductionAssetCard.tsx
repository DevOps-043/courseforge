'use client';

import { useState } from 'react';
import {
    Video, FileText, MonitorPlay, Copy, ExternalLink,
    Sparkles, Save, CheckCircle, Loader2, Play,
    CheckCircle2, Circle, AlertCircle, Eye, X, Maximize2, Wand2
} from 'lucide-react';
import { MaterialComponent, ProductionStatus } from '../types/materials.types';

interface ProductionAssetCardProps {
    component: MaterialComponent;
    lessonTitle: string;
    onSaveAssets: (componentId: string, assets: any) => Promise<void>;
    onGeneratePrompts: (componentId: string, storyboard: any[]) => Promise<string>;
    onAssetChange?: (componentId: string, assets: any) => void;
}

export function ProductionAssetCard({
    component,
    lessonTitle,
    onSaveAssets,
    onGeneratePrompts,
    onAssetChange
}: ProductionAssetCardProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    // Local state for inputs
    const [slidesUrl, setSlidesUrl] = useState(component.assets?.slides_url || '');
    const [videoUrl, setVideoUrl] = useState(component.assets?.video_url || '');
    const [screencastUrl, setScreencastUrl] = useState(component.assets?.screencast_url || '');
    const [bRollPrompts, setBRollPrompts] = useState(component.assets?.b_roll_prompts || '');
    const [finalVideoUrl, setFinalVideoUrl] = useState(component.assets?.final_video_url || '');

    // Helper to update state and notify parent
    const updateAsset = (field: string, value: string, setter: (v: string) => void) => {
        setter(value);
        if (onAssetChange) {
            onAssetChange(component.id, { [field]: value });
        }
    };

    const handleGeneratePrompts = async () => {
        setIsGenerating(true);
        try {
            const storyboard = (component.content as any).storyboard || [];
            if (!storyboard.length) {
                alert('No storyboard found for this component');
                return;
            }
            const prompts = await onGeneratePrompts(component.id, storyboard);
            setBRollPrompts(prompts);
            if (onAssetChange) {
                onAssetChange(component.id, { b_roll_prompts: prompts });
            }
        } catch (e: any) {
            console.error(e);
            // Check for rate limit error (429)
            const errorMessage = e?.message || String(e);
            if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('exhausted')) {
                alert('⚠️ Límite de API alcanzado. Por favor espera unos minutos e intenta de nuevo.');
            } else {
                alert('Error al generar prompts: ' + errorMessage);
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const assets: any = {};
            if (slidesUrl) assets.slides_url = slidesUrl;
            if (videoUrl) assets.video_url = videoUrl;
            if (screencastUrl) assets.screencast_url = screencastUrl;
            if (bRollPrompts) assets.b_roll_prompts = bRollPrompts;
            if (finalVideoUrl) assets.final_video_url = finalVideoUrl;

            await onSaveAssets(component.id, assets);
        } catch (e) {
            console.error(e);
            alert('Error saving assets');
        } finally {
            setIsSaving(false);
        }
    };

    const copyToClipboard = (text: string, label?: string) => {
        navigator.clipboard.writeText(text);
        setCopyFeedback(label || 'Copiado');
        setTimeout(() => setCopyFeedback(null), 2000);
    };

    // ============================================
    // HALLAZGO 3: Estructura recomendada para slides
    // Opciones: Script + Storyboard, Solo Guión
    // Siempre mantener Story Overview
    // ============================================

    // Extraer el Story Overview (contexto general del video)
    const getStoryOverview = (): string => {
        const content = component.content as any;
        const title = content.title || content.script?.title || 'Presentación';
        const duration = content.duration_estimate_minutes || content.script?.duration_estimate_minutes || 5;
        const script = content.script as { sections?: any[] } | undefined;
        const storyboard = content.storyboard as any[] | undefined;

        // Extraer el objetivo/intro del script si existe
        let objective = '';
        if (script?.sections?.length) {
            const introSection = script.sections.find((s: any) =>
                s.section_type === 'intro' || s.section_number === 1
            );
            if (introSection?.narration_text) {
                const sentences = introSection.narration_text.split(/[.!?]+/).filter((s: string) => s.trim());
                objective = sentences.slice(0, 2).join('. ').trim();
                if (objective && !objective.endsWith('.')) objective += '.';
            }
        }

        return `STORY OVERVIEW
--------------------------------------------------
Titulo: ${title}
Duracion estimada: ${duration} minutos
Total de slides: ${storyboard?.length || script?.sections?.length || 'N/A'}
${objective ? `\nObjetivo: ${objective}` : ''}
--------------------------------------------------`;
    };

    // OPCIÓN A: Script + Storyboard combinado
    // Generar estructura para Gamma (Markdown optimizado para no generar imágenes)
    const formatForGamma = (): string => {
        const content = component.content as any;
        const script = content.script as { sections?: any[] } | undefined;
        const storyboard = content.storyboard as any[] | undefined;

        if ((!script?.sections || script.sections.length === 0) && (!storyboard || storyboard.length === 0)) {
            return '';
        }

        let formatted = `${getStoryOverview()}

CONFIGURACION GAMMA:
- Idioma: Español Latinoamericano
- IMAGENES: NO GENERAR (Usar solo texto y layouts solidos)
- Estilo: Minimalista, fuentes limpias
- Formato: Presentacion educativa

---
CONTENIDO
---

`;

        // Usar script como fuente principal, fallback a storyboard si es necesario
        // Combinamos la mejor información disponible de ambos
        const sections = script?.sections || [];
        const storyboardItems = storyboard || [];
        const maxItems = Math.max(sections.length, storyboardItems.length);

        for (let i = 0; i < maxItems; i++) {
            const section = sections[i];
            const storyItem = storyboardItems[i];
            const slideNum = i + 1;
            const type = section?.section_type ? `[${section.section_type.toUpperCase()}]` : '';

            formatted += `### SLIDE ${slideNum} ${type}\n\n`;

            // Texto en pantalla
            const text = section?.on_screen_text || storyItem?.on_screen_text || '';
            if (text) {
                formatted += `**Texto en Pantalla:**\n${text}\n\n`;
            }

            // Narración
            const narration = section?.narration_text || storyItem?.narration_text || '';
            if (narration) {
                formatted += `**Narracion (Speaker Notes):**\n${narration}\n\n`;
            }

            // Contexto Visual (Referencia)
            const visual = section?.visual_notes || storyItem?.visual_content || '';
            if (visual) {
                formatted += `**Contexto Visual (Referencia):**\n${visual}\n\n`;
            }

            formatted += `---\n\n`;
        }

        return formatted.trim();
    };

    // Generate URL for opening Gamma with pre-filled content
    const openInGamma = () => {
        const formattedContent = formatForGamma();

        if (!formattedContent) {
            alert('No hay contenido de guión o storyboard para exportar.');
            return;
        }

        // Copy to clipboard and open Gamma's create page
        copyToClipboard(formattedContent, '¡Estructura copiada! Pega en Gamma');
        window.open('https://gamma.app/create', '_blank');
    };

    // Helper to extract Gamma deck ID from URL
    const getGammaEmbedUrl = (url: string): string | null => {
        if (!url) return null;

        // Handle different Gamma URL formats:
        // https://gamma.app/docs/DECK_ID
        // https://gamma.app/embed/DECK_ID
        // https://gamma.app/public/DECK_ID

        const patterns = [
            /gamma\.app\/docs\/([a-zA-Z0-9-]+)/,
            /gamma\.app\/embed\/([a-zA-Z0-9-]+)/,
            /gamma\.app\/public\/([a-zA-Z0-9-]+)/,
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                return `https://gamma.app/embed/${match[1]}`;
            }
        }

        // If it's already an embed URL, return as-is
        if (url.includes('gamma.app/embed/')) {
            return url;
        }

        return null;
    };

    const gammaEmbedUrl = getGammaEmbedUrl(slidesUrl);

    // Helper: Get production status from assets
    const productionStatus = (component.assets?.production_status as ProductionStatus) || 'PENDING';
    const dodChecklist = component.assets?.dod_checklist || {
        has_slides_url: false,
        has_video_url: false,
        has_screencast_url: false,
        has_b_roll_prompts: false,
        has_final_video_url: false,
    };

    // Status badge config
    const getStatusBadge = () => {
        // If final video is set, mark as COMPLETED regardless of saved status
        if (finalVideoUrl) {
            return { label: 'Completado', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 };
        }
        switch (productionStatus) {
            case 'COMPLETED':
                return { label: 'Completado', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 };
            case 'IN_PROGRESS':
                return { label: 'En Progreso', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: AlertCircle };
            case 'DECK_READY':
                return { label: 'Deck Listo', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: FileText };
            case 'EXPORTED':
                return { label: 'Exportado', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: CheckCircle };
            default:
                return { label: 'Pendiente', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: Circle };
        }
    };

    const statusBadge = getStatusBadge();
    const StatusIcon = statusBadge.icon;

    // Calculate which DoD items are required for this component type
    const needsSlides = component.type === 'VIDEO_THEORETICAL' || component.type === 'VIDEO_GUIDE' || component.type === 'VIDEO_DEMO';
    const needsScreencast = component.type === 'DEMO_GUIDE' || component.type === 'VIDEO_GUIDE';
    const needsVideo = component.type.includes('VIDEO');
    const needsFinalVideo = component.type.includes('VIDEO');

    const renderViewer = () => {
        const content = component.content as any;
        return (
            <div className="bg-[#0F1419] rounded-xl p-4 border border-[#6C757D]/10 max-h-[300px] overflow-y-auto custom-scrollbar">
                <h4 className="text-xs font-bold text-[#6C757D] mb-2 uppercase tracking-wide">Storyboard Reference</h4>
                <div className="space-y-4">
                    {content.storyboard?.map((item: any, idx: number) => (
                        <div key={idx} className="flex gap-3 text-sm">
                            <span className="text-[#1F5AF6] font-mono shrink-0">{item.timecode_start}</span>
                            <div className="flex-1">
                                <p className="text-[#E9ECEF] mb-1">{item.visual_content}</p>
                                <p className="text-[#6C757D] text-xs italic">{item.narration_text}</p>
                            </div>
                        </div>
                    )) || <p className="text-gray-500">No storyboard data.</p>}
                </div>
            </div>
        );
    };

    // DoD indicator component
    const DodIndicator = ({ label, completed, required }: { label: string; completed: boolean; required: boolean }) => {
        if (!required) return null;
        return (
            <div className={`flex items-center gap-1.5 text-xs ${completed ? 'text-green-400' : 'text-gray-500'}`}>
                {completed ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                <span>{label}</span>
            </div>
        );
    };

    // Helper para traducir tipos de componentes
    const getComponentLabel = (type: string) => {
        const map: Record<string, string> = {
            'VIDEO_THEORETICAL': 'VIDEO TEÓRICO',
            'VIDEO_GUIDE': 'VIDEO GUÍA',
            'DEMO_GUIDE': 'GUÍA DEMOSTRATIVA',
            'VIDEO_DEMO': 'VIDEO DEMOSTRATIVO'
        };
        return map[type] || type.replace(/_/g, ' ');
    };

    return (
        <div className={`bg-[#151A21] border rounded-2xl overflow-hidden ${productionStatus === 'COMPLETED' ? 'border-green-500/30' : 'border-[#6C757D]/10'}`}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#6C757D]/10 bg-[#1A2027]">
                <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${component.type.includes('VIDEO') ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                            }`}>
                            {component.type.includes('VIDEO') ? <Video size={18} /> : <MonitorPlay size={18} />}
                        </div>
                        <div>
                            <h3 className="text-white font-bold text-sm">{getComponentLabel(component.type)}</h3>

                            <p className="text-[#6C757D] text-xs">{lessonTitle}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Status Badge */}
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${statusBadge.color}`}>
                            <StatusIcon size={12} />
                            {statusBadge.label}
                        </div>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-3 py-1.5 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] rounded-lg transition-colors text-xs font-bold"
                        >
                            {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                            Guardar
                        </button>
                    </div>
                </div>
                {/* DoD Checklist Indicators */}
                <div className="flex items-center gap-4 mt-2 pt-2 border-t border-[#6C757D]/10 flex-wrap">
                    <span className="text-[#6C757D] text-xs font-medium">Checklist:</span>
                    <DodIndicator label="Slides" completed={Boolean(slidesUrl)} required={needsSlides} />
                    <DodIndicator label="Prompts" completed={Boolean(bRollPrompts)} required={needsVideo} />
                    <DodIndicator label="Screencast" completed={Boolean(screencastUrl)} required={needsScreencast} />
                    <DodIndicator label="Video Final" completed={Boolean(finalVideoUrl)} required={needsFinalVideo} />
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: Reference */}
                <div className="space-y-4">
                    {renderViewer()}
                </div>

                {/* Right: Production Tools */}
                <div className="space-y-6">

                    {/* SLIDES SECTION (Gamma) */}
                    {(component.type === 'VIDEO_THEORETICAL' || component.type === 'VIDEO_GUIDE' || component.type === 'VIDEO_DEMO') && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <FileText size={14} /> GAMMA SLIDES
                                {copyFeedback && (
                                    <span className="ml-auto text-green-400 font-normal text-xs animate-pulse">
                                        ✓ {copyFeedback}
                                    </span>
                                )}
                            </h4>

                            {/* If we have a slides URL, show the embed preview */}
                            {gammaEmbedUrl ? (
                                <div className="space-y-2">
                                    {/* Embedded Preview */}
                                    <div className="relative rounded-lg overflow-hidden border border-[#6C757D]/20 bg-[#0F1419]">
                                        <iframe
                                            src={gammaEmbedUrl}
                                            className="w-full h-48 border-0"
                                            allow="fullscreen"
                                            title="Gamma Presentation Preview"
                                        />
                                        <div className="absolute top-2 right-2 flex gap-1">
                                            <button
                                                onClick={() => setShowPreview(true)}
                                                className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                                                title="Ver en pantalla completa"
                                            >
                                                <Maximize2 size={14} />
                                            </button>
                                            <a
                                                href={slidesUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg text-white transition-colors"
                                                title="Abrir en Gamma"
                                            >
                                                <ExternalLink size={14} />
                                            </a>
                                        </div>
                                    </div>

                                    {/* URL Input (editable) */}
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="URL del deck de Gamma..."
                                            value={slidesUrl}
                                            onChange={(e) => updateAsset('slides_url', e.target.value, setSlidesUrl)}
                                            className="flex-1 bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2 text-white text-xs focus:outline-none focus:border-[#1F5AF6]"
                                        />
                                        <button
                                            onClick={openInGamma}
                                            className="px-3 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg border border-purple-500/30 flex items-center gap-1 text-xs transition-colors"
                                            title="Crear nueva presentación en Gamma"
                                        >
                                            <Wand2 size={12} /> Nueva
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                /* No URL yet - show creation options */
                                <div className="space-y-3">
                                    {/* Main CTA: Create in Gamma */}
                                    <button
                                        onClick={openInGamma}
                                        className="w-full bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 text-white py-3 rounded-lg border border-purple-500/30 flex items-center justify-center gap-2 transition-all group"
                                    >
                                        <Wand2 size={16} className="text-purple-400 group-hover:animate-pulse" />
                                        <span className="font-bold">Crear en Gamma</span>
                                        <span className="text-xs text-gray-400">(copia y abre)</span>
                                    </button>

                                    {/* Secondary options - HALLAZGO 3: Dos formatos disponibles */}
                                    {/* Secondary options - Estructura optimizada */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] text-[#6C757D]">📋 Copiar estructura para Gamma:</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => copyToClipboard(formatForGamma(), 'Estructura copiada')}
                                                className="flex-1 bg-[#1F5AF6]/10 hover:bg-[#1F5AF6]/20 text-[#1F5AF6] text-xs py-2 rounded-lg border border-[#1F5AF6]/20 flex items-center justify-center gap-2 transition-colors"
                                                title="Copia el guión estructurado para generar slides de texto en Gamma"
                                            >
                                                <Copy size={12} /> Copiar Estructura Gamma
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => copyToClipboard(JSON.stringify((component.content as any).storyboard || (component.content as any).script, null, 2), 'JSON copiado')}
                                            className="w-full bg-[#2D333B] hover:bg-[#373E47] text-[#6C757D] text-xs py-1.5 rounded-lg border border-[#6C757D]/20 flex items-center justify-center gap-2 transition-colors"
                                            title="Copiar datos raw como JSON"
                                        >
                                            <Copy size={10} /> JSON Raw
                                        </button>
                                    </div>

                                    {/* URL Input */}
                                    <input
                                        type="text"
                                        placeholder="Pega aquí la URL del deck de Gamma..."
                                        value={slidesUrl}
                                        onChange={(e) => updateAsset('slides_url', e.target.value, setSlidesUrl)}
                                        className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#1F5AF6] placeholder-gray-500"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* B-ROLL SECTION (Video AI) */}
                    {(component.type === 'VIDEO_THEORETICAL' || component.type === 'VIDEO_DEMO' || component.type === 'VIDEO_GUIDE') && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <Sparkles size={14} className="text-purple-400" /> AI B-ROLL PROMPTS
                            </h4>
                            {bRollPrompts ? (
                                <div className="space-y-2">
                                    <textarea
                                        value={bRollPrompts}
                                        onChange={(e) => updateAsset('b_roll_prompts', e.target.value, setBRollPrompts)}
                                        className="w-full h-32 bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-3 text-white text-xs focus:outline-none focus:border-[#1F5AF6] custom-scrollbar resize-none"
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => copyToClipboard(bRollPrompts)}
                                            className="text-xs text-[#6C757D] hover:text-white flex items-center gap-1"
                                        >
                                            <Copy size={12} /> Copiar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <button
                                        onClick={handleGeneratePrompts}
                                        disabled={isGenerating}
                                        className={`w-full py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${isGenerating
                                            ? 'bg-purple-500/5 text-purple-400/50 border border-purple-500/10 cursor-not-allowed'
                                            : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20'
                                            }`}
                                    >
                                        {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                                        {isGenerating ? 'Generando Prompts...' : 'Generar Prompts con Gemini'}
                                    </button>
                                    {isGenerating && (
                                        <div className="flex items-center justify-center gap-2 p-2 bg-blue-500/5 border border-blue-500/10 rounded-lg animate-pulse">
                                            <span className="text-[10px] text-blue-400">
                                                ⏳ Analizando storyboard y generando prompts técnicos... Por favor espera.
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* SCREENCAST SECTION */}
                    {(component.type === 'DEMO_GUIDE' || component.type === 'VIDEO_GUIDE') && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <MonitorPlay size={14} /> SCREENCAST
                            </h4>
                            <input
                                type="text"
                                placeholder="Paste Screencast URL here..."
                                value={screencastUrl}
                                onChange={(e) => updateAsset('screencast_url', e.target.value, setScreencastUrl)}
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#1F5AF6]"
                            />
                        </div>
                    )}

                    {/* FINAL VIDEO SECTION (Post-Production) */}
                    {component.type.includes('VIDEO') && (
                        <div className="space-y-3 mt-4 pt-4 border-t border-[#6C757D]/20">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <Play size={14} className="text-green-400" /> VIDEO FINAL (Post-Producción)
                                {finalVideoUrl && (
                                    <span className="ml-auto flex items-center gap-1 text-green-400 text-xs">
                                        <CheckCircle2 size={12} /> Completado
                                    </span>
                                )}
                            </h4>
                            <input
                                type="text"
                                placeholder="URL del video final (después de edición)..."
                                value={finalVideoUrl}
                                onChange={(e) => updateAsset('final_video_url', e.target.value, setFinalVideoUrl)}
                                className={`w-full bg-[#0F1419] border rounded-lg p-2.5 text-white text-xs focus:outline-none transition-colors ${finalVideoUrl
                                    ? 'border-green-500/30 focus:border-green-500'
                                    : 'border-[#6C757D]/20 focus:border-[#1F5AF6]'
                                    }`}
                            />
                            {finalVideoUrl && (
                                <a
                                    href={finalVideoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 text-xs text-green-400 hover:text-green-300"
                                >
                                    <ExternalLink size={12} /> Ver video final
                                </a>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Fullscreen Preview Modal */}
            {showPreview && gammaEmbedUrl && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setShowPreview(false)}
                >
                    <div
                        className="relative w-full max-w-6xl h-[80vh] bg-[#151A21] rounded-2xl overflow-hidden border border-[#6C757D]/20"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
                            <div className="flex items-center gap-3">
                                <FileText size={20} className="text-purple-400" />
                                <span className="text-white font-bold">Vista Previa - Gamma Slides</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <a
                                    href={slidesUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
                                >
                                    <ExternalLink size={14} /> Abrir en Gamma
                                </a>
                                <button
                                    onClick={() => setShowPreview(false)}
                                    className="p-2 hover:bg-white/10 rounded-lg text-white transition-colors"
                                    title="Cerrar"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Embedded Gamma Presentation */}
                        <iframe
                            src={gammaEmbedUrl}
                            className="w-full h-full border-0"
                            allow="fullscreen"
                            title="Gamma Presentation"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
