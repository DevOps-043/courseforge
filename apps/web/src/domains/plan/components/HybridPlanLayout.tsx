"use client";
import { useState, type ReactNode } from "react";

/** Conserva montados ambos paneles para mantener las ediciones al cambiar de destino. */
export function HybridPlanLayout({ hub, academy }: { hub: ReactNode; academy: ReactNode }) {
  const [planDestination, setPlanDestination] = useState<"hub" | "academy">("hub");
  return <div className="space-y-6">
        <header className="space-y-5 rounded-2xl border border-[var(--engine-border)] bg-[var(--engine-surface-solid)] p-5 sm:p-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--engine-accent)]">Curso híbrido · Paso 3</p>
            <h2 className="text-2xl font-bold text-[var(--engine-text)]">Plan instruccional</h2>
            <p className="text-sm leading-relaxed text-[var(--engine-text-muted)]">Prepara cada modalidad según el recorrido del temario. Genera y revisa sus planes por separado; la aprobación conjunta está en el apartado de sesiones en vivo.</p>
          </div>
          <div role="group" aria-label="Destino del plan" className="grid gap-3 sm:grid-cols-2">
            {([
              ["hub", "Sesiones en vivo", "Hub", "Actividades, tiempos y conducción del instructor."],
              ["academy", "Estudio asíncrono", "Academy", "Lecciones, recursos y evaluaciones de estudio individual."],
            ] as const).map(([destination, title, platform, description]) => <button
              key={destination}
              type="button"
              aria-pressed={planDestination === destination}
              aria-controls={`plan-${destination}`}
              onClick={() => setPlanDestination(destination)}
              className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--engine-accent)] ${planDestination === destination ? "border-[var(--engine-accent)] bg-[var(--engine-canvas)]" : "border-[var(--engine-border)] bg-[var(--engine-surface-solid)] hover:border-[var(--engine-accent)]"}`}
            ><span className="flex flex-wrap items-center justify-between gap-2 font-semibold text-[var(--engine-text)]">{title}<span className="text-xs text-[var(--engine-accent)]">{platform}{planDestination === destination ? " · Seleccionado" : ""}</span></span><span className="mt-2 block text-sm text-[var(--engine-text-muted)]">{description}</span></button>)}
          </div>
        </header>

    <div id="plan-hub" hidden={planDestination !== "hub"}>{hub}</div>
    <div id="plan-academy" hidden={planDestination !== "academy"}>{academy}</div>
  </div>;
}
