"use client";

import { useState } from "react";
import Link from "next/link";
import { FileStack, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { deleteArtifactAction } from "@/domains/artifacts/actions/artifact.actions";
import type { Artifact, ArtifactViewMode } from "../artifacts-list.types";
import {
  artifactStatusConfig,
  formatArtifactCreatedAt,
  getArtifactDescription,
  getArtifactDisplayState,
  getArtifactProgress,
  getArtifactTitle,
} from "../artifacts-list.utils";
import { ArtifactDropdownMenu } from "./ArtifactDropdownMenu";
import { DeleteConfirmationModal } from "./DeleteConfirmationModal";
import styles from "../artifacts-redesign.module.css";

interface ArtifactCardProps {
  artifact: Artifact;
  viewMode: ArtifactViewMode;
  basePath: string;
  onDelete: (id: string) => void;
  position: number;
}

function StatusBadge({
  artifact,
  normalizeReadyForQa,
}: {
  artifact: Artifact;
  normalizeReadyForQa: boolean;
}) {
  const displayState = getArtifactDisplayState(artifact, normalizeReadyForQa);
  const status = artifactStatusConfig[displayState] || artifactStatusConfig.DRAFT;
  const StatusIcon = status.icon;

  return (
    <div
      className={`${styles.status} ${status.color}`}
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
  position,
}: ArtifactCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const progress = getArtifactProgress(artifact);
  const normalizeReadyForQa = basePath === "/admin" || basePath.endsWith("/admin");
  const timeDisplay = formatArtifactCreatedAt(artifact.created_at);
  const description = getArtifactDescription(artifact.descripcion);
  const artifactTitle = getArtifactTitle(artifact.idea_central);

  const handleMenuClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
    setShowMenu(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);

    try {
      const result = await deleteArtifactAction(artifact.id);

      if (!result.success) {
        console.error("Error deleting artifact:", result.error);
        toast.error(`Error al eliminar el artefacto: ${result.error}`);
        return;
      }

      setShowDeleteModal(false);
      onDelete(artifact.id);
    } catch (error) {
      console.error("Error deleting artifact:", error);
      toast.error("Error inesperado al eliminar el artefacto");
    } finally {
      setIsDeleting(false);
    }
  };

  if (viewMode === "list") {
    return (
      <>
        <div className={styles.cardShell}>
          <Link href={`${basePath}/artifacts/${artifact.id}`} className={styles.listRow}>
            <div className={styles.listIdentity}>
              <div className={styles.listIcon}>
                <FileStack size={18} strokeWidth={1.65} />
              </div>
              <div className={styles.listText}>
                <h3 className={styles.listTitle}>{artifactTitle}</h3>
                <p className={styles.listDescription}>
                  {String(position).padStart(2, "0")} · {description}
                </p>
              </div>
            </div>
            <div className={styles.listProgress}>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
              </div>
              <span>{progress.percent}%</span>
            </div>
            <StatusBadge artifact={artifact} normalizeReadyForQa={normalizeReadyForQa} />
            <span className={styles.listCell}>{timeDisplay}</span>
            <span aria-hidden="true" />
          </Link>
          <button
            type="button"
            aria-label={`Abrir acciones de ${artifactTitle}`}
            className={`engine-icon-button ${styles.menuButton} !top-1/2 -translate-y-1/2`}
            onClick={handleMenuClick}
          >
            <MoreHorizontal size={18} />
          </button>
        </div>

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
      <div className={styles.cardShell}>
        <Link href={`${basePath}/artifacts/${artifact.id}`} className={styles.cardLink}>
          <article className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.index}>ARTEFACTO / {String(position).padStart(2, "0")}</span>
              <span className="w-10" aria-hidden="true" />
            </div>

            <div className={styles.cardBody}>
              <StatusBadge artifact={artifact} normalizeReadyForQa={normalizeReadyForQa} />
              <h3 className={`${styles.cardTitle} mt-4`}>{artifactTitle}</h3>
              <p className={styles.cardDescription}>{description}</p>

              <div className={styles.progressBlock}>
                <div className={styles.progressMeta}>
                  <span>Avance del pipeline</span>
                  <span>{progress.percent}%</span>
                </div>
                <div className={styles.progressTrack}>
                  <div className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            </div>

            <footer className={styles.cardFooter}>
              <span className={styles.owner}>
                <span className={styles.avatar}>
                  {(artifact.profiles?.username?.[0] || "A").toUpperCase()}
                </span>
                <span>{artifact.profiles?.username || "Usuario"}</span>
              </span>
              <span>{timeDisplay}</span>
            </footer>
          </article>
        </Link>
        <button
          type="button"
          aria-label={`Abrir acciones de ${artifactTitle}`}
          className={`engine-icon-button ${styles.menuButton}`}
          onClick={handleMenuClick}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>

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
