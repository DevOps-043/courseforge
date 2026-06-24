'use client';

import { useEffect, useState } from 'react';
import { Search, Filter, Loader2, Library as LibraryIcon, X } from 'lucide-react';
import { searchMaterialsAction, MaterialSearchResult } from './actions';
import { MaterialResultCard } from './components/MaterialResultCard';
import { toast } from 'sonner';

const COMPONENT_TYPES = [
    { value: 'ALL', label: 'Todos los tipos' },
    { value: 'VIDEO_THEORETICAL', label: 'Video Teórico' },
    { value: 'VIDEO_GUIDE', label: 'Video Guía' },
    { value: 'VIDEO_DEMO', label: 'Video Demo' },
    { value: 'DEMO_GUIDE', label: 'Guía Interactiva' },
    { value: 'DIALOGUE', label: 'Diálogo' },
    { value: 'READING', label: 'Lectura' },
    { value: 'QUIZ', label: 'Quiz' },
    { value: 'EXERCISE', label: 'Ejercicio' },
];

const PRODUCTION_STATUSES = [
    { value: 'ALL', label: 'Todos los estados' },
    { value: 'PENDING', label: 'Pendiente' },
    { value: 'IN_PROGRESS', label: 'En Progreso' },
    { value: 'DECK_READY', label: 'Deck Listo' },
    { value: 'EXPORTED', label: 'Exportado' },
    { value: 'COMPLETED', label: 'Completado' },
];

const ASSET_PRESENCE = [
    { value: 'ALL', label: 'Cualquier asset' },
    { value: 'has_slides', label: 'Tiene Slides' },
    { value: 'has_video', label: 'Tiene Video' },
    { value: 'has_avatar', label: 'Tiene Avatar' },
    { value: 'has_audio', label: 'Tiene Audio' },
    { value: 'has_broll', label: 'Tiene B-Roll' },
];

export default function LibraryPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MaterialSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const [showFilters, setShowFilters] = useState(false);
    const [selectedType, setSelectedType] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState('ALL');
    const [selectedAssetPresence, setSelectedAssetPresence] = useState('ALL');

    const filtersActive =
        selectedType !== 'ALL' || selectedStatus !== 'ALL' || selectedAssetPresence !== 'ALL';

    const runSearch = async (q: string, type: string, status: string, assetPresence: string) => {
        setIsSearching(true);
        setHasSearched(true);
        setResults([]);
        try {
            const response = await searchMaterialsAction(q, { type, status, assetPresence: assetPresence as any });
            if (response.success && response.results) {
                setResults(response.results);
                if (response.results.length === 0 && (q || filtersActive)) {
                    toast('No se encontraron materiales con esos criterios');
                }
            } else {
                toast.error('Error al buscar materiales');
            }
        } catch {
            toast.error('Error inesperado al buscar');
        } finally {
            setIsSearching(false);
        }
    };

    // Auto-load on mount
    useEffect(() => {
        runSearch('', 'ALL', 'ALL', 'ALL');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        runSearch(query, selectedType, selectedStatus, selectedAssetPresence);
    };

    const clearFilters = () => {
        setSelectedType('ALL');
        setSelectedStatus('ALL');
        setSelectedAssetPresence('ALL');
        setQuery('');
        runSearch('', 'ALL', 'ALL', 'ALL');
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <LibraryIcon className="text-[#00D4B3]" />
                        Librería de Assets
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Busca y explora todos los assets de producción: slides, videos, avatar, audio y b-roll
                    </p>
                </div>
                {hasSearched && !isSearching && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                        {results.length} resultado{results.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {/* Search Bar & Filters */}
            <div className="bg-white dark:bg-[#151A21] p-4 rounded-2xl border border-gray-200 dark:border-[#6C757D]/10 shadow-sm space-y-4">
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre de lección, curso o ID..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-[#00D4B3] transition-colors"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-4 py-3 rounded-xl border flex items-center gap-2 transition-colors ${
                            showFilters || filtersActive
                                ? 'bg-[#00D4B3]/10 border-[#00D4B3]/30 text-[#00D4B3]'
                                : 'bg-gray-50 dark:bg-[#0F1419] border-gray-200 dark:border-[#6C757D]/20 text-gray-500'
                        }`}
                    >
                        <Filter size={18} />
                        {filtersActive && (
                            <span className="text-xs font-bold">
                                {[selectedType, selectedStatus, selectedAssetPresence].filter(v => v !== 'ALL').length}
                            </span>
                        )}
                    </button>
                    <button
                        type="submit"
                        disabled={isSearching}
                        className="bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] font-bold px-6 py-3 rounded-xl transition-all shadow-lg shadow-[#00D4B3]/20 flex items-center gap-2"
                    >
                        {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                        Buscar
                    </button>
                </form>

                {/* Filters Panel */}
                {(showFilters || filtersActive) && (
                    <div className="pt-4 border-t border-gray-100 dark:border-[#6C757D]/10 grid grid-cols-1 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 uppercase">Tipo de Componente</label>
                            <select
                                value={selectedType}
                                onChange={(e) => setSelectedType(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-2 text-sm focus:border-[#00D4B3] outline-none"
                            >
                                {COMPONENT_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 uppercase">Asset Presente</label>
                            <select
                                value={selectedAssetPresence}
                                onChange={(e) => setSelectedAssetPresence(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-2 text-sm focus:border-[#00D4B3] outline-none"
                            >
                                {ASSET_PRESENCE.map(a => (
                                    <option key={a.value} value={a.value}>{a.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 uppercase">Estado de Producción</label>
                            <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-2 text-sm focus:border-[#00D4B3] outline-none"
                            >
                                {PRODUCTION_STATUSES.map(s => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={clearFilters}
                                className="text-xs text-red-500 hover:text-red-400 p-2 flex items-center gap-1"
                            >
                                <X size={12} /> Limpiar filtros
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Results Grid */}
            <div className="min-h-[300px]">
                {isSearching ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3, 4, 5, 6].map(i => (
                            <div key={i} className="h-44 bg-gray-100 dark:bg-[#151A21] rounded-xl animate-pulse" />
                        ))}
                    </div>
                ) : results.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in">
                        {results.map((result) => (
                            <MaterialResultCard key={result.id} result={result} />
                        ))}
                    </div>
                ) : hasSearched ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
                        <Search size={48} className="mb-4 text-gray-600" />
                        <h3 className="text-lg font-medium text-white">Sin resultados</h3>
                        <p className="text-sm text-gray-500">Intenta con otros términos o ajusta los filtros</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
