'use client';

import { useMemo, useState } from 'react';
import {
    CheckCircle2,
    Copy,
    ExternalLink,
    Film,
    Image,
    Layout,
    Mic,
    Music,
    Video,
    X,
} from 'lucide-react';
import { getEmbedVideoUrl } from '@/lib/video-platform';
import { COPY_FEEDBACK_RESET_DELAY_MS } from '@/shared/constants/timing';
import {
    getLibraryComponentTypeLabel,
    getLibraryItemIcon,
} from '@/domains/library/library-catalog';
import type { MaterialSearchResult } from '../actions';
import type { MaterialAssets } from '@/domains/materials/types/materials.types';

interface LibraryResultCardProps {
    result: MaterialSearchResult;
}

function detectAssets(assets: MaterialAssets | null) {
    const a = assets ?? {};
    return {
        hasAvatar: Boolean(a.avatar_video?.public_url || a.avatar_clips?.some((clip) => clip.public_url)),
        hasBroll: (a.b_roll_clips?.length ?? 0) > 0,
        hasMusic: Boolean(a.background_music?.public_url),
        hasSlides: Boolean((a.slides?.images?.length ?? 0) > 0 || a.slides?.html_public_url || a.slides_url),
        hasVideo: Boolean(a.final_video_url || a.video_url || a.screencast_url),
        hasVoice: Boolean(a.voice_audio?.public_url || a.voice_clips?.some((clip) => clip.public_url)),
        slideImages: a.slides?.images ?? [],
        brollClips: a.b_roll_clips ?? [],
    };
}

function AssetSignal({
    active,
    icon,
    label,
}: {
    active: boolean;
    icon: React.ReactNode;
    label: string;
}) {
    return (
        <span
            title={label}
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                active
                    ? 'border-[var(--engine-accent)]/40 bg-[var(--engine-accent)]/15 text-[var(--engine-accent)]'
                    : 'border-gray-600/20 bg-gray-500/10 text-gray-600'
            }`}
        >
            {icon}
        </span>
    );
}

function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
    const colors: Record<string, string> = {
        COMPLETED: 'text-green-400 border-green-500/30 bg-green-500/10',
        DECK_READY: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
        EXPORTED: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
        IN_PROGRESS: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
        PENDING: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
    };
    return (
        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${colors[status] ?? colors.PENDING} ${className}`}>
            {status}
        </span>
    );
}

