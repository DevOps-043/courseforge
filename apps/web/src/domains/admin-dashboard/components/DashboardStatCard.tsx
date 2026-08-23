import type { LucideIcon } from "lucide-react";

const TONE_CLASSES: Record<"neutral" | "positive" | "attention", string> = {
  neutral: "text-gray-500 dark:text-[var(--engine-text-muted)]",
  positive: "text-green-600 dark:text-green-400",
  attention: "text-amber-600 dark:text-amber-400",
};

export function DashboardStatCard({
  title,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  iconClassName = "text-[var(--engine-accent)]",
}: {
  title: string;
  value: string;
  hint: string;
  tone?: "neutral" | "positive" | "attention";
  icon: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-5 hover:border-gray-300 dark:hover:border-[var(--engine-muted)]/30 transition-all shadow-sm dark:shadow-none">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2 bg-gray-50 dark:bg-[var(--engine-canvas)] rounded-lg border border-gray-100 dark:border-[var(--engine-muted)]/10">
          <Icon className={iconClassName} size={24} />
        </div>
      </div>
      <div>
        <p className="text-sm text-gray-500 dark:text-[var(--engine-text-muted)] mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">{value}</h3>
        <p className={`text-xs mt-1 font-medium ${TONE_CLASSES[tone]}`}>{hint}</p>
      </div>
    </div>
  );
}
