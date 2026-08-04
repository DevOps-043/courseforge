"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileJson, FileText, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export interface SlideGenerationCandidate {
  artifactId: string;
  componentId: string;
  componentType: string;
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
      type: index === 0 ? "cover" : "content",
    };
  });

  return slides.length > 0 ? slides : undefined;
}

export function SofliaEngineSlidesGenerator({
  candidates,
  initialComponentId,
  returnTo,
}: SofliaEngineSlidesGeneratorProps) {
  const router = useRouter();
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
  const [slidesInputMode, setSlidesInputMode] = useState<SlidesInputMode>("simple");
  const [simpleSlidesText, setSimpleSlidesText] = useState("");
  const [customSlidesJson, setCustomSlidesJson] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGeneratedUrl, setLastGeneratedUrl] = useState<string | null>(null);

  const effectiveComponentId = manualComponentId.trim() || selectedComponentId;
  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.componentId === selectedComponentId),
    [candidates, selectedComponentId],
  );

  const handleGenerate = async () => {
    if (!effectiveComponentId) {
      toast.error("Selecciona o pega un componentId.");
      return;
    }

    setIsGenerating(true);
    try {
      const customSlides =
        slidesInputMode === "json"
          ? parseCustomSlides(customSlidesJson)
          : parseSimpleSlides(simpleSlidesText);
      const response = await fetch("/api/production/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "No se pudo generar el deck.");
      }

      setLastGeneratedUrl(payload.htmlPublicUrl || payload.assets?.slides_url || null);
      toast.success(
        payload.reused
          ? "Deck SofLIA - Engine recuperado"
          : "Deck SofLIA - Engine generado",
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el deck.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#151A21]">
      <div className="border-b border-gray-100 px-5 py-4 dark:border-white/10">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-950 dark:text-white">
              Generar nuevo deck
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Usa contenido existente del componente o envia slides propias.
            </p>
          </div>
          {selectedCandidate?.qaStatus && (
            <span className="w-fit rounded-full border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-600 dark:border-white/10 dark:text-gray-300">
              Ultimo QA {selectedCandidate.qaStatus}
            </span>
          )}
          {selectedCandidate?.hasPreparedSpec && (
            <span className="w-fit rounded-full border border-[#00D4B3]/30 bg-[#00D4B3]/10 px-2 py-1 text-[11px] font-bold text-[#007F6D] dark:text-[#00D4B3]">
              JSON precargado
              {selectedCandidate.preparedSlideCount
                ? ` (${selectedCandidate.preparedSlideCount} slides)`
                : ""}
            </span>
          )}
          {returnTo && (
            <Link
              href={returnTo}
              className="inline-flex w-fit items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
            >
              <ArrowLeft size={12} />
              Volver al ensamble
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <div className="space-y-4">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              Componente detectado
            </span>
            <select
              value={selectedComponentId}
              onChange={(event) => setSelectedComponentId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
            >
              {candidates.length === 0 ? (
                <option value="">Sin componentes disponibles</option>
              ) : (
                candidates.map((candidate) => (
                  <option key={candidate.componentId} value={candidate.componentId}>
                    {candidate.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
              ComponentId manual
            </span>
            <input
              value={manualComponentId}
              onChange={(event) => setManualComponentId(event.target.value)}
              placeholder="Opcional"
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Titulo
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Opcional"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Subtitulo
              </span>
              <input
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
                placeholder="Opcional"
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
              />
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
              {slidesInputMode === "json" ? <FileJson size={13} /> : <FileText size={13} />}
              {slidesInputMode === "json" ? "CustomSlides JSON" : "Contenido simple"}
            </span>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-white/10 dark:bg-[#0F1419]">
                <button
                  type="button"
                  onClick={() => setSlidesInputMode("simple")}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                    slidesInputMode === "simple"
                      ? "bg-white text-[#0A2540] shadow-sm dark:bg-[#151A21] dark:text-white"
                      : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                  }`}
                >
                  Texto
                </button>
                <button
                  type="button"
                  onClick={() => setSlidesInputMode("json")}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                    slidesInputMode === "json"
                      ? "bg-white text-[#0A2540] shadow-sm dark:bg-[#151A21] dark:text-white"
                      : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
                  }`}
                >
                  JSON
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (slidesInputMode === "json") {
                    setCustomSlidesJson(CUSTOM_SLIDES_EXAMPLE);
                  } else {
                    setSimpleSlidesText(SIMPLE_SLIDES_EXAMPLE);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-bold text-gray-600 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
              >
                <RefreshCw size={12} />
                Ejemplo
              </button>
            </div>
          </div>
          {slidesInputMode === "json" ? (
            <textarea
              value={customSlidesJson}
              onChange={(event) => setCustomSlidesJson(event.target.value)}
              placeholder="Opcional"
              spellCheck={false}
              className="min-h-56 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
            />
          ) : (
            <textarea
              value={simpleSlidesText}
              onChange={(event) => setSimpleSlidesText(event.target.value)}
              placeholder="Titulo del slide&#10;- Punto clave&#10;- Otro punto&#10;&#10;---&#10;Siguiente slide&#10;- Punto clave"
              spellCheck
              className="min-h-56 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-6 text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00D4B3]/20 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
            />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
          {lastGeneratedUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={lastGeneratedUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[#00A98F] hover:underline"
              >
                Abrir ultimo deck generado
              </a>
              {returnTo && (
                <Link
                  href={returnTo}
                  className="font-semibold text-[#0A2540] hover:underline dark:text-white"
                >
                  Volver al ensamble
                </Link>
              )}
            </div>
          ) : (
            <span>
              {effectiveComponentId
                ? `Listo para generar: ${effectiveComponentId}`
                : "Selecciona un componente para generar."}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !effectiveComponentId}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0A2540] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#10395f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          {isGenerating ? "Generando..." : "Generar deck"}
        </button>
      </div>
    </section>
  );
}
