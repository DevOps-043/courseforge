'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Video, Youtube, Link as LinkIcon, AlertCircle, Clock, Loader2, RefreshCw, ChevronDown, CheckSquare, Square, MinusSquare, Info } from 'lucide-react';
import { fetchVideoMetadata } from '../actions';
import { toast } from 'sonner';

// Helper function to sync duration supporting both client-side MP4 and server-side YT/Vimeo
export async function syncVideoDuration(provider: 'youtube' | 'vimeo' | 'direct', videoId: string): Promise<number> {
    if (!videoId) return 0;

    if (provider === 'direct') {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.crossOrigin = 'anonymous';
            
            video.onloadedmetadata = () => {
                const durationRaw = video.duration;
                if (!isNaN(durationRaw) && durationRaw > 0) {
                    resolve(Math.round(durationRaw));
                } else {
                    reject(new Error("No se pudo leer la duración del archivo."));
                }
            };
            
            video.onerror = () => {
                reject(new Error("No se pudo obtener la duración del MP4. Verifica el enlace y bloqueadores (CORS)."));
            };
            
            video.src = videoId;
        });
    }

    // Server-side extraction for YouTube/Vimeo
    let url = videoId;
    if (provider === 'youtube' && !url.includes('http')) {
        url = `https://www.youtube.com/watch?v=${videoId}`;
    } else if (provider === 'vimeo' && !url.includes('http')) {
        url = `https://vimeo.com/${videoId}`;
    }

    const metadata = await fetchVideoMetadata(url);
    return metadata.duration || 0;
}

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
    selectedLessons: Set<string>;
    onSelectionChange: (selected: Set<string>) => void;
}

// Group lessons by module_title, preserving order
function groupByModule(lessons: Array<{ id: string; title: string; module_title: string }>) {
    const groups: Array<{ moduleTitle: string; lessons: typeof lessons }> = [];
    const seen = new Map<string, number>();

    for (const lesson of lessons) {
        const key = lesson.module_title || 'Módulo General';
        if (seen.has(key)) {
            groups[seen.get(key)!].lessons.push(lesson);
        } else {
            seen.set(key, groups.length);
            groups.push({ moduleTitle: key, lessons: [lesson] });
        }
    }
    return groups;
}

// Indeterminate checkbox component
function IndeterminateCheckbox({ checked, indeterminate, disabled, onChange, className }: {
    checked: boolean;
    indeterminate: boolean;
    disabled?: boolean;
    onChange: () => void;
    className?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);

    return (
        <input
            ref={ref}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            className={`w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#00D4B3] focus:ring-[#00D4B3]/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${className || ''}`}
        />
    );
}

