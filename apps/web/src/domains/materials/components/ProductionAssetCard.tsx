'use client';

import { useState } from 'react';
import {
    Video, FileText, MonitorPlay, Copy, ExternalLink,
    Sparkles, Save, CheckCircle, Loader2, Play
} from 'lucide-react';
import { MaterialComponent } from '../types/materials.types';

interface ProductionAssetCardProps {
    component: MaterialComponent;
    lessonTitle: string;
    onSaveAssets: (componentId: string, assets: any) => Promise<void>;
    onGeneratePrompts: (componentId: string, storyboard: any[]) => Promise<string>;
}

export function ProductionAssetCard({
    component,
    lessonTitle,
    onSaveAssets,
    onGeneratePrompts
}: ProductionAssetCardProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Local state for inputs
    const [slidesUrl, setSlidesUrl] = useState(component.assets?.slides_url || '');
    const [videoUrl, setVideoUrl] = useState(component.assets?.video_url || '');
    const [screencastUrl, setScreencastUrl] = useState(component.assets?.screencast_url || '');
    const [bRollPrompts, setBRollPrompts] = useState(component.assets?.b_roll_prompts || '');

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
        } catch (e) {
            console.error(e);
            alert('Error generating prompts');
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

            await onSaveAssets(component.id, assets);
        } catch (e) {
            console.error(e);
            alert('Error saving assets');
        } finally {
            setIsSaving(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // Could show a toast here
    };

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

    return (
        <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#6C757D]/10 flex justify-between items-center bg-[#1A2027]">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${component.type.includes('VIDEO') ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                        }`}>
                        {component.type.includes('VIDEO') ? <Video size={18} /> : <MonitorPlay size={18} />}
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-sm">{component.type.replace(/_/g, ' ')}</h3>
                        <p className="text-[#6C757D] text-xs">{lessonTitle}</p>
                    </div>
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

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left: Reference */}
                <div className="space-y-4">
                    {renderViewer()}
                </div>

                {/* Right: Production Tools */}
                <div className="space-y-6">

                    {/* SLIDES SECTION (Gamma) */}
                    {(component.type === 'VIDEO_THEORETICAL' || component.type === 'VIDEO_GUIDE') && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <FileText size={14} /> GAMMA SLIDES
                            </h4>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => copyToClipboard(JSON.stringify((component.content as any).storyboard, null, 2))}
                                    className="flex-1 bg-[#2D333B] hover:bg-[#373E47] text-white text-xs py-2 rounded-lg border border-[#6C757D]/20 flex items-center justify-center gap-2 transition-colors"
                                >
                                    <Copy size={12} /> Copiar Estructura
                                </button>
                                <a
                                    href="https://gamma.app"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 bg-[#2D333B] hover:bg-[#373E47] text-[#6C757D] rounded-lg border border-[#6C757D]/20 flex items-center"
                                >
                                    <ExternalLink size={14} />
                                </a>
                            </div>
                            <input
                                type="text"
                                placeholder="Paste Gamma URL here..."
                                value={slidesUrl}
                                onChange={(e) => setSlidesUrl(e.target.value)}
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#1F5AF6]"
                            />
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
                                        onChange={(e) => setBRollPrompts(e.target.value)}
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
                                <button
                                    onClick={handleGeneratePrompts}
                                    disabled={isGenerating}
                                    className="w-full bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all"
                                >
                                    {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                                    Generar Prompts con Gemini
                                </button>
                            )}
                            <input
                                type="text"
                                placeholder="Paste Final Video URL here..."
                                value={videoUrl}
                                onChange={(e) => setVideoUrl(e.target.value)}
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#1F5AF6]"
                            />
                        </div>
                    )}

                    {/* SCREENCAST SECTION */}
                    {(component.type === 'DEMO_GUIDE' || component.type === 'VIDEO_GUIDE') && (
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-[#E9ECEF] flex items-center gap-2">
                                <MonitorPlay size={14} /> SCREENCAST
                            </h4>
                            <div className="p-3 bg-[#0F1419] rounded-lg border border-[#6C757D]/10 text-xs text-[#6C757D]">
                                <p>Sigue los pasos detallados en la guía de demostración. Usa OBS Studio para grabar.</p>
                            </div>
                            <input
                                type="text"
                                placeholder="Paste Screencast URL here..."
                                value={screencastUrl}
                                onChange={(e) => setScreencastUrl(e.target.value)}
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-[#1F5AF6]"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
