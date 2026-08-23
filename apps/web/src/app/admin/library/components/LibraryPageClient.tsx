'use client';

import { useEffect, useMemo, useState } from 'react';
import { Filter, Folder, FolderOpen, Library as LibraryIcon, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
    LIBRARY_ASSET_TYPE_OPTIONS,
    LIBRARY_CATEGORY_OPTIONS,
    LIBRARY_COMPONENT_TYPE_OPTIONS,
    LIBRARY_PRODUCTION_STATUS_OPTIONS,
} from '@/domains/library/library-catalog';
import { groupLibraryItemsByWorkshop } from '@/domains/library/library-grouping';
import type { LibraryAssetType, LibraryContentCategory } from '@/domains/library/types';
import type { ComponentType, ProductionStatus } from '@/domains/materials/types/materials.types';
import { searchMaterialsAction, type MaterialSearchResult } from '../actions';
import { LibraryResultCard } from './LibraryResultCard';
import { EngineSelect } from '@/components/ui/EngineSelect';

const PAGE_SIZE = 24;

export function LibraryPageClient() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MaterialSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const [selectedCategory, setSelectedCategory] = useState<LibraryContentCategory>('ALL');
    const [selectedComponentType, setSelectedComponentType] = useState<ComponentType | 'ALL'>('ALL');
    const [selectedStatus, setSelectedStatus] = useState<ProductionStatus | 'ALL'>('ALL');
    const [selectedAssetType, setSelectedAssetType] = useState<LibraryAssetType>('ALL');

    const filtersActive =
        selectedCategory !== 'ALL' ||
        selectedComponentType !== 'ALL' ||
        selectedStatus !== 'ALL' ||
        selectedAssetType !== 'ALL';

    const runSearch = async (nextPage = 1, nextQuery = query) => {
        setIsSearching(true);
        setHasSearched(true);
        setPage(nextPage);

        try {
            const response = await searchMaterialsAction(nextQuery, {
                assetType: selectedAssetType,
                category: selectedCategory,
                componentType: selectedComponentType,
                page: nextPage,
                pageSize: PAGE_SIZE,
                status: selectedStatus,
            });

            if (response.success && 'items' in response) {
                setResults(response.items);
                setTotal(response.total);
                if (response.items.length === 0 && (nextQuery || filtersActive)) {
                    toast('No se encontro informacion con esos criterios');
                }
            } else {
                toast.error(response.error || 'Error al buscar en la libreria');
            }
        } catch {
            toast.error('Error inesperado al buscar en la libreria');
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        runSearch(1, '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSearch = (event?: React.FormEvent) => {
        event?.preventDefault();
        runSearch(1);
    };

    const clearFilters = () => {
        setSelectedCategory('ALL');
        setSelectedComponentType('ALL');
        setSelectedStatus('ALL');
        setSelectedAssetType('ALL');
        setQuery('');
        setTimeout(() => runSearch(1, ''), 0);
    };

    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const groupedResults = useMemo(() => groupLibraryItemsByWorkshop(results), [results]);
    const activeFilterCount = [
        selectedCategory,
        selectedComponentType,
        selectedStatus,
        selectedAssetType,
    ].filter((value) => value !== 'ALL').length;

    return (
        <div className="space-y-6">
            <div className="engine-page-hero flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <p className="engine-eyebrow">Centro de conocimiento</p>
                    <h1 className="flex items-center gap-3 text-3xl">
                        <LibraryIcon aria-hidden="true" />
                        Librería
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm">
                        Encuentra materiales, fuentes y recursos de producción sin perder el contexto del curso.
                    </p>
                </div>
                {hasSearched && !isSearching && (
                    <span className="whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
                        {total} resultado{total !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500 shadow-sm dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Empresa activa</span>
                <span>/</span>
                <span>Talleres</span>
                <span>/</span>
                <span>Lecciones</span>
                <span>/</span>
                <span>Materiales y assets</span>
            </div>

            <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
                <form onSubmit={handleSearch} className="flex flex-col gap-2 md:flex-row">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por taller, leccion, nombre de archivo, ruta o URL..."
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm transition-colors focus:border-[var(--engine-accent)] focus:outline-none dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]"
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
                        className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-3 transition-colors ${
                            showFilters || filtersActive
                                ? 'border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]'
                                : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]'
                        }`}
                    >
                        <Filter size={18} />
                        {activeFilterCount > 0 && <span className="text-xs font-bold">{activeFilterCount}</span>}
                    </button>
                    <button
                        type="submit"
                        disabled={isSearching}
                        className="flex items-center justify-center gap-2 rounded-lg bg-[var(--engine-accent)] px-6 py-3 font-bold text-[var(--engine-primary)] shadow-lg shadow-[var(--engine-accent)]/20 transition-all hover:bg-[var(--engine-accent-hover)]"
                    >
                        {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                        Buscar
                    </button>
                </form>

                {(showFilters || filtersActive) && (
                    <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 md:grid-cols-5 dark:border-[var(--engine-muted)]/10">
                        <SelectFilter
                            label="Categoria"
                            value={selectedCategory}
                            options={LIBRARY_CATEGORY_OPTIONS}
                            onChange={(value) => setSelectedCategory(value as LibraryContentCategory)}
                        />
                        <SelectFilter
                            label="Componente"
                            value={selectedComponentType}
                            options={LIBRARY_COMPONENT_TYPE_OPTIONS}
                            onChange={(value) => setSelectedComponentType(value as ComponentType | 'ALL')}
                        />
                        <SelectFilter
                            label="Tipo de asset"
                            value={selectedAssetType}
                            options={LIBRARY_ASSET_TYPE_OPTIONS}
                            onChange={(value) => setSelectedAssetType(value as LibraryAssetType)}
                        />
                        <SelectFilter
                            label="Estado"
                            value={selectedStatus}
                            options={LIBRARY_PRODUCTION_STATUS_OPTIONS}
                            onChange={(value) => setSelectedStatus(value as ProductionStatus | 'ALL')}
                        />
                        <div className="flex items-end">
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="flex items-center gap-1 p-2 text-xs text-red-500 hover:text-red-400"
                            >
                                <X size={12} /> Limpiar filtros
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="min-h-[300px]">
                {isSearching ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {[1, 2, 3, 4, 5, 6].map((item) => (
                            <div key={item} className="h-44 animate-pulse rounded-lg bg-gray-100 dark:bg-[var(--engine-surface-solid)]" />
                        ))}
                    </div>
                ) : results.length > 0 ? (
                    <>
                        <div className="space-y-5 animate-in fade-in">
                            {groupedResults.map((workshop) => (
                                <section
                                    key={workshop.id}
                                    className="overflow-hidden rounded-lg border border-[var(--engine-muted)]/10 bg-[#10151C]"
                                >
                                    <div className="flex flex-col gap-2 border-b border-[var(--engine-muted)]/10 bg-[var(--engine-surface-solid)] px-4 py-3 md:flex-row md:items-center md:justify-between">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]">
                                                <FolderOpen size={18} />
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--engine-text-muted)]">
                                                    Carpeta de taller
                                                </p>
                                                <h2 className="truncate text-base font-semibold text-white">
                                                    {workshop.workshopName}
                                                </h2>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-gray-500">
                                            <span className="font-mono">{workshop.courseCode}</span>
                                            <span>{workshop.itemCount} item{workshop.itemCount !== 1 ? 's' : ''}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-4 p-4">
                                        {workshop.lessons.map((lesson) => (
                                            <section key={lesson.id} className="space-y-3">
                                                <div className="flex items-center gap-2 text-sm text-gray-300">
                                                    <Folder size={15} className="text-[var(--engine-accent)]" />
                                                    <span className="truncate font-medium">{lesson.lessonTitle}</span>
                                                    <span className="text-xs text-gray-600">
                                                        {lesson.items.length} item{lesson.items.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                                    {lesson.items.map((result) => (
                                                        <LibraryResultCard key={result.id} result={result} />
                                                    ))}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </div>
                        {pageCount > 1 && (
                            <div className="mt-6 flex items-center justify-center gap-3">
                                <button
                                    type="button"
                                    disabled={page <= 1 || isSearching}
                                    onClick={() => runSearch(page - 1)}
                                    className="rounded-lg border border-[var(--engine-muted)]/20 px-4 py-2 text-sm text-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Anterior
                                </button>
                                <span className="text-sm text-gray-500">
                                    Pagina {page} de {pageCount}
                                </span>
                                <button
                                    type="button"
                                    disabled={page >= pageCount || isSearching}
                                    onClick={() => runSearch(page + 1)}
                                    className="rounded-lg border border-[var(--engine-muted)]/20 px-4 py-2 text-sm text-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Siguiente
                                </button>
                            </div>
                        )}
                    </>
                ) : hasSearched ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center opacity-50">
                        <Search size={48} className="mb-4 text-gray-600" />
                        <h3 className="text-lg font-medium text-white">Sin resultados</h3>
                        <p className="text-sm text-gray-500">Intenta con otros terminos o ajusta los filtros</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function SelectFilter({
    label,
    onChange,
    options,
    value,
}: {
    label: string;
    onChange: (value: string) => void;
    options: readonly { label: string; value: string }[];
    value: string;
}) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-medium uppercase text-gray-500">{label}</label>
            <EngineSelect
                value={value}
                onValueChange={onChange}
                options={options.map((option) => ({ value: option.value, label: option.label }))}
            />
        </div>
    );
}
