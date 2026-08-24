import Link from "next/link";
import { AlertTriangle, CheckCircle2, PackageX, XCircle } from "lucide-react";
import type { AttentionItem, AttentionItemType } from "../types";
import { timeAgo } from "../utils";

const ITEM_CONFIG: Record<
  AttentionItemType,
  { icon: typeof AlertTriangle; label: string; color: string }
> = {
  ESCALATED: {
    icon: AlertTriangle,
    label: "Revisión manual",
    color: "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/10",
  },
  PUBLICATION_REJECTED: {
    icon: XCircle,
    label: "Publicación rechazada",
    color: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10",
  },
  SCORM_FAILED: {
    icon: PackageX,
    label: "SCORM fallido",
    color: "text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-500/10",
  },
};

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  return (
    <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-sm dark:shadow-none transition-colors">
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Requiere tu atención</h3>

      {items.length === 0 ? (
        <div className="flex items-center gap-3 py-4 text-sm text-gray-500 dark:text-[var(--engine-text-muted)]">
          <CheckCircle2 size={18} className="text-green-500 shrink-0" />
          Sin pendientes urgentes por ahora.
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => {
            const config = ITEM_CONFIG[item.type];
            const Icon = config.icon;
            return (
              <Link
                key={`${item.type}-${item.id}`}
                href={item.href}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-[var(--engine-surface-hover)] transition-colors group"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${config.color}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 dark:text-white truncate group-hover:text-[var(--engine-accent)] transition-colors">
                    {item.title}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-[var(--engine-muted)]">
                    {config.label} · {timeAgo(item.timestamp)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
