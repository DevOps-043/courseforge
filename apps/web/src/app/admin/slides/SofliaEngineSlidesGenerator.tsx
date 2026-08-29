"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileJson, FileText, Layers3, Loader2, RefreshCw, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { readApiResponse } from "@/lib/client/api-response";
import { waitForSlideGeneration } from "@/lib/client/slide-generation";
import { EngineSelect } from "@/components/ui/EngineSelect";
import { resolveSlideHtmlPreviewUrl } from "@/lib/client/slide-preview";

export interface SlideGenerationCandidate {
  artifactId: string;
  componentId: string;
  componentType: string;
  courseTitle: string;
  hasPreparedSpec?: boolean;
  label: string;
  lessonTitle: string;
  preparedSlideCount?: number | null;
  qaStatus?: string | null;
}

interface SofliaEngineSlidesGeneratorProps {
  candidates: SlideGenerationCandidate[];
  initialComponentId?: string | null;
  returnTo?: string | null;
}

const CUSTOM_SLIDES_EXAMPLE = JSON.stringify(
  [
    {
      title: "Panorama del modulo",
      subtitle: "Idea central generada desde informacion propia",
      bullets: [
        "Contexto principal",
        "Decision importante",
        "Resultado esperado",
      ],
      type: "cover",
    },
    {
      title: "Comparacion de esfuerzos",
      bullets: ["La grafica se renderiza como SVG responsivo"],
      type: "data_explainer",
      chart: {
        id: "esfuerzo-comparado",
        title: "Esfuerzo por etapa",
        type: "bar",
        unit: "h",
        sourceRefs: ["manual"],
        points: [
          { label: "Investigacion", value: 4 },
          { label: "Guion", value: 6 },
          { label: "Slides", value: 3 },
        ],
      },
    },
  ],
  null,
  2,
);

const SIMPLE_SLIDES_EXAMPLE = `Panorama del modulo
- Contexto principal
- Decision importante
- Resultado esperado

---
Comparacion de esfuerzos
- Investigacion: 4 horas
- Guion: 6 horas
- Slides: 3 horas`;

type SlidesInputMode = "simple" | "json";
type SlidesAppearance = "light" | "dark";

function parseCustomSlides(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("customSlides debe ser un arreglo JSON.");
  }

  return parsed;
}

