'use client';

import { useState } from 'react';
import { Search, Filter, Loader2, Library as LibraryIcon, X } from 'lucide-react';
import { searchMaterialsAction, MaterialSearchResult } from './actions';
import { MaterialResultCard } from './components/MaterialResultCard';
import { toast } from 'sonner';

export default function LibraryPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MaterialSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    // Filters
    const [showFilters, setShowFilters] = useState(false);
    const [selectedType, setSelectedType] = useState('ALL');
    const [selectedStatus, setSelectedStatus] = useState('ALL');

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        if (!query.trim() && selectedType === 'ALL' && selectedStatus === 'ALL') {
            // Avoid empty heavy queries if possible, or show recent
            // For now, allow empty query to "Show All" if users want browse
        }

        setIsSearching(true);
        setHasSearched(true);
        setResults([]); // Clear previous

        try {
            const response = await searchMaterialsAction(query, {
                type: selectedType,
                status: selectedStatus
            });

            if (response.success && response.results) {
                setResults(response.results);
                if (response.results.length === 0) {
                    toast('No se encontraron materiales');
                }
            } else {
                toast.error('Error al buscar materiales');
            }
        } catch (error) {
            console.error(error);
            toast.error('Error inesperado');
        } finally {
            setIsSearching(false);
        }
    };

    const clearFilters = () => {
        setSelectedType('ALL');
        setSelectedStatus('ALL');
        setQuery('');
        setResults([]);
        setHasSearched(false);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <LibraryIcon className="text-[#00D4B3]" />
                        Librería de Materiales
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Busca y gestiona los activos de producción (Decks, Videos, Guías)
                    </p>
                </div>
            </div>

            {/* Search Bar & Filters */}
            <div className="bg-white dark:bg-[#151A21] p-4 rounded-2xl border border-gray-200 dark:border-[#6C757D]/10 shadow-sm space-y-4">
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por ID, Código o Nombre del Taller..."
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
                        className={`px-4 py-3 rounded-xl border flex items-center gap-2 transition-colors ${showFilters || selectedType !== 'ALL' || selectedStatus !== 'ALL'
                            ? 'bg-[#00D4B3]/10 border-[#00D4B3]/30 text-[#00D4B3]'
                            : 'bg-gray-50 dark:bg-[#0F1419] border-gray-200 dark:border-[#6C757D]/20 text-gray-500'
                            }`}
                    >
                        <Filter size={18} />
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
                {(showFilters || selectedType !== 'ALL' || selectedStatus !== 'ALL') && (
                    <div className="pt-4 border-t border-gray-100 dark:border-[#6C757D]/10 grid grid-cols-1 md:grid-cols-3 gap-4 animate-in slide-in-from-top-2">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 uppercase">Tipo de Contenido</label>
                            <select
                                value={selectedType}
                                onChange={(e) => setSelectedType(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-2 text-sm focus:border-[#00D4B3] outline-none"
                            >
                                <option value="ALL">Todos</option>
                                <option value="VIDEO_THEORETICAL">Video Teórico</option>
                                <option value="VIDEO_GUIDE">Video Guía</option>
                                <option value="VIDEO_DEMO">Video Demo</option>
                                <option value="DEMO_GUIDE">Guía Interactiva</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500 uppercase">Estado de Producción</label>
                            <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-2 text-sm focus:border-[#00D4B3] outline-none"
                            >
                                <option value="ALL">Todos</option>
                                <option value="PENDING">Pendiente</option>
                                <option value="IN_PROGRESS">En Progreso</option>
                                <option value="COMPLETED">Completado</option>
                            </select>
                        </div>
                        <div className="flex items-end">
                            <button
                                onClick={clearFilters}
                                className="text-xs text-red-500 hover:text-red-400 p-2"
                            >
                                Limpiar Filtros
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Results Grid */}
            <div className="min-h-[300px]">
                {isSearching ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-40 bg-gray-100 dark:bg-[#151A21] rounded-xl animate-pulse" />
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
                        <h3 className="text-lg font-medium text-white">No se encontraron resultados</h3>
                        <p className="text-sm text-gray-500">Intenta con otros términos o filtros</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
                        <LibraryIcon size={64} className="mb-6 text-gray-600" />
                        <h3 className="text-xl font-medium text-white">Librería Vacía</h3>
                        <p className="text-sm text-gray-500 max-w-sm mx-auto mt-2">
                            Ingresa un término de búsqueda para encontrar assets o utiliza los filtros para explorar el contenido disponible.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
