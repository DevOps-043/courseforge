'use client';

import {
    Copy, ExternalLink, FileText, MonitorPlay, Video, CheckCircle2, X,
    Calendar, Hash, Layout, Mic, Film, UserCircle, Image, Music, MessageSquare,
    BookOpen, HelpCircle, Dumbbell, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { MaterialSearchResult } from '../actions';
import { useState } from 'react';
import { getEmbedVideoUrl } from '@/lib/video-platform';
import { getGammaEmbedUrl as resolveGammaEmbedUrl } from '@/domains/materials/lib/production-formatters';
import { COPY_FEEDBACK_RESET_DELAY_MS } from '@/shared/constants/timing';
import type { MaterialAssets } from '@/domains/materials/types/materials.types';

interface MaterialResultCardProps {
    result: MaterialSearchResult;
}

// ─── asset presence helpers ──────────────────────────────────────────────────

function detectAssets(assets: MaterialAssets | null) {
    const a = assets ?? {};
    return {
        hasSlides: Boolean((a.slides?.images?.length ?? 0) > 0 || a.slides?.html_public_url || a.slides_url),
        hasVideo: Boolean(a.final_video_url || a.video_url || a.screencast_url),
        hasAvatar: Boolean(a.avatar_video?.public_url),
        hasAudio: Boolean(a.voice_audio?.public_url),
        hasMusic: Boolean(a.background_music?.public_url),
        hasBroll: (a.b_roll_clips?.length ?? 0) > 0,
        slideImages: a.slides?.images ?? [],
        brollClips: a.b_roll_clips ?? [],
    };
}

// ─── sub-components ──────────────────────────────────────────────────────────

function AssetDot({
    present,
    icon,
    label,
}: {
    present: boolean;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <span
            title={label}
            className={`flex items-center justify-center w-5 h-5 rounded-full border transition-colors ${
                present
                    ? 'bg-[#00D4B3]/15 border-[#00D4B3]/40 text-[#00D4B3]'
                    : 'bg-gray-500/10 border-gray-600/20 text-gray-600'
            }`}
        >
            {icon}
        </span>
    );
}

function SlideGallery({ images }: { images: NonNullable<MaterialAssets['slides']>['images'] }) {
    const [idx, setIdx] = useState(0);
    if (!images || images.length === 0) return null;
    const sorted = [...images].sort((a, b) => a.slide_index - b.slide_index);
    const current = sorted[idx];

    return (
        <div className="space-y-2">
            <div className="aspect-video bg-[#0F1419] rounded-xl overflow-hidden border border-[#6C757D]/20 relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={current.public_url}
                    alt={`Slide ${current.slide_index}`}
                    className="w-full h-full object-contain"
                />
                {sorted.length > 1 && (
                    <>
                        <button
                            onClick={() => setIdx(i => Math.max(0, i - 1))}
                            disabled={idx === 0}
                            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 disabled:opacity-30 transition-opacity"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => setIdx(i => Math.min(sorted.length - 1, i + 1))}
                            disabled={idx === sorted.length - 1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 disabled:opacity-30 transition-opacity"
                        >
                            <ChevronRight size={16} />
                        </button>
                        <span className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                            {idx + 1} / {sorted.length}
                        </span>
                    </>
                )}
            </div>
            {/* Thumbnails strip */}
            {sorted.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {sorted.map((img, i) => (
                        <button
                            key={img.slide_index}
                            onClick={() => setIdx(i)}
                            className={`flex-shrink-0 w-14 h-9 rounded overflow-hidden border-2 transition-colors ${
                                i === idx ? 'border-[#00D4B3]' : 'border-transparent opacity-50 hover:opacity-80'
                            }`}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.public_url} alt="" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── main component ──────────────────────────────────────────────────────────

export function MaterialResultCard({ result }: MaterialResultCardProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const {
        hasSlides, hasVideo, hasAvatar, hasAudio, hasBroll,
        slideImages, brollClips,
    } = detectAssets(result.assets);

    const hasId = Boolean(result.gamma_deck_id && result.gamma_deck_id !== 'NO-ID');

    const validVideoUrl =
        result.assets?.final_video_url || result.assets?.video_url || result.assets?.screencast_url;

    const copyToClipboard = (text: string) => {
        if (!text || text === 'NO-ID') return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_DELAY_MS);
    };

    const videoConfig = getEmbedVideoUrl(validVideoUrl);
    const gammaEmbedUrl = result.assets?.slides_url
        ? resolveGammaEmbedUrl(result.assets.slides_url)
        : null;

    return (
        <>
            {/* ── Card ── */}
            <div
                onClick={() => setIsOpen(true)}
                className="bg-[#151A21] border border-[#6C757D]/10 rounded-xl p-4 hover:border-[#00D4B3]/50 transition-all group flex flex-col h-full cursor-pointer hover:bg-[#1E2329] relative overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-br from-[#00D4B3]/0 to-[#00D4B3]/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

                {/* Header */}
                <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-[#0A2540] text-[#00D4B3] flex-shrink-0">
                            <TypeIcon type={result.type} size={16} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-[#94A3B8] text-[10px] font-bold uppercase tracking-wider mb-0.5">
                                {getTypeLabel(result.type)}
                            </p>
                            <span
                                className={`font-bold text-xs px-1.5 py-0.5 rounded font-mono border ${
                                    hasId
                                        ? 'bg-[#1E2329] text-white border-gray-700'
                                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                                }`}
                            >
                                {result.gamma_deck_id || 'SIN-ID'}
                            </span>
                        </div>
                    </div>
                    <StatusBadge status={result.production_status} />
                </div>

                {/* Body */}
                <div className="flex-grow relative z-10">
                    <h3
                        className="text-white font-medium text-sm line-clamp-2 group-hover:text-[#00D4B3] transition-colors"
                        title={result.lesson_title}
                    >
                        {result.lesson_title}
                    </h3>
                    <p className="text-[#6C757D] text-xs line-clamp-1 mt-1">{result.course_name}</p>
                </div>

                {/* Footer: asset badges + course code */}
                <div className="mt-3 pt-3 border-t border-[#6C757D]/10 flex items-center justify-between relative z-10">
                    <span className="text-[10px] text-gray-600 font-mono">{result.course_code}</span>
                    <div className="flex items-center gap-1">
                        <AssetDot present={hasSlides} icon={<Image size={9} />} label="Slides" />
                        <AssetDot present={hasVideo} icon={<Video size={9} />} label="Video" />
                        <AssetDot present={hasAvatar} icon={<UserCircle size={9} />} label="Avatar" />
                        <AssetDot present={hasAudio} icon={<Mic size={9} />} label="Audio voz" />
                        <AssetDot present={hasBroll} icon={<Film size={9} />} label="B-Roll" />
                    </div>
                </div>
            </div>

            {/* ── Detail Modal ── */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
                    onClick={() => setIsOpen(false)}
                >
                    <div
                        className="bg-[#151A21] w-full max-w-3xl rounded-2xl border border-[#6C757D]/20 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="p-5 border-b border-[#6C757D]/10 flex justify-between items-start bg-[#0F1419]">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[#00D4B3] text-[10px] font-bold uppercase tracking-wider bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">
                                        {getTypeLabel(result.type)}
                                    </span>
                                    <StatusBadge status={result.production_status} />
                                </div>
                                <h2 className="text-lg font-bold text-white leading-snug">{result.lesson_title}</h2>
                                <p className="text-[#94A3B8] text-xs mt-0.5 flex items-center gap-1">
                                    <Layout size={11} />
                                    {result.course_name} · {result.course_code}
                                </p>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="bg-[#1E2329] p-2 rounded-full text-gray-400 hover:text-white transition-colors flex-shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar">

                            {/* Meta grid */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-[#1E2329] p-3 rounded-xl border border-[#6C757D]/10">
                                    <h4 className="text-gray-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1">
                                        <Hash size={10} /> ID Compuesto
                                    </h4>
                                    <div className="flex items-center justify-between gap-2">
                                        <code className="text-[#00D4B3] font-mono text-xs truncate">
                                            {result.gamma_deck_id || '—'}
                                        </code>
                                        {hasId && (
                                            <button
                                                onClick={() => copyToClipboard(result.gamma_deck_id || '')}
                                                className="text-gray-400 hover:text-white flex-shrink-0"
                                                title="Copiar ID"
                                            >
                                                <Copy size={12} />
                                            </button>
                                        )}
                                    </div>
                                    {copied && <span className="text-[10px] text-green-400">Copiado!</span>}
                                </div>
                                <div className="bg-[#1E2329] p-3 rounded-xl border border-[#6C757D]/10">
                                    <h4 className="text-gray-500 text-[10px] uppercase font-bold mb-1 flex items-center gap-1">
                                        <Calendar size={10} /> Generado
                                    </h4>
                                    <span className="text-white text-sm">
                                        {result.updated_at
                                            ? new Date(result.updated_at).toLocaleDateString('es-MX', {
                                                  day: '2-digit', month: 'short', year: 'numeric',
                                              })
                                            : '—'}
                                    </span>
                                </div>
                            </div>

                            {/* Asset presence overview */}
                            <div>
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Assets del componente</h3>
                                <div className="grid grid-cols-5 gap-2">
                                    {[
                                        { present: hasSlides,  label: 'Slides',  icon: <Image size={16} /> },
                                        { present: hasVideo,   label: 'Video',   icon: <Video size={16} /> },
                                        { present: hasAvatar,  label: 'Avatar',  icon: <UserCircle size={16} /> },
                                        { present: hasAudio,   label: 'Audio',   icon: <Mic size={16} /> },
                                        { present: hasBroll,   label: 'B-Roll',  icon: <Film size={16} /> },
                                    ].map(({ present, label, icon }) => (
                                        <div
                                            key={label}
                                            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-colors ${
                                                present
                                                    ? 'bg-[#00D4B3]/8 border-[#00D4B3]/25 text-[#00D4B3]'
                                                    : 'bg-[#1E2329]/50 border-[#6C757D]/10 text-gray-600'
                                            }`}
                                        >
                                            {icon}
                                            <span className="text-[10px] font-medium leading-none">{label}</span>
                                            {present
                                                ? <CheckCircle2 size={10} className="text-[#00D4B3]" />
                                                : <span className="text-[10px] opacity-40">—</span>
                                            }
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Slides renderizables (SVG images from Open Design Export) */}
                            {slideImages.length > 0 && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <Image size={16} className="text-[#00D4B3]" />
                                        Slides Renderizables
                                        <span className="text-xs text-gray-500">({slideImages.length} imagen{slideImages.length !== 1 ? 'es' : ''})</span>
                                    </h3>
                                    <SlideGallery images={slideImages} />
                                </div>
                            )}

                            {/* Gamma Slides embed (fallback / legacy) */}
                            {gammaEmbedUrl && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <FileText size={16} className="text-[#00D4B3]" />
                                        Slides Gamma
                                    </h3>
                                    <div className="aspect-video bg-[#0F1419] rounded-xl overflow-hidden border border-[#6C757D]/20 relative group">
                                        <iframe
                                            src={gammaEmbedUrl}
                                            className="w-full h-full border-0"
                                            allow="fullscreen"
                                            title="Gamma Slides"
                                        />
                                        <a
                                            href={result.assets?.slides_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/80 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    </div>
                                </div>
                            )}

                            {/* Avatar video */}
                            {result.assets?.avatar_video?.public_url && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <UserCircle size={16} className="text-[#00D4B3]" />
                                        Video de Avatar
                                        {result.assets.avatar_video.duration && (
                                            <span className="text-xs text-gray-500">
                                                {Math.round(result.assets.avatar_video.duration)}s
                                            </span>
                                        )}
                                    </h3>
                                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-[#6C757D]/20">
                                        <video
                                            src={result.assets.avatar_video.public_url}
                                            controls
                                            className="w-full h-full"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Final / draft video */}
                            {validVideoUrl && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <Video size={16} className="text-[#00D4B3]" />
                                        Video de Producción
                                        {result.assets?.final_video_url && (
                                            <span className="text-xs text-green-400 border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 rounded">Final</span>
                                        )}
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
                                            <video src={videoConfig.url} controls className="w-full h-full" />
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Voice audio */}
                            {result.assets?.voice_audio?.public_url && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <Mic size={16} className="text-[#00D4B3]" />
                                        Audio de Voz
                                        {result.assets.voice_audio.duration && (
                                            <span className="text-xs text-gray-500">
                                                {Math.round(result.assets.voice_audio.duration)}s
                                            </span>
                                        )}
                                    </h3>
                                    <audio
                                        src={result.assets.voice_audio.public_url}
                                        controls
                                        className="w-full h-10 rounded-lg"
                                    />
                                </div>
                            )}

                            {/* Background music */}
                            {result.assets?.background_music?.public_url && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <Music size={16} className="text-[#00D4B3]" />
                                        Música de Fondo
                                    </h3>
                                    <audio
                                        src={result.assets.background_music.public_url}
                                        controls
                                        className="w-full h-10 rounded-lg"
                                    />
                                </div>
                            )}

                            {/* B-Roll clips */}
                            {brollClips.length > 0 && (
                                <div>
                                    <h3 className="text-white font-medium mb-3 flex items-center gap-2 text-sm">
                                        <Film size={16} className="text-[#00D4B3]" />
                                        Clips de B-Roll
                                        <span className="text-xs text-gray-500">({brollClips.length})</span>
                                    </h3>
                                    <div className="space-y-2">
                                        {brollClips.map((clip, i) => (
                                            <div key={clip.id ?? i} className="bg-[#1E2329] rounded-xl border border-[#6C757D]/10 overflow-hidden">
                                                {clip.public_url && (
                                                    <video
                                                        src={clip.public_url}
                                                        controls
                                                        muted
                                                        className="w-full max-h-40 object-cover bg-black"
                                                    />
                                                )}
                                                <div className="px-3 py-2 flex items-center justify-between">
                                                    <span className="text-xs text-gray-400">
                                                        Clip {i + 1}
                                                        {clip.duration ? ` · ${Math.round(clip.duration)}s` : ''}
                                                    </span>
                                                    {clip.prompt_used && (
                                                        <span
                                                            className="text-[10px] text-gray-500 truncate max-w-[200px]"
                                                            title={clip.prompt_used}
                                                        >
                                                            {clip.prompt_used}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Empty state */}
                            {!hasSlides && !hasVideo && !hasAvatar && !hasAudio && !hasBroll && (
                                <div className="p-8 bg-[#1E2329]/50 rounded-xl border border-dashed border-[#6C757D]/20 text-center text-gray-500 text-sm">
                                    <Layout size={24} className="mx-auto mb-2 opacity-20" />
                                    Sin assets de producción aún.
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-[#6C757D]/10 bg-[#0F1419] flex gap-3 justify-end items-center">
                            <StatusBadge status={result.production_status} className="mr-auto" />

                            {result.assets?.slides_url && (
                                <a
                                    href={result.assets.slides_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] px-4 py-2 rounded-lg font-medium transition-colors border border-[#00D4B3]/20 text-sm"
                                >
                                    <ExternalLink size={14} />
                                    Abrir en Gamma
                                </a>
                            )}

                            <button
                                onClick={() => setIsOpen(false)}
                                className="px-4 py-2 bg-[#1E2329] hover:bg-[#2D333B] text-white rounded-lg transition-colors text-sm"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── pure helpers (no hooks) ─────────────────────────────────────────────────

function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
    if (type.includes('VIDEO')) return <Video size={size} />;
    if (type === 'DEMO_GUIDE') return <MonitorPlay size={size} />;
    if (type === 'DIALOGUE') return <MessageSquare size={size} />;
    if (type === 'READING') return <BookOpen size={size} />;
    if (type === 'QUIZ') return <HelpCircle size={size} />;
    if (type === 'EXERCISE') return <Dumbbell size={size} />;
    return <FileText size={size} />;
}

function getTypeLabel(type: string): string {
    const map: Record<string, string> = {
        VIDEO_THEORETICAL: 'Video Teórico',
        VIDEO_GUIDE: 'Video Guía',
        VIDEO_DEMO: 'Video Demo',
        DEMO_GUIDE: 'Guía Interactiva',
        DIALOGUE: 'Diálogo',
        READING: 'Lectura',
        QUIZ: 'Quiz',
        EXERCISE: 'Ejercicio',
    };
    return map[type] ?? type.replace(/_/g, ' ');
}

function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
    const colors: Record<string, string> = {
        COMPLETED: 'text-green-400 border-green-500/30 bg-green-500/10',
        IN_PROGRESS: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
        DECK_READY: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
        EXPORTED: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    };
    const color = colors[status] ?? 'text-gray-400 border-gray-500/30 bg-gray-500/10';
    return (
        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${color} ${className}`}>
            {status}
        </span>
    );
}
