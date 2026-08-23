"use client";

import { useState } from "react";
import type { CreationTrendPoint, PipelineBucket } from "../types";

export function CreationTrendChart({ data }: { data: CreationTrendPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((point) => point.count));
  const total = data.reduce((sum, point) => sum + point.count, 0);
  const chartHeight = 120;
  const barWidthPercent = 100 / data.length;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Artefactos creados</h3>
          <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">Últimas 8 semanas</p>
        </div>
        <span className="text-2xl font-bold text-gray-900 dark:text-white">{total}</span>
      </div>

      {total === 0 ? (
        <p className="text-sm text-gray-500 dark:text-[var(--engine-text-muted)] py-10 text-center">
          Sin artefactos nuevos en este periodo.
        </p>
      ) : (
        <div className="relative" style={{ height: chartHeight + 28 }}>
          {hoverIndex !== null && (
            <div
              className="absolute -translate-x-1/2 -translate-y-full px-2.5 py-1.5 rounded-lg bg-[var(--engine-primary)] text-white text-xs font-medium shadow-lg whitespace-nowrap z-10 pointer-events-none"
              style={{
                left: `${hoverIndex * barWidthPercent + barWidthPercent / 2}%`,
                top: chartHeight - (data[hoverIndex].count / max) * (chartHeight - 8) - 8,
              }}
            >
              {data[hoverIndex].count} · semana del {data[hoverIndex].label}
            </div>
          )}

          <div className="flex items-end w-full" style={{ height: chartHeight }}>
            {data.map((point, index) => {
              const barHeight = Math.max(3, (point.count / max) * (chartHeight - 8));
              const isHovered = hoverIndex === index;
              return (
                <div
                  key={point.date}
                  className="flex-1 h-full flex items-end justify-center px-1.5"
                  onMouseEnter={() => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <div
                    className={`w-full rounded-t transition-opacity ${
                      point.count === 0
                        ? "bg-gray-200 dark:bg-white/10"
                        : "bg-[var(--engine-accent)]"
                    } ${isHovered ? "opacity-100" : "opacity-90"}`}
                    style={{ height: barHeight }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex w-full mt-2">
            {data.map((point) => (
              <div
                key={point.date}
                className="flex-1 text-center text-[10px] text-gray-400 dark:text-[var(--engine-muted)]"
              >
                {point.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PipelineDistributionBars({ buckets }: { buckets: PipelineBucket[] }) {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Distribución del pipeline</h3>
      <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)] mb-5">Por etapa actual</p>

      <div className="space-y-3.5">
        {buckets.map((bucket) => {
          const widthPercent = bucket.count === 0 ? 3 : Math.max(4, (bucket.count / max) * 100);
          const isHovered = hoverKey === bucket.key;
          return (
            <div
              key={bucket.key}
              onMouseEnter={() => setHoverKey(bucket.key)}
              onMouseLeave={() => setHoverKey(null)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600 dark:text-[var(--engine-text-muted)]">
                  {bucket.label}
                </span>
                <span className="text-xs font-semibold text-gray-900 dark:text-white">
                  {bucket.count}
                </span>
              </div>
              <div className="h-2 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${widthPercent}%`,
                    backgroundColor: `var(${bucket.colorVar})`,
                    opacity: isHovered ? 1 : 0.85,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
