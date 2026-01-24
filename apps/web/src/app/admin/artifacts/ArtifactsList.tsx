"use client";

import { createClient } from "@/utils/supabase/client";
import { useState, useEffect } from "react";
import {
  Search,
  Plus,
  LayoutGrid,
  List as ListIcon,
  FileText,
  Filter,
  AlertCircle,
  CheckCircle2,
  Clock,
  PlayCircle,
  MoreHorizontal,
  Loader2,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Artifact {
  id: string;
  idea_central: string;
  descripcion: any;
  state: string;
  created_at: string;
  created_by: string;
  syllabus_state?: string;
  plan_state?: string;
  profiles?: {
    username: string;
    email: string;
  } | null;
  production_status?: {
    total: number;
    completed: number;
  };
  production_complete?: boolean;
}

const statusConfig: Record<
  string,
  { label: string; color: string; icon?: any }
> = {
  DRAFT: {
    label: "Borrador",
    color: "text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/20",
  },
  GENERATING: {
    label: "Generando...",
    color: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 animate-pulse",
    icon: Loader2,
  },
  VALIDATING: {
    label: "Validando",
    color:
      "text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 animate-pulse",
    icon: Loader2,
  },
  READY_FOR_QA: {
    label: "Listo para QA",
    color: "text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/20",
    icon: CheckCircle2,
  },
  ESCALATED: {
    label: "Revisión Manual",
    color: "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20",
    icon: AlertCircle,
  },
  PENDING_QA: {
    label: "Pendiente QA",
    color: "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20",
  },
  IN_PROCESS: {
    label: "En Proceso",
    color: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20",
  },
  APPROVED: {
    label: "Aprobado",
    color: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/10 border-green-200 dark:border-green-500/20",
  },
  REJECTED: {
    label: "Rechazado",
    color: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10 border-red-200 dark:border-red-500/20",
  },
  PRODUCTION_COMPLETE: {
    label: "🎬 Producción Completa",
    color: "text-emerald-300 bg-emerald-500/20 border-emerald-400/40",
    icon: CheckCircle2,
  },
};

export default function ArtifactsList({
  initialArtifacts,
  currentUserId,
}: {
  initialArtifacts: Artifact[];
  currentUserId?: string;
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "mine">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const supabase = createClient();
  const useRouterHook = useRouter();

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterStatus, ownershipFilter]);

  // ... (Realtime subscription and polling logic remains same)
  // 1. Realtime Subscription (Independent of artifacts state)
  useEffect(() => {
    const channel = supabase
      .channel("artifacts_list_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "artifacts" },
        (payload) => {
          console.log("Realtime Event received:", payload);
          if (payload.eventType === "INSERT") {
            setArtifacts((prev) => [payload.new as Artifact, ...prev]);
            useRouterHook.refresh();
          } else if (payload.eventType === "UPDATE") {
            setArtifacts((prev) =>
              prev.map((a) =>
                a.id === payload.new.id
                  ? { ...a, ...payload.new, profiles: a.profiles }
                  : a,
              ),
            );
            if (
              payload.new.state === "READY_FOR_QA" ||
              payload.new.state === "ESCALATED"
            ) {
              useRouterHook.refresh();
            }
          } else if (payload.eventType === "DELETE") {
            setArtifacts((prev) => prev.filter((a) => a.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, useRouterHook]);

  // 2. Polling Logic
  useEffect(() => {
    const generatingItems = artifacts.filter(
      (a) => a.state === "GENERATING" || a.state === "VALIDATING",
    );
    if (generatingItems.length === 0) return;

    const interval = setInterval(async () => {
      console.log("Polling for updates on", generatingItems.length, "items");
      const { data } = await supabase
        .from("artifacts")
        .select("*")
        .in(
          "id",
          generatingItems.map((a) => a.id),
        );

      if (data && data.length > 0) {
        let changed = false;
        setArtifacts((prev) =>
          prev.map((a) => {
            const fresh = data.find((New) => New.id === a.id);
            if (fresh && fresh.state !== a.state) {
              changed = true;
              return { ...a, ...fresh };
            }
            return a;
          }),
        );
        if (changed) useRouterHook.refresh();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [artifacts, supabase, useRouterHook]);

  // Filter Logic
  const filteredArtifacts = artifacts.filter((art) => {
    const title = art.idea_central || "";
    const matchesSearch = title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || art.state === filterStatus;
    const matchesOwnership = ownershipFilter === "all" || (ownershipFilter === "mine" && art.created_by === currentUserId);

    return matchesSearch && matchesStatus && matchesOwnership;
  });

  // Pagination Logic
  const totalPages = Math.ceil(filteredArtifacts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedArtifacts = filteredArtifacts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const tabs = [
    { id: "all", label: "Estados: Todos" },
    { id: "APPROVED", label: "Aprobados" },
    { id: "PENDING_QA", label: "Pendientes QA" },
    { id: "IN_PROCESS", label: "En proceso" },
    { id: "ESCALATED", label: "Escalados" },
  ];

  return (
    <div className="space-y-6">
      {/* Search and Filters Toolbar */}
      <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm dark:shadow-none transition-colors">

        {/* Left Side: Search + Ownership Toggle */}
        <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto items-center">
          {/* Ownership Toggle */}
          <div className="bg-gray-100 dark:bg-[#0F1419] p-1 rounded-xl flex items-center border border-gray-200 dark:border-[#6C757D]/20">
            <button
              onClick={() => setOwnershipFilter('all')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${ownershipFilter === 'all'
                  ? 'bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Todos
            </button>
            <button
              onClick={() => setOwnershipFilter('mine')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${ownershipFilter === 'mine'
                  ? 'bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              Mis Artefactos
            </button>
          </div>

          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D]"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar por título..."
              className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl py-2 pl-10 pr-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors placeholder-gray-400 dark:placeholder-gray-600"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tabs & View Toggle */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end overflow-x-auto">
          <div className="flex items-center gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${filterStatus === tab.id
                    ? "bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20"
                    : "text-gray-500 dark:text-[#94A3B8] border-transparent hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#1E2329]"
                  }`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${filterStatus === tab.id
                  ? "bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20"
                  : "text-[#94A3B8] border-transparent hover:text-white hover:bg-[#1E2329]"
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
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm" : "text-gray-400 dark:text-[#6C757D] hover:text-gray-900 dark:hover:text-white"}`}
            >
              <ListIcon size={16} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white shadow-sm" : "text-gray-400 dark:text-[#6C757D] hover:text-gray-900 dark:hover:text-white"}`}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredArtifacts.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                : "space-y-4"
            }
          >
            {paginatedArtifacts.map((art) => (
              <ArtifactCard key={art.id} artifact={art} viewMode={viewMode} />
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-8 pt-4 border-t border-gray-200 dark:border-white/5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={18} />
              </button>

              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                Página {currentPage} de {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#151A21]/50 border border-dashed border-gray-200 dark:border-[#6C757D]/20 rounded-2xl shadow-sm dark:shadow-none transition-colors">
      <div className="w-16 h-16 bg-[#1F5AF6]/10 rounded-full flex items-center justify-center text-[#1F5AF6] mb-4">
        <FileText size={32} />
      </div>
      <h3 className="text-gray-900 dark:text-white font-medium text-lg mb-1">No hay artefactos</h3>
      <p className="text-gray-500 dark:text-[#94A3B8] text-sm mb-6">
        Genera tu primer artefacto para comenzar
      </p>
      <Link
        href="/admin/artifacts/new"
        className="bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
      >
        Generar Artefacto
      </Link>
    </div>
  );
}


function getArtifactProgress(artifact: Artifact) {
  // 1. Rejected State
  if (artifact.state === 'REJECTED') {
    return { percent: 100, color: "bg-red-500", animated: false };
  }

  // 2. Calculating Progress based on Sub-Steps
  // If the Base Artifact is Approved, we check deeper.
  if (artifact.state === 'APPROVED') {
    if (artifact.plan_state === 'STEP_APPROVED') {
      return { percent: 60, color: "bg-indigo-500", animated: false }; // Plan Done (Step 3) -> Ready for Curation
    }
    if (artifact.syllabus_state === 'STEP_APPROVED') {
      return { percent: 40, color: "bg-blue-500", animated: false }; // Syllabus Done (Step 2) -> Ready for Plan
    }
    // Just Base Approved (Step 1)
    return { percent: 20, color: "bg-[#00D4B3]", animated: false };
  }

  // 3. Early States (Pre-Approval)
  switch (artifact.state) {
    case "DRAFT":
      return { percent: 10, color: "bg-gray-400 dark:bg-gray-600", animated: false };
    case "GENERATING":
      return { percent: 35, color: "bg-blue-500", animated: true };
    case "VALIDATING":
      return { percent: 50, color: "bg-purple-500", animated: true };
    case "READY_FOR_QA":
    case "PENDING_QA":
      return { percent: 80, color: "bg-cyan-500", animated: false };
    case "ESCALATED":
      return { percent: 80, color: "bg-orange-500", animated: false };
    case "IN_PROCESS":
      return { percent: 15, color: "bg-blue-500", animated: true };
    default:
      return { percent: 5, color: "bg-gray-300", animated: false };
  }
}

function ArtifactCard({
  artifact,
  viewMode,
}: {
  artifact: Artifact;
  viewMode: "grid" | "list";
}) {
  // Determine display status - prioritize PRODUCTION_COMPLETE if all videos done
  const displayState = artifact.production_complete ? 'PRODUCTION_COMPLETE' : artifact.state;
  const status = statusConfig[displayState] || statusConfig.DRAFT;
  const StatusIcon = status.icon;
  const progress = getArtifactProgress(artifact);

  // TimeAgo logic simple
  const date = new Date(artifact.created_at);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 3600 * 24),
  );
  let timeDisplay = diffDays === 0 ? "Hoy" : `Hace ${diffDays} días`;
  // Improve minutes/hours
  if (diffDays === 0) {
    const diffHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 3600),
    );
    if (diffHours === 0) timeDisplay = "Hace momentos";
    else timeDisplay = `Hace ${diffHours} h`;
  }

  // Extract description safely
  let descText = "Sin descripción";
  if (artifact.descripcion) {
    if (typeof artifact.descripcion === "string")
      descText = artifact.descripcion;
    else if (artifact.descripcion.texto)
      descText = artifact.descripcion.texto;
    else if (artifact.descripcion.resumen)
      descText = artifact.descripcion.resumen;
    else if (Object.keys(artifact.descripcion).length > 0)
      descText = JSON.stringify(artifact.descripcion).substring(0, 100);
  }

  if (viewMode === "list") {
    return (
      <Link href={`/admin/artifacts/${artifact.id}`} className="block">
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-4 flex items-center gap-4 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all group shadow-sm dark:shadow-none">
          <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-[#2D333B] flex shrink-0 items-center justify-center text-gray-400 dark:text-[#94A3B8]">
            <FileText size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-gray-900 dark:text-white font-medium truncate group-hover:text-[#00D4B3] transition-colors">
              {(artifact.idea_central || "Artefacto sin nombre")
                .replace(/^TEMA:\s*/i, "")
                .split(/IDEA PRINCIPAL:/i)[0]
                .trim()}
            </h4>
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-500 dark:text-[#94A3B8] line-clamp-1 max-w-[200px]">{descText}</p>
              {/* Mini Progress for List */}
              <div className="h-1.5 w-24 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden flex-shrink-0">
                <div
                  className={`h-full ${progress.color} transition-all duration-500 ${progress.animated ? 'animate-pulse' : ''}`}
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </div>

          <div
            className={`px-2.5 py-1 rounded-full text-xs border ${status.color} flex shrink-0 items-center gap-1.5`}
          >
            {StatusIcon && (
              <StatusIcon
                size={12}
                className={
                  status.label.includes("Generando") ||
                    status.label.includes("Validando")
                    ? "animate-spin"
                    : ""
                }
              />
            )}
            {status.label}
          </div>

          <div className="text-xs text-gray-400 dark:text-[#6C757D] hidden md:block w-32 truncate text-right px-2 shrink-0">
            {artifact.profiles?.username || "Anon"}
          </div>

          <div className="text-xs text-gray-400 dark:text-[#6C757D] w-20 text-right shrink-0">
            {timeDisplay}
          </div>

          <button
            className="text-gray-400 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white p-2 shrink-0"
            onClick={(e) => {
              e.preventDefault(); /* Menu logic */
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/admin/artifacts/${artifact.id}`} className="block h-full">
      <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all group flex flex-col h-full cursor-pointer relative shadow-sm dark:shadow-none">

        {/* Header: Status Badge & Menu */}
        <div className="flex items-start justify-between mb-4">
          <div
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${status.color} flex items-center gap-1.5`}
          >
            {StatusIcon && (
              <StatusIcon
                size={12}
                className={
                  status.label.includes("Generando") ||
                    status.label.includes("Validando")
                    ? "animate-spin"
                    : ""
                }
              />
            )}
            {status.label}
          </div>
          <button
            className="text-gray-400 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white z-20"
            onClick={(e) => {
              e.preventDefault(); /* Menu logic */
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-[#00D4B3] transition-colors line-clamp-2">
            {artifact.idea_central
              .replace(/^TEMA:\s*/i, "")
              .split(/IDEA PRINCIPAL:/i)[0]
              .trim()}
          </h3>
          <p className="text-sm text-gray-500 dark:text-[#94A3B8] line-clamp-3 mb-4">{descText}</p>

          {/* Progress Bar */}
          <div className="w-full">
            <div className="flex justify-between text-[10px] text-gray-400 dark:text-[#6C757D] mb-1.5 uppercase tracking-wider font-semibold">
              <span>Progreso</span>
              <span>{progress.percent}%</span>
            </div>
            <div className="h-1.5 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full ${progress.color} transition-all duration-700 ease-out ${progress.animated ? 'animate-[pulse_2s_infinite]' : ''}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-[#6C757D]/10">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#00D4B3]/10 dark:bg-[#00D4B3]/20 flex items-center justify-center text-[10px] text-[#00D4B3]">
              {(artifact.profiles?.username?.[0] || "A").toUpperCase()}
            </div>
            <span className="text-xs text-gray-500 dark:text-[#94A3B8]">
              {artifact.profiles?.username || "Usuario"}
            </span>
          </div>
          <span className="text-xs text-gray-400 dark:text-[#6C757D]">{timeDisplay}</span>
          <div className="flex items-center gap-3">
            {artifact.production_status && artifact.production_status.total > 0 && (
              <span className={`text-xs ${artifact.production_complete ? 'text-emerald-400' : 'text-[#6C757D]'}`}>
                🎬 {artifact.production_status.completed}/{artifact.production_status.total}
              </span>
            )}
            <span className="text-xs text-[#6C757D]">{timeDisplay}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}


