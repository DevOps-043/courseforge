'use client';

import { useRef, useState } from 'react';
import { Loader2, MonitorPlay, Save, Video } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';
import {
    fetchVideoMetadata,
    getVideoProviderAndId,
    MAX_VIDEO_UPLOAD_SIZE_BYTES,
    PRODUCTION_VIDEOS_BUCKET,
} from '@/lib/video-platform';
import type { MaterialComponent, ProductionStatus } from '../types/materials.types';
import {
    DodIndicator,
    getProductionComponentLabel,
    getProductionRequirements,
    getProductionStatusBadge,
    ProductionStoryboardViewer,
} from './production-asset-ui';
import {
    formatGammaContent,
    getGammaEmbedUrl as resolveGammaEmbedUrl,
} from '../lib/production-formatters';
import {
    ProductionAssetFinalVideoSection,
    ProductionAssetGammaSection,
    ProductionAssetPreviewModal,
    ProductionAssetPromptsSection,
    ProductionAssetScreencastSection,
} from './ProductionAssetSections';

interface ProductionAssetCardProps {
    component: MaterialComponent;
    lessonTitle: string;
    onAssetChange?: (
        componentId: string,
        assets: Record<string, unknown>,
    ) => void;
    onGeneratePrompts: (
        componentId: string,
        storyboard: unknown[],
    ) => Promise<string>;
    onSaveAssets: (
        componentId: string,
        assets: Record<string, unknown>,
    ) => Promise<void>;
}

const VIDEO_SECTION_TYPES = new Set([
    'VIDEO_THEORETICAL',
    'VIDEO_DEMO',
    'VIDEO_GUIDE',
]);

function isValidHttpUrl(url: string) {
    if (!url) {
        return true;
    }

    return url.startsWith('https://') || url.startsWith('http://');
}

