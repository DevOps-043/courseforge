"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, MoreHorizontal } from "lucide-react";
import { deleteArtifactAction } from "@/domains/artifacts/actions/artifact.actions";
import type { Artifact, ArtifactViewMode } from "../artifacts-list.types";
import {
  artifactStatusConfig,
  formatArtifactCreatedAt,
  getArtifactDescription,
  getArtifactProgress,
  getArtifactTitle,
} from "../artifacts-list.utils";
import { ArtifactDropdownMenu } from "./ArtifactDropdownMenu";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";

interface ArtifactCardProps {
  artifact: Artifact;
  viewMode: ArtifactViewMode;
  basePath: string;
  onDelete: (id: string) => void;
}

function StatusBadge({ artifact }: { artifact: Artifact }) {
  const displayState = artifact.production_complete
    ? "PRODUCTION_COMPLETE"
    : artifact.state;
  const status = artifactStatusConfig[displayState] || artifactStatusConfig.DRAFT;
  const StatusIcon = status.icon;

  return (
    <div
      className={`px-2.5 py-1 rounded-full text-xs border ${status.color} flex shrink-0 items-center gap-1.5`}
    >
      {StatusIcon && (
        <StatusIcon
          size={12}
          className={
            status.label.includes("Generando") || status.label.includes("Validando")
              ? "animate-spin"
              : ""
          }
        />
      )}
      {status.label}
    </div>
  );
}

export function ArtifactCard({
  artifact,
  viewMode,
  basePath,
  onDelete,
}: ArtifactCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const progress = getArtifactProgress(artifact);
  const timeDisplay = formatArtifactCreatedAt(artifact.created_at);
  const description = getArtifactDescription(artifact.descripcion);
  const artifactTitle = getArtifactTitle(artifact.idea_central);

  const handleMenuClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
    setShowMenu(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);

    try {
      const result = await deleteArtifactAction(artifact.id);

      if (!result.success) {
        console.error("Error deleting artifact:", result.error);
        alert("Error al eliminar el artefacto: " + result.error);
        return;
      }

      setShowDeleteModal(false);
      onDelete(artifact.id);
    } catch (error) {
      console.error("Error deleting artifact:", error);
      alert("Error inesperado al eliminar el artefacto");
    } finally {
      setIsDeleting(false);
    }
  };

  if (viewMode === "list") {
    return (
      <>
        <Link href={`${basePath}/artifacts/${artifact.id}`} className="block">
          <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-4 flex items-center gap-4 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all group shadow-sm dark:shadow-none">
            <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-[#2D333B] flex shrink-0 items-center justify-center text-gray-400 dark:text-[#94A3B8]">
              <FileText size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-gray-900 dark:text-white font-medium truncate group-hover:text-[#00D4B3] transition-colors">
                {artifactTitle}
              </h4>
              <div className="flex items-center gap-3">
                <p className="text-xs text-gray-500 dark:text-[#94A3B8] line-clamp-1 max-w-[200px]">
                  {description}
                </p>
                <div className="h-1.5 w-24 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className={`h-full ${progress.color} transition-all duration-500 ${progress.animated ? "animate-pulse" : ""}`}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            </div>

            <StatusBadge artifact={artifact} />

            <div className="text-xs text-gray-400 dark:text-[#6C757D] hidden md:block w-32 truncate text-right px-2 shrink-0">
              {artifact.profiles?.username || "Anon"}
            </div>

            <div className="text-xs text-gray-400 dark:text-[#6C757D] w-20 text-right shrink-0">
              {timeDisplay}
            </div>

            <button
              className="text-gray-400 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white p-2 shrink-0"
              onClick={handleMenuClick}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        </Link>

        <ArtifactDropdownMenu
          isOpen={showMenu}
          onClose={() => setShowMenu(false)}
          onDelete={() => setShowDeleteModal(true)}
          position={menuPosition}
        />

        <DeleteConfirmationModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          artifactTitle={artifactTitle}
          isDeleting={isDeleting}
        />
      </>
    );
  }

  return (
    <>
      <Link href={`${basePath}/artifacts/${artifact.id}`} className="block h-full">
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-[#6C757D]/30 transition-all group flex flex-col h-full cursor-pointer relative shadow-sm dark:shadow-none">
          <div className="flex items-start justify-between mb-4">
            <StatusBadge artifact={artifact} />
            <button
              className="text-gray-400 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white z-20"
              onClick={handleMenuClick}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>

          <div className="flex-1 mb-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 group-hover:text-[#00D4B3] transition-colors line-clamp-2">
              {artifactTitle}
            </h3>
            <p className="text-sm text-gray-500 dark:text-[#94A3B8] line-clamp-3 mb-4">
              {description}
            </p>

            <div className="w-full">
              <div className="flex justify-between text-[10px] text-gray-400 dark:text-[#6C757D] mb-1.5 uppercase tracking-wider font-semibold">
                <span>Progreso</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-1.5 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                <div
                  className={`h-full ${progress.color} transition-all duration-700 ease-out ${progress.animated ? "animate-[pulse_2s_infinite]" : ""}`}
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-[#6C757D]/10">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-[#00D4B3]/10 dark:bg-[#00D4B3]/20 flex items-center justify-center text-[10px] text-[#00D4B3]">
                {(artifact.profiles?.username?.[0] || "A").toUpperCase()}
              </div>
              <span className="text-xs text-gray-500 dark:text-[#94A3B8]">
                {artifact.profiles?.username || "Usuario"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {artifact.production_status && artifact.production_status.total > 0 && (
                <span
                  className={`text-xs ${artifact.production_complete ? "text-emerald-400" : "text-[#6C757D]"}`}
                >
                  Produccion {artifact.production_status.completed}/
                  {artifact.production_status.total}
                </span>
              )}
              <span className="text-xs text-[#6C757D]">{timeDisplay}</span>
            </div>
          </div>
        </div>
      </Link>

      <ArtifactDropdownMenu
        isOpen={showMenu}
        onClose={() => setShowMenu(false)}
        onDelete={() => setShowDeleteModal(true)}
        position={menuPosition}
      />

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        artifactTitle={artifactTitle}
        isDeleting={isDeleting}
      />
    </>
  );
}
