"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { ArtifactCard } from "./components/ArtifactCard";
import { ArtifactsEmptyState } from "./components/ArtifactsEmptyState";
import { useArtifactsSync } from "./hooks/useArtifactsSync";
import { artifactStatusTabs } from "./artifacts-list.utils";
import type { Artifact, ArtifactViewMode } from "./artifacts-list.types";
import styles from "./artifacts-redesign.module.css";

const ITEMS_PER_PAGE = 10;

interface ArtifactsListProps {
  initialArtifacts: Artifact[];
  currentUserId?: string;
  basePath?: string;
}

export default function ArtifactsList({
  initialArtifacts,
  currentUserId,
  basePath = "/admin",
}: ArtifactsListProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [viewMode, setViewMode] = useState<ArtifactViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "mine">("all");
  const [currentPage, setCurrentPage] = useState(1);

  useArtifactsSync(artifacts, setArtifacts);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus, ownershipFilter]);

  const filteredArtifacts = artifacts.filter((artifact) => {
    const title = artifact.idea_central || "";
    const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === "all" || artifact.state === filterStatus;
    const matchesOwnership =
      ownershipFilter === "all" ||
      (ownershipFilter === "mine" && artifact.created_by === currentUserId);

    return matchesSearch && matchesStatus && matchesOwnership;
  });

  const totalPages = Math.ceil(filteredArtifacts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedArtifacts = filteredArtifacts.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE,
  );
  const approvedCount = artifacts.filter((artifact) => artifact.state === "APPROVED").length;
  const activeCount = artifacts.length - approvedCount;
  const mineCount = artifacts.filter((artifact) => artifact.created_by === currentUserId).length;
  const statusOptions = artifactStatusTabs.map((tab) => ({
    value: tab.id,
    label: tab.label,
    description: tab.id === "all" ? "Todos los estados" : "Filtrar la colección",
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={styles.summaryPills} aria-label="Resumen de artefactos">
          <span className={styles.summaryPill}><strong>{activeCount}</strong> en producción</span>
          <span className={styles.summaryPill}><strong>{approvedCount}</strong> aprobados</span>
          <span className={styles.summaryPill}><strong>{mineCount}</strong> propios</span>
        </div>
      </div>

      <div className={`engine-command-bar ${styles.commandBar}`}>
        <div className={styles.search}>
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <input
            aria-label="Buscar artefactos por título"
            type="search"
            placeholder="Buscar por título, curso o responsable..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="engine-segmented" aria-label="Propiedad de artefactos">
            <button
              type="button"
              onClick={() => setOwnershipFilter("all")}
              aria-pressed={ownershipFilter === "all"}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setOwnershipFilter("mine")}
              aria-pressed={ownershipFilter === "mine"}
            >
              Míos
            </button>
        </div>

        <EngineSelect
          className={styles.statusSelect}
          value={filterStatus}
          onValueChange={setFilterStatus}
          options={statusOptions}
          placeholder="Estado"
        />

          <div className={styles.viewSwitch}>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-label="Vista de lista"
              aria-pressed={viewMode === "list"}
              title="Vista en lista"
            >
              <ListIcon size={16} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label="Vista de cuadrícula"
              aria-pressed={viewMode === "grid"}
              title="Vista en cuadrícula"
            >
              <LayoutGrid size={16} />
            </button>
          </div>
      </div>

      {filteredArtifacts.length === 0 ? (
        <ArtifactsEmptyState basePath={basePath} />
      ) : (
        <>
          {viewMode === "list" ? (
            <div className={styles.listHeader} aria-hidden="true">
              <span>Artefacto</span>
              <span>Progreso</span>
              <span>Estado</span>
              <span>Actualizado</span>
              <span />
            </div>
          ) : null}
          <div
            className={viewMode === "grid" ? styles.grid : styles.list}
          >
            {paginatedArtifacts.map((artifact, index) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                viewMode={viewMode}
                basePath={basePath}
                position={startIndex + index + 1}
                onDelete={(id) =>
                  setArtifacts((prev) =>
                    prev.filter((candidate) => candidate.id !== id),
                  )
                }
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-8 pt-4 border-t border-gray-200 dark:border-white/5">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                aria-label="Página anterior"
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={18} />
              </button>

              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                Página {currentPage} de {totalPages}
              </span>

              <button
                type="button"
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={currentPage === totalPages}
                aria-label="Página siguiente"
                className="p-2 rounded-lg bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
