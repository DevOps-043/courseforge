'use client';

import { Copy, ExternalLink, FileText, MonitorPlay, Video, CheckCircle2, PlayCircle, X, Calendar, Hash, Layout } from 'lucide-react';
import { MaterialSearchResult } from '../actions';
import { useState } from 'react';

interface MaterialResultCardProps {
    result: MaterialSearchResult;
}

export function MaterialResultCard({ result }: MaterialResultCardProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const hasId = result.gamma_deck_id && result.gamma_deck_id !== 'NO-ID';

    // Check for any valid video URL (prioritize final, then draft, then screencast)
    const validVideoUrl = result.assets?.final_video_url || result.assets?.video_url || result.assets?.screencast_url;

    const copyToClipboard = (text: string) => {
        if (!text || text === 'NO-ID') return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getIcon = (type: string) => {
        if (type.includes('VIDEO')) return <Video size={18} />;
        if (type.includes('DEMO')) return <MonitorPlay size={18} />;
        return <FileText size={18} />;
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'COMPLETED': return 'text-green-400 border-green-500/30 bg-green-500/10';
            case 'IN_PROGRESS': return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
            default: return 'text-gray-400 border-gray-500/30 bg-gray-500/10';
        }
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    /**
     * UNIVERSAL VIDEO PLAYER LOGIC
     * Detects YouTube or Vimeo URLs and converts them to embed links.
     * Returns a valid embed URL or NULL if it's a direct file.
     */
    const getEmbedUrl = (url: string | undefined): { isEmbed: boolean; url: string } => {
        if (!url) return { isEmbed: false, url: '' };

        // 1. YouTube Detection
        const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        if (ytMatch && ytMatch[1]) {
            return { isEmbed: true, url: `https://www.youtube.com/embed/${ytMatch[1]}` };
        }

        // 2. Vimeo Detection
        const vimeoMatch = url.match(/(?:vimeo\.com\/)(\d+)/);
        if (vimeoMatch && vimeoMatch[1]) {
            return { isEmbed: true, url: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
        }

        // 3. Default: Direct File or unknown
        return { isEmbed: false, url: url };
    };

    const getTypeLabel = (type: string) => {
        const map: Record<string, string> = {
            'VIDEO_THEORETICAL': 'Video Teórico',
            'VIDEO_GUIDE': 'Video Guía',
            'VIDEO_DEMO': 'Video Demo',
            'DEMO_GUIDE': 'Guía Interactiva',
            'QUIZ': 'Quiz'
        };
        return map[type] || type.replace(/_/g, ' ');
    };

    // Helper to extract Gamma deck ID from URL for embedding
    const getGammaEmbedUrl = (url: string | undefined): string | null => {
        if (!url) return null;
        const patterns = [
            /gamma\.app\/docs\/([a-zA-Z0-9-]+)/,
            /gamma\.app\/embed\/([a-zA-Z0-9-]+)/,
            /gamma\.app\/public\/([a-zA-Z0-9-]+)/,
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) return `https://gamma.app/embed/${match[1]}`;
        }
        return url.includes('gamma.app/embed/') ? url : null;
    };

    const videoConfig = getEmbedUrl(validVideoUrl);
    const gammaEmbedUrl = getGammaEmbedUrl(result.assets?.slides_url);

    return (
        <>
            {/* Card Trigger */}
            <div
                onClick={() => setIsOpen(true)}
                className="bg-[#151A21] border border-[#6C757D]/10 rounded-xl p-4 hover:border-[#00D4B3]/50 transition-all group flex flex-col h-full cursor-pointer hover:bg-[#1E2329] relative overflow-hidden"
            >
                {/* Hover Effect Gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#00D4B3]/0 to-[#00D4B3]/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg bg-[#0A2540] text-[#00D4B3]`}>
                            {getIcon(result.type)}
                        </div>
                        <div>
                            <p className="text-[#94A3B8] text-[10px] font-bold uppercase tracking-wider mb-1">
                                {getTypeLabel(result.type)}
                            </p>
                            <div className="flex items-center gap-2">
                                <span className={`font-bold text-xs px-2 py-0.5 rounded font-mono border ${hasId ? 'bg-[#1E2329] text-white border-gray-700' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                    {result.gamma_deck_id || 'NO-ID'}
                                </span>
                                {result.production_status === 'COMPLETED' && <CheckCircle2 size={14} className="text-green-400" />}
                            </div>
                        </div>
                    </div>

                    <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${getStatusColor(result.production_status)}`}>
                        {result.production_status}
                    </div>
                </div>

                <div className="flex-grow relative z-10">
                    <h3 className="text-white font-medium text-sm line-clamp-2 group-hover:text-[#00D4B3] transition-colors" title={result.lesson_title}>
                        {result.lesson_title}
                    </h3>
                    <p className="text-[#6C757D] text-xs line-clamp-1 mt-1">
                        {result.course_name}
                    </p>
                </div>

                <div className="mt-3 pt-3 border-t border-[#6C757D]/10 text-xs text-gray-500 flex items-center justify-between relative z-10">
                    <span>{result.course_code}</span>
                    <span>Click para detalles</span>
                </div>
            </div>

            {/* Details Modal */}
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setIsOpen(false)}>
                    <div className="bg-[#151A21] w-full max-w-3xl rounded-2xl border border-[#6C757D]/20 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                        {/* Modal Header */}
                        <div className="p-6 border-b border-[#6C757D]/10 flex justify-between items-start bg-[#0F1419]">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[#00D4B3] text-[10px] font-bold uppercase tracking-wider bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">
                                        {getTypeLabel(result.type)}
                                    </span>
                                </div>
                                <h2 className="text-xl font-bold text-white mb-1">{result.lesson_title}</h2>
                                <p className="text-[#94A3B8] text-sm flex items-center gap-2">
                                    <Layout size={14} />
                                    {result.course_name} ({result.course_code})
                                </p>
                            </div>
                            <button onClick={() => setIsOpen(false)} className="bg-[#1E2329] p-2 rounded-full text-gray-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">

                            {/* Metadata Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-[#1E2329] p-3 rounded-xl border border-[#6C757D]/10">
                                    <h4 className="text-gray-500 text-xs uppercase font-bold mb-1 flex items-center gap-1"><Hash size={12} /> ID Compuesto</h4>
                                    <div className="flex items-center justify-between">
                                        <code className="text-[#00D4B3] font-mono text-sm">{result.gamma_deck_id || 'N/A'}</code>
                                        <button
                                            onClick={() => copyToClipboard(result.gamma_deck_id || '')}
                                            disabled={!hasId}
                                            className="text-gray-400 hover:text-white p-1"
                                            title="Copiar ID"
                                        >
                                            <Copy size={14} />
                                        </button>
                                    </div>
                                    {copied && <span className="text-[10px] text-green-400">Copiado!</span>}
                                </div>
                                <div className="bg-[#1E2329] p-3 rounded-xl border border-[#6C757D]/10">
                                    <h4 className="text-gray-500 text-xs uppercase font-bold mb-1 flex items-center gap-1"><Calendar size={12} /> Actualizado</h4>
                                    <span className="text-white text-sm">{formatDate(result.updated_at)}</span>
                                </div>
                            </div>

                            {/* Gamma Slides Preview */}
                            {gammaEmbedUrl && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                                        <FileText size={18} className="text-[#00D4B3]" />
                                        Vista Previa de Slides
                                    </h3>
                                    <div className="aspect-video bg-[#0F1419] rounded-xl overflow-hidden border border-[#6C757D]/20 relative group">
                                        <iframe
                                            src={gammaEmbedUrl}
                                            className="w-full h-full border-0"
                                            allow="fullscreen"
                                            title="Gamma Slides Preview"
                                        />
                                        <a
                                            href={result.assets?.slides_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Abrir en pestaña nueva"
                                        >
                                            <ExternalLink size={16} />
                                        </a>
                                    </div>
                                </div>
                            )}

                            {/* Video Section */}
                            {validVideoUrl && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2">
                                        <Video size={18} className="text-[#00D4B3]" />
                                        Video de Producción
                                    </h3>
                                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-[#6C757D]/20">
                                        {videoConfig.isEmbed ? (
                                            <iframe
                                                src={videoConfig.url}
                                                className="w-full h-full"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            />
                                        ) : (
                                            <video
                                                src={videoConfig.url}
                                                controls
                                                className="w-full h-full"
                                            />
                                        )}
                                    </div>
                                </div>
                            )}

                            {!validVideoUrl && !gammaEmbedUrl && (
                                <div className="p-8 bg-[#1E2329]/50 rounded-xl border border-dashed border-[#6C757D]/20 text-center text-gray-500 text-sm">
                                    <div className="flex justify-center mb-2"><Layout size={24} className="opacity-20" /></div>
                                    No hay visualización disponible (Slides o Video) para este material.
                                </div>
                            )}

                        </div>

                        {/* Modal Footer / Actions */}
                        <div className="p-4 border-t border-[#6C757D]/10 bg-[#0F1419] flex gap-3 justify-end items-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border mr-auto ${getStatusColor(result.production_status)}`}>
                                {result.production_status}
                            </span>

                            {result.assets?.slides_url && (
                                <a
                                    href={result.assets.slides_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] px-4 py-2 rounded-lg font-medium transition-colors border border-[#00D4B3]/20"
                                >
                                    <ExternalLink size={16} />
                                    Abrir en Gamma
                                </a>
                            )}

                            <button onClick={() => setIsOpen(false)} className="px-4 py-2 bg-[#1E2329] hover:bg-[#2D333B] text-white rounded-lg transition-colors">
                                Cerrar
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </>
    );
}
