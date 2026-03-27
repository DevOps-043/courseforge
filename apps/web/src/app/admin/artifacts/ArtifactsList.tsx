"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon, Search } from "lucide-react";
import { ArtifactCard } from "./components/ArtifactCard";
import { ArtifactsEmptyState } from "./components/ArtifactsEmptyState";
import { useArtifactsSync } from "./hooks/useArtifactsSync";
import { artifactStatusTabs } from "./artifacts-list.utils";
import type { Artifact, ArtifactViewMode } from "./artifacts-list.types";

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

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm dark:shadow-none transition-colors">
        <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-center">
          <div className="bg-gray-100 dark:bg-[#0F1419] p-1 rounded-xl flex items-center border border-gray-200 dark:border-[#6C757D]/20">
            <button
              onClick={() => setOwnershipFilter("all")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${ownershipFilter === "all"
                ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white"
                }`}
            >
              Todos
            </button>
            <button
              onClick={() => setOwnershipFilter("mine")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${ownershipFilter === "mine"
                ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm"
                : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white"
                }`}
            >
              Mis Artefactos
            </button>
          </div>

          <div className="relative w-full md:w-80">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D]"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar por titulo..."
              className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl py-2 pl-10 pr-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors placeholder-gray-400 dark:placeholder-gray-600"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end overflow-x-auto">
          <div className="flex items-center gap-2">
            {artifactStatusTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${filterStatus === tab.id
                  ? "bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20"
                  : "text-gray-500 dark:text-[#94A3B8] border-transparent hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1E2329]"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-gray-200 dark:bg-[#6C757D]/20 hidden md:block" />

          <div className="flex items-center bg-gray-100 dark:bg-[#0F1419] rounded-lg p-1 border border-gray-200 dark:border-[#6C757D]/20">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list"
                ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm"
                : "text-gray-400 dark:text-[#6C757D] hover:text-gray-900 dark:hover:text-white"
                }`}
            >
              <ListIcon size={16} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "grid"
                ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm"
                : "text-gray-400 dark:text-[#6C757D] hover:text-gray-900 dark:hover:text-white"
                }`}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      {filteredArtifacts.length === 0 ? (
        <ArtifactsEmptyState basePath={basePath} />
      ) : (
        <>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                : "space-y-4"
            }
          >
            {paginatedArtifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                viewMode={viewMode}
                basePath={basePath}
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
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={18} />
              </button>

              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                Pagina {currentPage} de {totalPages}
              </span>

              <button
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
