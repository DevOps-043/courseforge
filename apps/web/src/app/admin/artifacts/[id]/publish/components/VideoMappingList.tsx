'use client';

import { useState } from 'react';
import { Video, Youtube, Link as LinkIcon, AlertCircle, Clock, Loader2, RefreshCw } from 'lucide-react';
import { fetchVideoMetadata } from '../actions';
import { toast } from 'sonner';

export interface LessonVideoData {
    lesson_id: string;
    lesson_title: string;
    module_title: string;
    video_provider: 'youtube' | 'vimeo' | 'direct';
    video_id: string;
    duration: number; // seconds
}

interface VideoMappingListProps {
    lessons: Array<{
        id: string;
        title: string;
        module_title: string;
    }>;
    mappings: Record<string, LessonVideoData>;
    onMappingChange: (mappings: Record<string, LessonVideoData>) => void;
}

export function VideoMappingList({ lessons, mappings, onMappingChange }: VideoMappingListProps) {
    const [syncingId, setSyncingId] = useState<string | null>(null);

    const handleUpdate = (lessonId: string, field: keyof LessonVideoData, value: any) => {
        // Find base lesson info
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return;

        const currentMapping = mappings[lessonId] || {
            lesson_id: lessonId,
            lesson_title: lesson.title,
            module_title: lesson.module_title,
            video_provider: 'youtube',
            video_id: '',
            duration: 0
        };

        // If updating URL/ID, try to auto-detect provider
        let shouldAutoSync = false;
        if (field === 'video_id') {
            const { provider, id } = detectVideoProvider(value);
            if (provider) {
                currentMapping.video_provider = provider;
                currentMapping.video_id = id;
                shouldAutoSync = true; // Auto-sync duration for YT/Vimeo
            } else {
                currentMapping.video_id = value;
            }
        } else {
            (currentMapping as any)[field] = value;
        }

        const newMappings = { ...mappings, [lessonId]: currentMapping };
        // No local state update, only notify parent
        onMappingChange(newMappings);

        // Auto-sync duration when a YouTube/Vimeo video is detected
        if (shouldAutoSync && currentMapping.video_id) {
            // Small delay to let state propagate before syncing
            setTimeout(() => handleSyncDuration(lessonId), 100);
        }
    };

    const detectVideoProvider = (url: string): { provider: 'youtube' | 'vimeo' | null, id: string } => {
        // Basic regex for YT/Vimeo
        const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
        const vimeoRegex = /vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/;

        const ytMatch = url.match(ytRegex);
        if (ytMatch) return { provider: 'youtube', id: ytMatch[1] };

        const vimeoMatch = url.match(vimeoRegex);
        if (vimeoMatch) return { provider: 'vimeo', id: vimeoMatch[1] };

        return { provider: null, id: url };
    };

    const handleSyncDuration = async (lessonId: string) => {
        const mapping = mappings[lessonId];
        if (!mapping || !mapping.video_id) return;

        setSyncingId(lessonId);
        try {
            let url = mapping.video_id;
            // Construct full URL if it's just an ID
            if (mapping.video_provider === 'youtube' && !url.includes('http')) {
                url = `https://www.youtube.com/watch?v=${mapping.video_id}`;
            } else if (mapping.video_provider === 'vimeo' && !url.includes('http')) {
                url = `https://vimeo.com/${mapping.video_id}`;
            }

            const metadata = await fetchVideoMetadata(url);

            if (metadata.duration > 0) {
                handleUpdate(lessonId, 'duration', metadata.duration);
                toast.success(`Duración actualizada: ${formatDuration(metadata.duration)}`);
            } else {
                toast.error("No se pudo obtener la duración. Verifica que el video sea público.");
            }
        } catch (error) {
            console.error(error);
            toast.error("Error al sincronizar duración.");
        } finally {
            setSyncingId(null);
        }
    };

    const formatDuration = (seconds: number): string => {
        if (!seconds) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const parseDuration = (input: string): number => {
        // Remove non-numeric chars except colon
        const clean = input.replace(/[^\d:]/g, '');

        if (clean.includes(':')) {
            const parts = clean.split(':');
            const m = parseInt(parts[0] || '0', 10);
            const s = parseInt(parts[1] || '0', 10);
            return (m * 60) + s;
        } else {
            // Assume raw seconds if no colon, or try to interpret sensible input
            return parseInt(clean || '0', 10);
        }
    };

    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                2. Asignación de Videos
            </h3>

            <div className="space-y-6">
                {lessons.map((lesson) => {
                    const mapping = mappings[lesson.id] || { video_provider: 'youtube', video_id: '', duration: 0 };

                    return (
                        <div key={lesson.id} className="p-4 border border-gray-100 dark:border-[#6C757D]/10 rounded-xl bg-gray-50/50 dark:bg-[#0F1419]/50">
                            <div className="mb-3">
                                <span className="text-xs font-semibold text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded-md uppercase tracking-wide">
                                    {lesson.module_title}
                                </span>
                                <p className="font-medium text-gray-900 dark:text-white mt-1">
                                    {lesson.title}
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                {/* Provider Selector */}
                                <div className="md:col-span-3">
                                    <select
                                        className="w-full bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300"
                                        value={mapping.video_provider}
                                        onChange={(e) => handleUpdate(lesson.id, 'video_provider', e.target.value)}
                                    >
                                        <option value="youtube">YouTube</option>
                                        <option value="vimeo">Vimeo</option>
                                        <option value="direct">MP4 Directo</option>
                                    </select>
                                </div>

                                {/* ID Input */}
                                <div className="md:col-span-9 relative">
                                    <div className="relative">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                            {mapping.video_provider === 'youtube' && <Youtube size={16} />}
                                            {mapping.video_provider === 'vimeo' && <Video size={16} />}
                                            {mapping.video_provider === 'direct' && <LinkIcon size={16} />}
                                        </div>
                                        <input
                                            type="text"
                                            placeholder={
                                                mapping.video_provider === 'youtube' ? "Pegar URL de YouTube o ID..." :
                                                    mapping.video_provider === 'vimeo' ? "Pegar URL de Vimeo o ID..." :
                                                        "URL del archivo de video..."
                                            }
                                            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg text-sm focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none"
                                            value={mapping.video_id}
                                            onChange={(e) => handleUpdate(lesson.id, 'video_id', e.target.value)}
                                        />
                                    </div>
                                    {mapping.video_id && mapping.video_provider === 'youtube' && mapping.video_id.length !== 11 && (
                                        <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
                                            <AlertCircle size={12} /> ID de YouTube parece inválido (debe ser 11 caracteres)
                                        </p>
                                    )}
                                </div>

                                {/* Duration Input (Optional/Auto in future) */}
                                <div className="md:col-span-12 flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-500 dark:text-gray-400">Duración (MM:SS):</label>
                                        <input
                                            type="text"
                                            placeholder="00:00"
                                            className="w-24 px-2 py-1 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-md text-sm text-center font-mono dark:text-gray-200"
                                            value={formatDuration(mapping.duration)}
                                            onChange={(e) => {
                                                const seconds = parseDuration(e.target.value);
                                                handleUpdate(lesson.id, 'duration', seconds);
                                            }}
                                            onBlur={(e) => {
                                                const seconds = parseDuration(e.target.value);
                                            }}
                                        />
                                    </div>
                                    {mapping.video_id && (
                                        <>
                                            <button
                                                onClick={() => handleSyncDuration(lesson.id)}
                                                disabled={syncingId === lesson.id}
                                                className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 disabled:opacity-50"
                                                title="Sincronizar duración exacta desde YouTube/Vimeo"
                                            >
                                                {syncingId === lesson.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                                Sinc.
                                            </button>
                                            <a
                                                href={
                                                    mapping.video_provider === 'youtube' ? `https://www.youtube.com/watch?v=${mapping.video_id}` :
                                                        mapping.video_provider === 'vimeo' ? `https://vimeo.com/${mapping.video_id}` :
                                                            mapping.video_id
                                                }
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                            >
                                                Probár enlace ↗
                                            </a>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {lessons.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No se encontraron lecciones en este curso.</p>
                )}
            </div>
        </div>
    );
}
