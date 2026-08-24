import Link from "next/link";
import { FileText, Video } from "lucide-react";
import { artifactStatusConfig } from "@/app/admin/artifacts/artifacts-list.utils";
import type { ProductionStatusTone, RecentArtifactItem } from "../types";
import { timeAgo } from "../utils";

const PRODUCTION_TONE_CLASSES: Record<ProductionStatusTone, string> = {
  active: "text-blue-600 dark:text-blue-400",
  done: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
};

export function RecentArtifactsFeed({
  artifacts,
  basePath,
}: {
  artifacts: RecentArtifactItem[];
  basePath: string;
}) {
  return (
    <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Actividad reciente</h3>
        <Link href={`${basePath}/artifacts`} className="text-sm text-[var(--engine-accent)] hover:underline">
          Ver todo
        </Link>
      </div>

      <div className="space-y-1">
        {artifacts.map((artifact) => {
          const displayState = artifact.productionComplete ? "PRODUCTION_COMPLETE" : artifact.state;
          const status = artifactStatusConfig[displayState] || artifactStatusConfig.DRAFT;

          return (
            <Link
              key={artifact.id}
              href={artifact.href}
              className="flex items-center gap-4 p-3 hover:bg-gray-50 dark:hover:bg-[var(--engine-surface-hover)] rounded-xl transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-[#2D333B] flex shrink-0 items-center justify-center text-gray-400 dark:text-[var(--engine-text-muted)]">
                <FileText size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-[var(--engine-accent)] transition-colors">
                  {artifact.title}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">
                    {artifact.ownerName || "Sin autor"}
                  </p>
                  {artifact.productionStatus && (
                    <p
                      className={`flex items-center gap-1 text-xs font-medium ${PRODUCTION_TONE_CLASSES[artifact.productionStatus.tone]}`}
                    >
                      <Video size={11} className={artifact.productionStatus.tone === "active" ? "animate-pulse" : ""} />
                      {artifact.productionStatus.label}
                    </p>
                  )}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs border shrink-0 ${status.color}`}>
                {status.label}
              </span>
              <div className="text-xs text-gray-400 dark:text-[var(--engine-muted)] w-20 text-right shrink-0 hidden sm:block">
                {timeAgo(artifact.updatedAt)}
              </div>
            </Link>
          );
        })}

        {artifacts.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">No hay artefactos todavía para esta empresa.</p>
        )}
      </div>
    </div>
  );
}