async function detectDirectVideoDuration(url: string) {
    return new Promise<number>((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.crossOrigin = 'anonymous';
        video.onloadedmetadata = () => {
            const durationRaw = video.duration;
            resolve(!Number.isNaN(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : 0);
        };
        video.onerror = () => resolve(0);
        video.src = url;
    });
}

export function ProductionAssetCard({
    component,
    lessonTitle,
    onAssetChange,
    onGeneratePrompts,
    onSaveAssets,
}: ProductionAssetCardProps) {
    const [bRollPrompts, setBRollPrompts] = useState(component.assets?.b_roll_prompts || '');
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [finalVideoSource, setFinalVideoSource] = useState<'upload' | 'link' | null>(
        component.assets?.final_video_source || (component.assets?.final_video_url ? 'link' : null),
    );
    const [finalVideoUrl, setFinalVideoUrl] = useState(component.assets?.final_video_url || '');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [screencastUrl, setScreencastUrl] = useState(component.assets?.screencast_url || '');
    const [showPreview, setShowPreview] = useState(false);
    const [slidesUrl, setSlidesUrl] = useState(component.assets?.slides_url || '');
    const [urlError, setUrlError] = useState<string | null>(null);
    const [videoUrl, setVideoUrl] = useState(component.assets?.video_url || '');
    const fileRef = useRef<HTMLInputElement>(null);

    const productionStatus =
        (component.assets?.production_status as ProductionStatus) || 'PENDING';
    const statusBadge = getProductionStatusBadge(productionStatus, finalVideoUrl);
    const StatusIcon = statusBadge.icon;
    const gammaEmbedUrl = resolveGammaEmbedUrl(slidesUrl);
    const { needsFinalVideo, needsScreencast, needsSlides, needsVideo } =
        getProductionRequirements(component.type);
    const requiresGamma = VIDEO_SECTION_TYPES.has(component.type);
    const requiresPrompts = VIDEO_SECTION_TYPES.has(component.type);

    const updateAsset = (
        field: string,
        value: string,
        setter: (nextValue: string) => void,
    ) => {
        setter(value);
        onAssetChange?.(component.id, { [field]: value });
    };

    const copyToClipboard = (text: string, label?: string) => {
        navigator.clipboard.writeText(text);
        setCopyFeedback(label || 'Copiado');
        window.setTimeout(() => setCopyFeedback(null), 2000);
    };

    const openInGamma = () => {
        const formattedContent = formatGammaContent(component.content as Record<string, unknown>);

        if (!formattedContent) {
            alert('No hay contenido de guion o storyboard para exportar.');
            return;
        }

        copyToClipboard(formattedContent, 'Estructura copiada');
        window.open('https://gamma.app/create', '_blank');
    };

    const handleGeneratePrompts = async () => {
        setIsGenerating(true);

        try {
            const storyboard =
                ((component.content as { storyboard?: unknown[] }).storyboard || []);

            if (!storyboard.length) {
                alert('No storyboard found for this component');
                return;
            }

            const prompts = await onGeneratePrompts(component.id, storyboard);
            setBRollPrompts(prompts);
            onAssetChange?.(component.id, { b_roll_prompts: prompts });
        } catch (error) {
            console.error(error);
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            if (
                errorMessage.includes('429') ||
                errorMessage.includes('RESOURCE_EXHAUSTED') ||
                errorMessage.includes('exhausted')
            ) {
                alert('Limite de API alcanzado. Por favor espera unos minutos e intenta de nuevo.');
            } else {
                alert(`Error al generar prompts: ${errorMessage}`);
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleVideoUpload = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES) {
            toast.error('El video no debe superar los 500MB. Para videos mas grandes, usa YouTube/Vimeo.');
            return;
        }

        setIsUploading(true);
        const supabase = createClient();

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${component.id}-${Date.now()}.${fileExt}`;

            const { error: uploadError } = await supabase.storage
                .from(PRODUCTION_VIDEOS_BUCKET)
                .upload(fileName, file);

            if (uploadError) {
                throw uploadError;
            }

            const {
                data: { publicUrl },
            } = supabase.storage
                .from(PRODUCTION_VIDEOS_BUCKET)
                .getPublicUrl(fileName);

            updateAsset('final_video_url', publicUrl, setFinalVideoUrl);
            setFinalVideoSource('upload');
            setUrlError(null);
            toast.success('Video subido correctamente');
        } catch (error) {
            console.error('Upload error:', error);
            toast.error(
                `Error al subir video: ${
                    error instanceof Error ? error.message : 'Error desconocido'
                }`,
            );
        } finally {
            setIsUploading(false);
            if (fileRef.current) {
                fileRef.current.value = '';
            }
        }
    };

    const handleSave = async () => {
        if (finalVideoUrl && !isValidHttpUrl(finalVideoUrl)) {
            setUrlError('La URL debe comenzar con https:// o http://');
            toast.error('URL del video final no es valida');
            return;
        }

        setIsSaving(true);

        try {
            const assets: Record<string, unknown> = {};
            if (slidesUrl) assets.slides_url = slidesUrl;
            if (videoUrl) assets.video_url = videoUrl;
            if (screencastUrl) assets.screencast_url = screencastUrl;
            if (bRollPrompts) assets.b_roll_prompts = bRollPrompts;
            if (finalVideoUrl) assets.final_video_url = finalVideoUrl;
            if (finalVideoSource) assets.final_video_source = finalVideoSource;

            if (finalVideoUrl) {
                try {
                    const { provider, id } = getVideoProviderAndId(finalVideoUrl);
                    const duration =
                        provider === 'direct'
                            ? await detectDirectVideoDuration(id)
                            : (await fetchVideoMetadata(finalVideoUrl)).duration || 0;

                    if (duration > 0) {
                        assets.video_duration = duration;
                    }
                } catch (durationError) {
                    console.error('Error auto-detecting duration:', durationError);
                }
            }

            await onSaveAssets(component.id, assets);
        } catch (error) {
            console.error(error);
            alert('Error saving assets');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className={`overflow-hidden rounded-2xl border bg-[#151A21] ${
                productionStatus === 'COMPLETED'
                    ? 'border-green-500/30'
                    : 'border-[#6C757D]/10'
            }`}
        >
            <div className="border-b border-[#6C757D]/10 bg-[#1A2027] px-6 py-4">
                <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={`rounded-lg p-2 ${
                                component.type.includes('VIDEO')
                                    ? 'bg-purple-500/10 text-purple-400'
                                    : 'bg-blue-500/10 text-blue-400'
                            }`}
                        >
                            {component.type.includes('VIDEO') ? (
                                <Video size={18} />
                            ) : (
                                <MonitorPlay size={18} />
                            )}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white">
                                {getProductionComponentLabel(component.type)}
                            </h3>
                            <p className="text-xs text-[#6C757D]">{lessonTitle}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadge.color}`}
                        >
                            <StatusIcon size={12} />
                            {statusBadge.label}
                        </div>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 rounded-lg bg-[#00D4B3]/10 px-3 py-1.5 text-xs font-bold text-[#00D4B3] transition-colors hover:bg-[#00D4B3]/20"
                        >
                            {isSaving ? (
                                <Loader2 className="animate-spin" size={14} />
                            ) : (
                                <Save size={14} />
                            )}
                            Guardar
                        </button>
                    </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-[#6C757D]/10 pt-2">
                    <span className="text-xs font-medium text-[#6C757D]">Checklist:</span>
                    <DodIndicator
                        label="Slides"
                        completed={Boolean(slidesUrl)}
                        required={needsSlides}
                    />
                    <DodIndicator
                        label="Prompts"
                        completed={Boolean(bRollPrompts)}
                        required={needsVideo}
                    />
                    <DodIndicator
                        label="Screencast"
                        completed={Boolean(screencastUrl)}
                        required={needsScreencast}
                    />
                    <DodIndicator
                        label="Video Final"
                        completed={Boolean(finalVideoUrl)}
                        required={needsFinalVideo}
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
                <div className="space-y-4">
                    <ProductionStoryboardViewer
                        content={component.content as Record<string, unknown>}
                    />
                </div>

                <div className="space-y-6">
                    {requiresGamma && (
                        <ProductionAssetGammaSection
                            component={component}
                            copyFeedback={copyFeedback}
                            copyToClipboard={copyToClipboard}
                            gammaEmbedUrl={gammaEmbedUrl}
                            onOpenInGamma={openInGamma}
                            onOpenPreview={() => setShowPreview(true)}
                            onSlidesUrlChange={(value) =>
                                updateAsset('slides_url', value, setSlidesUrl)
                            }
                            slidesUrl={slidesUrl}
                        />
                    )}

                    {requiresPrompts && (
                        <ProductionAssetPromptsSection
                            bRollPrompts={bRollPrompts}
                            copyToClipboard={copyToClipboard}
                            isGenerating={isGenerating}
                            onGeneratePrompts={handleGeneratePrompts}
                            onPromptsChange={(value) =>
                                updateAsset('b_roll_prompts', value, setBRollPrompts)
                            }
                        />
                    )}

                    {(component.type === 'DEMO_GUIDE' || component.type === 'VIDEO_GUIDE') && (
                        <ProductionAssetScreencastSection
                            screencastUrl={screencastUrl}
                            onScreencastUrlChange={(value) =>
                                updateAsset('screencast_url', value, setScreencastUrl)
                            }
                        />
                    )}

                    {component.type.includes('VIDEO') && (
                        <ProductionAssetFinalVideoSection
                            fileRef={fileRef}
                            finalVideoSource={finalVideoSource}
                            finalVideoUrl={finalVideoUrl}
                            isSaving={isSaving}
                            isUploading={isUploading}
                            isValidUrl={isValidHttpUrl}
                            onClearVideo={() => {
                                updateAsset('final_video_url', '', setFinalVideoUrl);
                                setFinalVideoSource(null);
                                setUrlError(null);
                            }}
                            onTriggerFilePicker={() => fileRef.current?.click()}
                            onUploadVideo={handleVideoUpload}
                            onVideoUrlChange={(value) => {
                                updateAsset('final_video_url', value, setFinalVideoUrl);
                                setFinalVideoSource(value ? 'link' : null);
                                if (urlError) {
                                    setUrlError(null);
                                }
                            }}
                            urlError={urlError}
                        />
                    )}
                </div>
            </div>

            {showPreview && gammaEmbedUrl && (
                <ProductionAssetPreviewModal
                    gammaEmbedUrl={gammaEmbedUrl}
                    onClose={() => setShowPreview(false)}
                    slidesUrl={slidesUrl}
                />
            )}
        </div>
    );
}
