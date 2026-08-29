import type { MaterialComponent, ProductionStatus } from "../types/materials.types";

export interface LessonProductionProgress {
  completed: number;
  inProgress: number;
  percentage: number;
  total: number;
}

const ACTIVE_PRODUCTION_STATUSES = new Set<ProductionStatus>([
  "IN_PROGRESS",
  "DECK_READY",
  "EXPORTED",
]);

export function getLessonProductionProgress(
  components: MaterialComponent[],
): LessonProductionProgress {
  const total = components.length;
  const completed = components.filter(
    (component) => component.assets?.production_status === "COMPLETED",
  ).length;
  const inProgress = components.filter((component) =>
    ACTIVE_PRODUCTION_STATUSES.has(
      (component.assets?.production_status || "PENDING") as ProductionStatus,
    ),
  ).length;

  return {
    completed,
    inProgress,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
}