export function VideoMappingList({ lessons, mappings, onMappingChange, selectedLessons, onSelectionChange }: VideoMappingListProps) {
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

    const hasVideo = useCallback((lessonId: string) => !!mappings[lessonId]?.video_id, [mappings]);

    // Toggle collapse for a module
    const toggleCollapse = (moduleTitle: string) => {
        setCollapsedModules(prev => {
            const next = new Set(prev);
            if (next.has(moduleTitle)) {
                next.delete(moduleTitle);
            } else {
                next.add(moduleTitle);
            }
            return next;
        });
    };

    // Toggle selection for a single lesson
    const toggleLesson = (lessonId: string) => {
        if (!hasVideo(lessonId)) return;
        const next = new Set(selectedLessons);
        if (next.has(lessonId)) {
            next.delete(lessonId);
        } else {
            next.add(lessonId);
        }
        onSelectionChange(next);
    };

    // Toggle selection for an entire module
    const toggleModule = (moduleLessons: Array<{ id: string }>) => {
        const selectableLessons = moduleLessons.filter(l => hasVideo(l.id));
        if (selectableLessons.length === 0) return;

        const allSelected = selectableLessons.every(l => selectedLessons.has(l.id));
        const next = new Set(selectedLessons);

        if (allSelected) {
            // Deselect all selectable
            selectableLessons.forEach(l => next.delete(l.id));
        } else {
            // Select all selectable
            selectableLessons.forEach(l => next.add(l.id));
        }
        onSelectionChange(next);
    };

    // Get module checkbox state
    const getModuleCheckState = (moduleLessons: Array<{ id: string }>) => {
        const selectable = moduleLessons.filter(l => hasVideo(l.id));
        if (selectable.length === 0) return { checked: false, indeterminate: false, disabled: true };

        const selectedCount = selectable.filter(l => selectedLessons.has(l.id)).length;
        return {
            checked: selectedCount === selectable.length,
            indeterminate: selectedCount > 0 && selectedCount < selectable.length,
            disabled: false,
        };
    };

    const handleUpdate = (lessonId: string, field: keyof LessonVideoData, value: any) => {
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

        let shouldAutoSync = false;
        if (field === 'video_id') {
            const { provider, id } = detectVideoProvider(value);
            if (provider) {
                currentMapping.video_provider = provider;
                currentMapping.video_id = id;
                shouldAutoSync = true;
            } else {
                currentMapping.video_id = value;
            }
        } else {
            (currentMapping as any)[field] = value;
        }

        const newMappings = { ...mappings, [lessonId]: currentMapping };
        onMappingChange(newMappings);

        // Auto-select lesson when video is added
        if (field === 'video_id' && value && !selectedLessons.has(lessonId)) {
            const next = new Set(selectedLessons);
            next.add(lessonId);
            onSelectionChange(next);
        }

        // Auto-deselect lesson when video is removed
        if (field === 'video_id' && !value && selectedLessons.has(lessonId)) {
            const next = new Set(selectedLessons);
            next.delete(lessonId);
            onSelectionChange(next);
        }

        if (shouldAutoSync && currentMapping.video_id) {
            setTimeout(() => handleSyncDuration(lessonId), 100);
        }
    };

    const detectVideoProvider = (url: string): { provider: 'youtube' | 'vimeo' | null, id: string } => {
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
            const durationSec = await syncVideoDuration(mapping.video_provider, mapping.video_id);
            if (durationSec > 0) {
                handleUpdate(lessonId, 'duration', durationSec);
                toast.success(`Duración actualizada: ${formatDuration(durationSec)}`);
            } else {
                toast.error("No se pudo obtener la duración. Verifica que el video sea válido y público.");
            }
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Error al sincronizar duración.");
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
        const clean = input.replace(/[^\d:]/g, '');
        if (clean.includes(':')) {
            const parts = clean.split(':');
            const m = parseInt(parts[0] || '0', 10);
            const s = parseInt(parts[1] || '0', 10);
            return (m * 60) + s;
        } else {
            return parseInt(clean || '0', 10);
        }
    };

    const moduleGroups = groupByModule(lessons);
    const totalSelected = lessons.filter(l => selectedLessons.has(l.id)).length;
    const totalWithVideo = lessons.filter(l => hasVideo(l.id)).length;

    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                    2. Asignación de Videos y Selección para Envío
                </h3>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                    {totalSelected}/{totalWithVideo} seleccionadas para envío
                </span>
            </div>

            {/* Info indicator */}
            <div className="flex items-center gap-2 mb-5 text-xs text-gray-500 dark:text-gray-400">
                <Info size={14} className="shrink-0" />
                <span>Marca las lecciones que deseas incluir en el envío a SofLIA. Solo las lecciones con video asignado pueden seleccionarse.</span>
            </div>

            {/* Module groups */}
            <div className="space-y-4">
                {moduleGroups.map(({ moduleTitle, lessons: moduleLessons }) => {
                    const isCollapsed = collapsedModules.has(moduleTitle);
                    const checkState = getModuleCheckState(moduleLessons);
                    const selectedInModule = moduleLessons.filter(l => selectedLessons.has(l.id)).length;
                    const selectableInModule = moduleLessons.filter(l => hasVideo(l.id)).length;

                    return (
                        <div key={moduleTitle} className="border border-gray-100 dark:border-[#6C757D]/10 rounded-xl overflow-hidden">
                            {/* Module Header */}
                            <div
                                className="flex items-center gap-3 px-4 py-3 bg-gray-50/80 dark:bg-[#0F1419]/80 cursor-pointer hover:bg-gray-100/80 dark:hover:bg-[#0F1419] transition-colors select-none"
                                onClick={() => toggleCollapse(moduleTitle)}
                            >
                                {/* Module checkbox */}
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleModule(moduleLessons);
                                    }}
                                >
                                    <IndeterminateCheckbox
                                        checked={checkState.checked}
                                        indeterminate={checkState.indeterminate}
                                        disabled={checkState.disabled}
                                        onChange={() => toggleModule(moduleLessons)}
                                    />
                                </div>

                                {/* Module title */}
                                <div className="flex-1 min-w-0">
                                    <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                        {moduleTitle}
                                    </span>
                                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                                        {selectedInModule}/{selectableInModule} lecciones seleccionadas
                                    </span>
                                </div>

                                {/* Expand/collapse chevron */}
                                <ChevronDown
                                    size={18}
                                    className={`text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                                />
                            </div>

                            {/* Module lessons (collapsible) */}
                            <div
                                className={`transition-all duration-200 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0' : 'max-h-[5000px]'}`}
                            >
                                <div className="divide-y divide-gray-100 dark:divide-[#6C757D]/10">
                                    {moduleLessons.map((lesson) => {
                                        const mapping = mappings[lesson.id] || { video_provider: 'youtube', video_id: '', duration: 0 };
                                        const lessonHasVideo = hasVideo(lesson.id);
                                        const isSelected = selectedLessons.has(lesson.id);

                                        return (
                                            <div
                                                key={lesson.id}
                                                className={`p-4 transition-colors ${!lessonHasVideo ? 'opacity-60 bg-gray-50/30 dark:bg-gray-900/20' : ''}`}
                                            >
                                                {/* Lesson header with checkbox */}
                                                <div className="flex items-start gap-3 mb-3">
                                                    <div className="pt-0.5">
                                                        <IndeterminateCheckbox
                                                            checked={isSelected}
                                                            indeterminate={false}
                                                            disabled={!lessonHasVideo}
                                                            onChange={() => toggleLesson(lesson.id)}
                                                        />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm text-gray-900 dark:text-white">
                                                            {lesson.title}
                                                        </p>
                                                        {/* Selection status indicator */}
                                                        {lessonHasVideo ? (
                                                            <span className={`text-xs mt-0.5 inline-block ${isSelected ? 'text-[#00D4B3]' : 'text-gray-400'}`}>
                                                                {isSelected ? '✓ Incluida en envío' : '— Excluida del envío'}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-orange-500 dark:text-orange-400 mt-0.5 inline-flex items-center gap-1">
                                                                <AlertCircle size={11} />
                                                                Sin video — no disponible para envío
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Video mapping fields */}
                                                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 ml-7">
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
                                                            
                                                            {/* Mask Supabase URLs */}
                                                            {mapping.video_provider === 'direct' && mapping.video_id.includes('supabase.co') ? (
                                                                <div className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg text-sm flex items-center justify-between group">
                                                                    <div className="flex items-center gap-2 truncate text-[#00D4B3]">
                                                                        <span className="truncate font-medium">Video Interno de Plataforma</span>
                                                                        <span className="text-xs text-gray-400 truncate max-w-[150px] opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            ({mapping.video_id.split('/').pop()?.substring(0, 15)}...)
                                                                        </span>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleUpdate(lesson.id, 'video_id', '')}
                                                                        className="text-xs text-gray-500 hover:text-red-500 transition-colors ml-2 flex-shrink-0 font-medium"
                                                                        title="Eliminar este enlace"
                                                                    >
                                                                        Eliminar
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <input
                                                                    type="text"
                                                                    placeholder={
                                                                        mapping.video_provider === 'youtube' ? "Pegar URL de YouTube o ID..." :
                                                                            mapping.video_provider === 'vimeo' ? "Pegar URL de Vimeo o ID..." :
                                                                                "URL del archivo de video (.mp4)..."
                                                                    }
                                                                    className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg text-sm focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none"
                                                                    value={mapping.video_id}
                                                                    onChange={(e) => handleUpdate(lesson.id, 'video_id', e.target.value)}
                                                                />
                                                            )}
                                                        </div>
                                                        {mapping.video_id && mapping.video_provider === 'youtube' && mapping.video_id.length !== 11 && (
                                                            <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
                                                                <AlertCircle size={12} /> ID de YouTube parece inválido (debe ser 11 caracteres)
                                                            </p>
                                                        )}
                                                    </div>

                                                    {/* Duration Input */}
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