function SlideGallery({ images }: { images: NonNullable<MaterialAssets['slides']>['images'] }) {
    const [index, setIndex] = useState(0);
    if (!images || images.length === 0) return null;

    const sorted = [...images].sort((left, right) => left.slide_index - right.slide_index);
    const current = sorted[index];

    return (
        <div className="space-y-2">
            <div className="aspect-video overflow-hidden rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={current.public_url}
                    alt={`Slide ${current.slide_index}`}
                    className="h-full w-full object-contain"
                />
            </div>
            {sorted.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {sorted.map((image, itemIndex) => (
                        <button
                            key={`${image.storage_path}-${image.slide_index}`}
                            type="button"
                            onClick={() => setIndex(itemIndex)}
                            className={`h-9 w-14 flex-shrink-0 overflow-hidden rounded border ${
                                itemIndex === index ? 'border-[var(--engine-accent)]' : 'border-transparent opacity-60'
                            }`}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.public_url} alt="" className="h-full w-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function LibraryResultCard({ result }: LibraryResultCardProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const assetState = detectAssets(result.assets);
    const Icon = getLibraryItemIcon(result.assetType || result.componentType, result.kind);
    const primaryUrl = result.publicUrl || result.assets?.final_video_url || result.assets?.slides?.html_public_url || result.assets?.slides_url;
    const videoUrl = result.assets?.final_video_url || result.assets?.video_url || result.assets?.screencast_url;
    const videoConfig = useMemo(() => getEmbedVideoUrl(videoUrl), [videoUrl]);

    const copyToClipboard = (text: string | undefined) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_DELAY_MS);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="flex h-full flex-col rounded-lg border border-[var(--engine-muted)]/10 bg-[var(--engine-surface-solid)] p-4 text-left transition-colors hover:border-[var(--engine-accent)]/50 hover:bg-[var(--engine-surface-hover)]"
            >
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--engine-primary)] text-[var(--engine-accent)]">
                            <Icon size={17} />
                        </span>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--engine-text-muted)]">
                                {result.kind === 'asset'
                                    ? result.assetTypeLabel
                                    : getLibraryComponentTypeLabel(result.componentType)}
                            </p>
                            <p className="truncate text-xs text-gray-400">
                                {result.kind === 'asset' ? result.fileName : 'Material generado'}
                            </p>
                        </div>
                    </div>
                    <StatusBadge status={result.productionStatus} />
                </div>

                <div className="min-h-16 flex-1">
                    <h3 className="line-clamp-2 text-sm font-semibold text-white">{result.title}</h3>
                    <p className="mt-1 line-clamp-1 text-xs text-[var(--engine-text-muted)]">{result.workshopName}</p>
                    <p className="mt-1 line-clamp-1 text-[11px] text-gray-500">
                        {result.folderPath.company} / {result.folderPath.lesson}
                    </p>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-[var(--engine-muted)]/10 pt-3">
                    <span className="truncate font-mono text-[10px] text-gray-600">{result.courseCode}</span>
                    <div className="flex items-center gap-1">
                        <AssetSignal active={assetState.hasSlides} icon={<Image size={9} />} label="Slides" />
                        <AssetSignal active={assetState.hasVideo} icon={<Video size={9} />} label="Video" />
                        <AssetSignal active={assetState.hasAvatar} icon={<Layout size={9} />} label="Avatar" />
                        <AssetSignal active={assetState.hasVoice} icon={<Mic size={9} />} label="Voz" />
                        <AssetSignal active={assetState.hasMusic} icon={<Music size={9} />} label="Musica" />
                        <AssetSignal active={assetState.hasBroll} icon={<Film size={9} />} label="B-roll" />
                    </div>
                </div>
            </button>

            {isOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
                    onClick={() => setIsOpen(false)}
                >
                    <div
                        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-surface-solid)] shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-[var(--engine-muted)]/10 bg-[var(--engine-canvas)] p-5">
                            <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <span className="rounded border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--engine-accent)]">
                                        {result.kind === 'asset'
                                            ? result.assetTypeLabel
                                            : getLibraryComponentTypeLabel(result.componentType)}
                                    </span>
                                    <StatusBadge status={result.productionStatus} />
                                </div>
                                <h2 className="text-lg font-bold leading-snug text-white">{result.title}</h2>
                                <p className="mt-1 text-xs text-[var(--engine-text-muted)]">
                                    {result.folderPath.company} / {result.folderPath.workshop} / {result.folderPath.lesson}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="rounded-full bg-[var(--engine-surface-hover)] p-2 text-gray-400 transition-colors hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-5 overflow-y-auto p-5">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="rounded-lg border border-[var(--engine-muted)]/10 bg-[var(--engine-surface-hover)] p-3">
                                    <h4 className="mb-1 text-[10px] font-bold uppercase text-gray-500">Archivo o contenido</h4>
                                    <p className="truncate text-sm text-white">{result.fileName || result.title}</p>
                                    {result.storagePath && (
                                        <p className="mt-1 truncate font-mono text-[11px] text-gray-500">{result.storagePath}</p>
                                    )}
                                </div>
                                <div className="rounded-lg border border-[var(--engine-muted)]/10 bg-[var(--engine-surface-hover)] p-3">
                                    <h4 className="mb-1 text-[10px] font-bold uppercase text-gray-500">Actualizado</h4>
                                    <p className="text-sm text-white">
                                        {new Date(result.updatedAt).toLocaleDateString('es-MX', {
                                            day: '2-digit',
                                            month: 'short',
                                            year: 'numeric',
                                        })}
                                    </p>
                                </div>
                            </div>

                            <div>
                                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Assets del componente</h3>
                                <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                                    {[
                                        { active: assetState.hasSlides, label: 'Slides', icon: <Image size={16} /> },
                                        { active: assetState.hasVideo, label: 'Video', icon: <Video size={16} /> },
                                        { active: assetState.hasAvatar, label: 'Avatar', icon: <Layout size={16} /> },
                                        { active: assetState.hasVoice, label: 'Voz', icon: <Mic size={16} /> },
                                        { active: assetState.hasMusic, label: 'Musica', icon: <Music size={16} /> },
                                        { active: assetState.hasBroll, label: 'B-roll', icon: <Film size={16} /> },
                                    ].map((asset) => (
                                        <div
                                            key={asset.label}
                                            className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center ${
                                                asset.active
                                                    ? 'border-[var(--engine-accent)]/25 bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]'
                                                    : 'border-[var(--engine-muted)]/10 bg-[var(--engine-surface-hover)]/50 text-gray-600'
                                            }`}
                                        >
                                            {asset.icon}
                                            <span className="text-[10px] font-medium leading-none">{asset.label}</span>
                                            {asset.active ? <CheckCircle2 size={10} /> : <span className="text-[10px] opacity-40">-</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {assetState.slideImages.length > 0 && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Image size={16} className="text-[var(--engine-accent)]" />
                                        Slides renderizables
                                    </h3>
                                    <SlideGallery images={assetState.slideImages} />
                                </section>
                            )}

                            {videoUrl && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Video size={16} className="text-[var(--engine-accent)]" />
                                        Video
                                    </h3>
                                    <div className="aspect-video overflow-hidden rounded-lg border border-[var(--engine-muted)]/20 bg-black">
                                        {videoConfig.isEmbed ? (
                                            <iframe
                                                src={videoConfig.url}
                                                className="h-full w-full"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            />
                                        ) : (
                                            <video src={videoConfig.url} controls className="h-full w-full" />
                                        )}
                                    </div>
                                </section>
                            )}

                            {result.assets?.avatar_video?.public_url && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Layout size={16} className="text-[var(--engine-accent)]" />
                                        Avatar
                                    </h3>
                                    <video src={result.assets.avatar_video.public_url} controls className="max-h-80 w-full rounded-lg bg-black" />
                                </section>
                            )}

                            {result.assets?.voice_audio?.public_url && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Mic size={16} className="text-[var(--engine-accent)]" />
                                        Voz
                                    </h3>
                                    <audio src={result.assets.voice_audio.public_url} controls className="h-10 w-full" />
                                </section>
                            )}

                            {(result.assets?.voice_clips?.length ?? 0) > 0 && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Mic size={16} className="text-[var(--engine-accent)]" />
                                        Voces por escena
                                    </h3>
                                    <div className="space-y-2">
                                        {result.assets!.voice_clips!
                                            .slice()
                                            .sort((left, right) => left.order - right.order)
                                            .map((clip) => (
                                                <div key={clip.id} className="rounded-lg border border-white/10 p-2">
                                                    <p className="mb-1 text-xs text-gray-300">Escena {clip.order}</p>
                                                    <audio src={clip.public_url} controls className="h-10 w-full" />
                                                </div>
                                            ))}
                                    </div>
                                </section>
                            )}

                            {result.assets?.background_music?.public_url && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Music size={16} className="text-[var(--engine-accent)]" />
                                        Musica
                                    </h3>
                                    <audio src={result.assets.background_music.public_url} controls className="h-10 w-full" />
                                </section>
                            )}

                            {assetState.brollClips.length > 0 && (
                                <section>
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                                        <Film size={16} className="text-[var(--engine-accent)]" />
                                        B-roll
                                    </h3>
                                    <div className="space-y-2">
                                        {assetState.brollClips.map((clip, index) => (
                                            <div key={clip.id || `${clip.storage_path}-${index}`} className="overflow-hidden rounded-lg border border-[var(--engine-muted)]/10 bg-[var(--engine-surface-hover)]">
                                                {clip.public_url && (
                                                    <video src={clip.public_url} controls muted className="max-h-44 w-full bg-black object-cover" />
                                                )}
                                                <div className="flex items-center justify-between gap-3 px-3 py-2">
                                                    <span className="truncate text-xs text-gray-400">{clip.file_name || `Clip ${index + 1}`}</span>
                                                    {clip.duration && <span className="text-[10px] text-gray-500">{Math.round(clip.duration)}s</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 border-t border-[var(--engine-muted)]/10 bg-[var(--engine-canvas)] p-4">
                            <StatusBadge status={result.productionStatus} className="mr-auto" />
                            {primaryUrl && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(primaryUrl)}
                                        className="flex items-center gap-2 rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-surface-hover)] px-4 py-2 text-sm text-white transition-colors hover:bg-[#2D333B]"
                                    >
                                        <Copy size={14} />
                                        Copiar URL
                                    </button>
                                    <a
                                        href={primaryUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-2 rounded-lg border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--engine-accent)] transition-colors hover:bg-[var(--engine-accent)]/20"
                                    >
                                        <ExternalLink size={14} />
                                        Abrir
                                    </a>
                                </>
                            )}
                            {copied && <span className="text-[10px] text-green-400">Copiado</span>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

