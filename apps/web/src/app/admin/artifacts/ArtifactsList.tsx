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
  profiles?: {
    username: string;
    email: string;
  } | null;
}

const statusConfig: Record<
  string,
  { label: string; color: string; icon?: any }
> = {
  DRAFT: {
    label: "Borrador",
    color: "text-gray-400 bg-gray-500/10 border-gray-500/20",
  },
  GENERATING: {
    label: "Generando...",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20 animate-pulse",
    icon: Loader2,
  },
  VALIDATING: {
    label: "Validando",
    color:
      "text-purple-400 bg-purple-500/10 border-purple-500/20 animate-pulse",
    icon: Loader2,
  },
  READY_FOR_QA: {
    label: "Listo para QA",
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    icon: CheckCircle2,
  },
  ESCALATED: {
    label: "Revisión Manual",
    color: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    icon: AlertCircle,
  },
  PENDING_QA: {
    label: "Pendiente QA",
    color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  },
  IN_PROCESS: {
    label: "En Proceso",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  APPROVED: {
    label: "Aprobado",
    color: "text-green-400 bg-green-500/10 border-green-500/20",
  },
  REJECTED: {
    label: "Rechazado",
    color: "text-red-400 bg-red-500/10 border-red-500/20",
  },
};

export default function ArtifactsList({
  initialArtifacts,
}: {
  initialArtifacts: Artifact[];
}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const supabase = createClient();
  const router = useRouter();

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
            router.refresh();
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
              router.refresh();
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
  }, [supabase, router]);

  // 2. Polling Logic (Refreshed when artifacts list changes, specifically if generating items exist)
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
        if (changed) router.refresh();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [artifacts, supabase, router]);

  // Filter Logic
  const filteredArtifacts = artifacts.filter((art) => {
    const title = art.idea_central || "";
    const matchesSearch = title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || art.state === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const tabs = [
    { id: "all", label: "Todos" },
    { id: "APPROVED", label: "Aprobados" },
    { id: "PENDING_QA", label: "Pendientes QA" },
    { id: "IN_PROCESS", label: "En proceso" },
    { id: "ESCALATED", label: "Escalados" },
  ];

  return (
    <div className="space-y-6">
      {/* Search and Filters Toolbar */}
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
        {/* Search */}
        <div className="relative w-full md:w-96">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6C757D]"
            size={18}
          />
          <input
            type="text"
            placeholder="Buscar artefactos..."
            className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl py-2 pl-10 pr-4 text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Tabs & View Toggle */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end overflow-x-auto">
          <div className="flex items-center gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
                  filterStatus === tab.id
                    ? "bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20"
                    : "text-[#94A3B8] border-transparent hover:text-white hover:bg-[#1E2329]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-[#6C757D]/20 hidden md:block" />

          <div className="flex items-center bg-[#0F1419] rounded-lg p-1 border border-[#6C757D]/20">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-[#1E2329] text-white" : "text-[#6C757D] hover:text-white"}`}
            >
              <ListIcon size={16} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-[#1E2329] text-white" : "text-[#6C757D] hover:text-white"}`}
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
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              : "space-y-4"
          }
        >
          {filteredArtifacts.map((art) => (
            <ArtifactCard key={art.id} artifact={art} viewMode={viewMode} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-[#151A21]/50 border border-dashed border-[#6C757D]/20 rounded-2xl">
      <div className="w-16 h-16 bg-[#1F5AF6]/10 rounded-full flex items-center justify-center text-[#1F5AF6] mb-4">
        <FileText size={32} />
      </div>
      <h3 className="text-white font-medium text-lg mb-1">No hay artefactos</h3>
      <p className="text-[#94A3B8] text-sm mb-6">
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

function ArtifactCard({
  artifact,
  viewMode,
}: {
  artifact: Artifact;
  viewMode: "grid" | "list";
}) {
  const status = statusConfig[artifact.state] || statusConfig.DRAFT;
  const StatusIcon = status.icon;

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
        <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-xl p-4 flex items-center gap-4 hover:border-[#6C757D]/30 transition-all group">
          <div className="w-10 h-10 rounded-lg bg-[#2D333B] flex items-center justify-center text-[#94A3B8]">
            <FileText size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-white font-medium truncate group-hover:text-[#00D4B3] transition-colors">
              {(artifact.idea_central || "Artefacto sin nombre")
                .replace(/^TEMA:\s*/i, "")
                .split(/IDEA PRINCIPAL:/i)[0]
                .trim()}
            </h4>
            <p className="text-xs text-[#94A3B8] truncate">{descText}</p>
          </div>

          <div
            className={`px-2.5 py-1 rounded-full text-xs border ${status.color} flex items-center gap-1.5`}
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

          <div className="text-xs text-[#6C757D] hidden md:block w-32 truncate text-right px-2">
            {artifact.profiles?.username || "Anon"}
          </div>

          <div className="text-xs text-[#6C757D] w-20 text-right">
            {timeDisplay}
          </div>

          <button
            className="text-[#94A3B8] hover:text-white p-2"
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
      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-5 hover:border-[#6C757D]/30 transition-all group flex flex-col h-full cursor-pointer relative">
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
            className="text-[#94A3B8] hover:text-white z-20"
            onClick={(e) => {
              e.preventDefault(); /* Menu logic */
            }}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="flex-1 mb-4">
          <h3 className="text-lg font-bold text-white mb-2 group-hover:text-[#00D4B3] transition-colors line-clamp-2">
            {artifact.idea_central
              .replace(/^TEMA:\s*/i, "")
              .split(/IDEA PRINCIPAL:/i)[0]
              .trim()}
          </h3>
          <p className="text-sm text-[#94A3B8] line-clamp-3">{descText}</p>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[#6C757D]/10">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#00D4B3]/20 flex items-center justify-center text-[10px] text-[#00D4B3]">
              {(artifact.profiles?.username?.[0] || "A").toUpperCase()}
            </div>
            <span className="text-xs text-[#94A3B8]">
              {artifact.profiles?.username || "Usuario"}
            </span>
          </div>
          <span className="text-xs text-[#6C757D]">{timeDisplay}</span>
        </div>
      </div>
    </Link>
  );
}