function parseSimpleSlides(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const sections = trimmed
    .split(/\n\s*---+\s*\n|\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  const slides = sections.map((section, index) => {
    const [rawTitle, ...rawBullets] = section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const title = rawTitle?.replace(/^#+\s*/, "").trim();
    if (!title) {
      throw new Error("Cada slide necesita un titulo.");
    }

    const bullets = rawBullets
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
      .filter(Boolean);

    return {
      bullets,
      title,
      type: index === 0 ? "cover" : "concept",
    };
  });

  return slides.length > 0 ? slides : undefined;
}

export function SofliaEngineSlidesGenerator({
  candidates,
  initialComponentId,
  returnTo,
}: SofliaEngineSlidesGeneratorProps) {
  const initialCandidate = initialComponentId
    ? candidates.find((candidate) => candidate.componentId === initialComponentId)
    : null;
  const [selectedComponentId, setSelectedComponentId] = useState(
    initialCandidate?.componentId || candidates[0]?.componentId || "",
  );
  const [manualComponentId, setManualComponentId] = useState(
    initialComponentId && !initialCandidate ? initialComponentId : "",
  );
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [appearance, setAppearance] = useState<SlidesAppearance>("light");
  const [slidesInputMode, setSlidesInputMode] = useState<SlidesInputMode>("simple");
  const [simpleSlidesText, setSimpleSlidesText] = useState("");
  const [customSlidesJson, setCustomSlidesJson] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [lastGeneratedUrl, setLastGeneratedUrl] = useState<string | null>(null);

  const effectiveComponentId = manualComponentId.trim() || selectedComponentId;
  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.componentId === selectedComponentId),
    [candidates, selectedComponentId],
  );
  const hasManualComponentFallback = Boolean(
    manualComponentId.trim() && !candidates.some((candidate) => candidate.componentId === manualComponentId.trim()),
  );

  const handleGenerate = async () => {
    if (!effectiveComponentId) {
      toast.error("Selecciona o pega un componentId.");
      return;
    }

    setIsGenerating(true);
    setGenerationStatus("QUEUED");
    try {
      const customSlides =
        slidesInputMode === "json"
          ? parseCustomSlides(customSlidesJson)
          : parseSimpleSlides(simpleSlidesText);
      const response = await fetch("/api/production/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appearance,
          componentId: effectiveComponentId,
          customSlides,
          locale: "es",
          metadata: {
            brandLabel: "SofLIA - Engine",
            subtitle: subtitle.trim() || undefined,
            title: title.trim() || undefined,
          },
          template: "course-module",
        }),
      });
      let payload = await readApiResponse(response);

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo generar el deck.");
      }
      if (response.status === 202 && payload.submissionStatus === "QUEUED") {
        toast.info("Deck en cola. La generacion continuara en segundo plano.");
        const completed = await waitForSlideGeneration({
          componentId: effectiveComponentId,
          jobId: payload.jobId,
          onStatus: setGenerationStatus,
        });
        payload = { success: true, assets: completed.assets };
      }

      const previewUrl = resolveSlideHtmlPreviewUrl(payload.assets);
      if (!previewUrl) {
        throw new Error("El deck terminó, pero no devolvió una ruta HTML para visualizarlo.");
      }
      setLastGeneratedUrl(previewUrl);
      toast.success(
        payload.reused
          ? "Deck SofLIA - Engine recuperado"
          : "Deck SofLIA - Engine generado",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el deck.");
    } finally {
      setIsGenerating(false);
      setGenerationStatus(null);
    }
  };

  return (
    <section className="engine-slides-workbench">
      <header className="engine-workbench-header">
        <div className="engine-workbench-heading">
          <span className="engine-workbench-icon"><Layers3 size={19} /></span>
          <div>
            <p className="engine-eyebrow !mb-1 !text-[var(--engine-text-muted)]">Nuevo deck</p>
            <h2>Compositor visual</h2>
            <p>Convierte una lección en una narrativa de diapositivas lista para QA.</p>
          </div>
        </div>
        <div className="engine-step-rail" aria-label="Flujo de creación">
          <span data-active="true"><b>01</b> Fuente</span>
          <span><b>02</b> Narrativa</span>
          <span><b>03</b> Generar</span>
        </div>
      </header>

      {selectedCandidate ? (
        <section
          aria-label="Contexto del taller"
          className="grid gap-3 border-x border-b border-[var(--engine-border)] bg-[var(--engine-surface-soft)] px-5 py-4 sm:grid-cols-2"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)]">
              <Layers3 size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--engine-text-muted)]">Taller</p>
              <p className="mt-1 truncate text-sm font-bold text-[var(--engine-text)]" title={selectedCandidate.courseTitle}>
                {selectedCandidate.courseTitle}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3 sm:border-l sm:border-[var(--engine-border)] sm:pl-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)]">
              <BookOpen size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--engine-text-muted)]">Lección</p>
              <p className="mt-1 truncate text-sm font-bold text-[var(--engine-text)]" title={selectedCandidate.lessonTitle}>
                {selectedCandidate.lessonTitle}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="engine-workbench-body">
        <aside className="engine-workbench-controls">
          <EngineSelect
            label="Fuente de la lección"
            value={selectedComponentId}
            onValueChange={setSelectedComponentId}
            options={candidates.length === 0
              ? [{ value: "", label: "Componente no disponible", disabled: true }]
              : candidates.map((candidate) => ({
                  value: candidate.componentId,
                  label: candidate.lessonTitle,
                  description: candidate.componentType.replace(/_/g, " "),
                }))}
            placeholder="Seleccionar lección"
          />

          <p className="engine-control-help">
            El guion, storyboard, fuentes y contexto se tomarán de esta lección.
          </p>

          {hasManualComponentFallback ? (
            <div className="engine-inline-alert engine-inline-alert--warning">
              La fuente no aparece en el inventario. Se utilizará el identificador manual.
            </div>
          ) : null}

          <label className="engine-field">
            <span>ID manual <em>opcional</em></span>
            <input
              value={manualComponentId}
              onChange={(event) => setManualComponentId(event.target.value)}
              placeholder="Pega un componentId"
            />
          </label>

          <div className="engine-workbench-divider" />

          <label className="engine-field">
            <span>Título editorial <em>opcional</em></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título del deck" />
          </label>
          <label className="engine-field">
            <span>Subtítulo <em>opcional</em></span>
            <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Contexto o promesa" />
          </label>

          <EngineSelect
            label="Apariencia de las diapositivas"
            value={appearance}
            onValueChange={(value) => setAppearance(value as SlidesAppearance)}
            options={[
              { value: "light", label: "Claro", description: "Predeterminado SofLIA" },
              { value: "dark", label: "Oscuro", description: "Superficies oscuras con acentos de marca" },
            ]}
          />

          <div className="engine-source-status">
            <span className={selectedCandidate?.hasPreparedSpec ? "is-ready" : ""} />
            <div>
              <strong>{selectedCandidate?.hasPreparedSpec ? "Spec preparado" : "Fuente conectada"}</strong>
              <small>{selectedCandidate?.preparedSlideCount ? `${selectedCandidate.preparedSlideCount} slides detectados` : selectedCandidate?.qaStatus ? `QA ${selectedCandidate.qaStatus}` : "Lista para componer"}</small>
            </div>
          </div>
        </aside>

        <div className="engine-slide-stage">
          <div className="engine-slide-stage__toolbar">
            <span className="inline-flex items-center gap-2">
              {slidesInputMode === "json" ? <FileJson size={14} /> : <FileText size={14} />}
              Estructura narrativa
            </span>
            <div className="flex items-center gap-2">
              <div className="engine-segmented">
                <button type="button" aria-pressed={slidesInputMode === "simple"} onClick={() => setSlidesInputMode("simple")}>Texto</button>
                <button type="button" aria-pressed={slidesInputMode === "json"} onClick={() => setSlidesInputMode("json")}>JSON</button>
              </div>
              <button
                type="button"
                className="engine-button engine-button--compact"
                onClick={() => slidesInputMode === "json" ? setCustomSlidesJson(CUSTOM_SLIDES_EXAMPLE) : setSimpleSlidesText(SIMPLE_SLIDES_EXAMPLE)}
              >
                <RefreshCw size={13} /> Ejemplo
              </button>
            </div>
          </div>

          <div className="engine-slide-paper">
            <span className="engine-slide-paper__index">SOFLIA / 16:9</span>
            {slidesInputMode === "json" ? (
              <textarea
                value={customSlidesJson}
                onChange={(event) => setCustomSlidesJson(event.target.value)}
                placeholder="Pega un arreglo CustomSlides JSON..."
                spellCheck={false}
                className="font-mono"
              />
            ) : (
              <textarea
                value={simpleSlidesText}
                onChange={(event) => setSimpleSlidesText(event.target.value)}
                placeholder="Título del slide&#10;— Punto clave&#10;— Otro punto&#10;&#10;---&#10;Siguiente slide&#10;— Punto clave"
                spellCheck
              />
            )}
            <div className="engine-slide-paper__footer">
              <span>{selectedCandidate?.lessonTitle || "Sin lección seleccionada"}</span>
              <span>Deck SofLIA</span>
            </div>
          </div>
          {lastGeneratedUrl ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-slate-950 shadow-sm dark:border-white/10">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs font-semibold text-white">
                <span>Vista previa HTML generada</span>
                <a href={lastGeneratedUrl} target="_blank" rel="noreferrer" className="text-[var(--engine-accent)] hover:underline">
                  Abrir en una pestaña
                </a>
              </div>
              <iframe
                key={lastGeneratedUrl}
                src={lastGeneratedUrl}
                title="Vista previa del deck HTML generado"
                className="aspect-video w-full bg-white"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          ) : null}
        </div>
      </div>

      <footer className="engine-workbench-footer">
        <div className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
          {lastGeneratedUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={lastGeneratedUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--engine-accent-strong)] hover:underline"
              >
                Abrir ultimo deck generado
              </a>
              {returnTo && (
                <Link
                  href={returnTo}
                  className="font-semibold text-[var(--engine-primary)] hover:underline dark:text-white"
                >
                  Volver al ensamble
                </Link>
              )}
            </div>
          ) : isGenerating ? <span>{generationStatus === "RUNNING" ? "Generando contenido y visuales…" : "Deck en cola de generación…"}</span> : <span>{effectiveComponentId ? "Fuente validada · listo para generar" : "Selecciona una fuente para continuar"}</span>}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !effectiveComponentId}
          className="engine-button engine-button--primary"
        >
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <WandSparkles size={16} />}
          {isGenerating ? "Generando..." : "Generar deck"}
        </button>
        {returnTo ? (
          <Link href={returnTo} className="engine-button engine-button--ghost">
            <ArrowLeft size={14} /> Volver al ensamble
          </Link>
        ) : null}
      </footer>
    </section>
  );
}
