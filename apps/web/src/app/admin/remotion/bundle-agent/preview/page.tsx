import type React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buildBundleBlueprint, type LayerBox } from "@/domains/production/bundle-agent/blueprint.service";
import type { BundleTemplateFamily } from "@/domains/production/bundle-agent/types";
import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentSpecSchema, type BundleAgentSpec } from "@/domains/production/bundle-agent/types";

export const dynamic = "force-dynamic";

interface PreviewPageProps {
  searchParams: Promise<{
    conversationId?: string;
    specId?: string;
  }>;
}

interface BundleAgentSpecRow {
  id: string;
  version_number: number;
  spec_json: unknown;
}

function getStringProp(spec: BundleAgentSpec, key: string, fallback: string) {
  const value = spec.defaultProps[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getAccentColor(spec: BundleAgentSpec) {
  const color = getStringProp(spec, "accentColor", "#5B21B6");
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#5B21B6";
}

function getBoxStyle(box: LayerBox, spec: BundleAgentSpec, zIndex: number): React.CSSProperties {
  return {
    position: "absolute",
    left: `${(box.x / spec.width) * 100}%`,
    top: `${(box.y / spec.height) * 100}%`,
    width: `${(box.width / spec.width) * 100}%`,
    height: `${(box.height / spec.height) * 100}%`,
    zIndex,
  };
}

function getPreviewTheme(spec: BundleAgentSpec, accentColor: string, family: BundleTemplateFamily) {
  const tokens = spec.creativeBrief.colorTokens;
  const isReferenceWireframe = family === "reference-frame";

  if (isReferenceWireframe && tokens) {
    return {
      background: tokens.background,
      panel: tokens.surface,
      border: tokens.accent,
      title: "text-slate-950",
      subtitle: "text-slate-700",
    };
  }

  if (family === "editorial-rail") {
    return {
      background: `linear-gradient(135deg, ${tokens.background} 0%, ${tokens.surface} 58%, ${tokens.secondary}44 100%)`,
      panel: tokens.surface,
      border: "rgba(15,23,42,0.14)",
      title: "text-slate-950",
      subtitle: "text-slate-700",
    };
  }

  if (family === "cinematic-field") {
    return {
      background: `radial-gradient(circle at 72% 34%, ${tokens.secondary}66, transparent 30%), linear-gradient(145deg, ${tokens.background} 0%, ${tokens.surface} 60%, ${tokens.background} 100%)`,
      panel: `${tokens.surface}CC`,
      border: "rgba(255,255,255,0.16)",
      title: "text-white",
      subtitle: "text-white/82",
    };
  }

  if (family === "floating-collage") {
    return {
      background: `linear-gradient(${accentColor}18 1px, transparent 1px), linear-gradient(90deg, ${accentColor}18 1px, transparent 1px), #09090f`,
      panel: `${tokens.surface}E6`,
      border: `${accentColor}70`,
      title: "text-white",
      subtitle: "text-white/82",
    };
  }

  if (family === "minimal-focus") {
    return {
      background: `radial-gradient(circle at 50% 42%, ${tokens.surface} 0%, ${tokens.background} 74%)`,
      panel: `${tokens.surface}E6`,
      border: `${accentColor}55`,
      title: "text-white",
      subtitle: "text-white/82",
    };
  }

  if (family === "split-contrast") {
    return {
      background: `linear-gradient(90deg, ${tokens.surface} 0%, ${tokens.surface} 48%, ${tokens.secondary}88 48%, ${tokens.background} 100%)`,
      panel: `${tokens.surface}E6`,
      border: `${accentColor}75`,
      title: "text-white",
      subtitle: "text-white/82",
    };
  }

  return {
    background: `linear-gradient(135deg, ${tokens.background} 0%, ${tokens.surface} 48%, ${tokens.secondary}88 140%)`,
    panel: `${tokens.surface}D9`,
    border: "rgba(255,255,255,0.15)",
    title: "text-white",
    subtitle: "text-white/82",
  };
}

function resolvePreviewSceneBox(layout: string | undefined, fallback: LayerBox, spec: BundleAgentSpec): LayerBox {
  if (layout === "fullscreen") return { x: 0, y: 0, width: spec.width, height: spec.height };
  if (layout === "left-half") return { x: 0, y: 0, width: Math.round(spec.width / 2), height: spec.height };
  if (layout === "right-half") return { x: Math.round(spec.width / 2), y: 0, width: Math.round(spec.width / 2), height: spec.height };
  if (layout === "picture-in-picture") {
    const width = Math.round(spec.width * 0.36);
    const height = Math.round(width * 9 / 16);
    const margin = Math.round(Math.min(spec.width, spec.height) * 0.04);
    return { x: spec.width - width - margin, y: spec.height - height - margin, width, height };
  }
  return fallback;
}

function getTextBlockStyle(layout: string, family: BundleTemplateFamily): React.CSSProperties {
  if (family === "minimal-focus") return { left: "8%", bottom: "10%", width: "44%" };
  if (layout === "media-only" || layout === "cinematic-field" || layout === "support-left-avatar-right") {
    return { left: "6%", bottom: "9%", width: "42%" };
  }

  if (layout === "stacked-support") {
    return { left: "5%", bottom: "8%", width: "28%" };
  }

  return { right: "6%", top: "13%", width: "35%" };
}

function SpecPreviewCanvas({ spec }: { spec: BundleAgentSpec }) {
  const accentColor = getAccentColor(spec);
  const blueprint = buildBundleBlueprint(spec);
  const title = getStringProp(spec, "title", spec.title);
  const subtitle = getStringProp(spec, "subtitle", spec.description || spec.visualStyle);
  const hasAvatar = spec.requiredAssets.includes("avatar");
  const hasSlides = spec.requiredAssets.includes("slides");
  const hasBroll = spec.requiredAssets.includes("broll");
  const hasCaptions = spec.requiredAssets.includes("captions");
  const theme = getPreviewTheme(spec, accentColor, blueprint.designPlan.templateFamily);
  const isReferenceFrameLayout = blueprint.layout === "reference-frame-avatar-left-stack-right";
  const isStaged = blueprint.timelinePlan.mode === "staged";
  const overlay = blueprint.timelinePlan.overlays[0];
  const showAvatar = hasAvatar && (!isStaged || blueprint.timelinePlan.main.asset === "avatar");
  const showSlides = hasSlides && (!isStaged || blueprint.timelinePlan.main.asset === "slides");
  const showBroll = hasBroll && (!isStaged || blueprint.timelinePlan.main.asset === "broll" || Boolean(overlay));
  const avatarPreviewBox = isStaged
    ? resolvePreviewSceneBox(blueprint.timelinePlan.main.layout, blueprint.boxes.avatar, spec)
    : blueprint.boxes.avatar;
  const slidesPreviewBox = isStaged
    ? resolvePreviewSceneBox(blueprint.timelinePlan.main.layout, blueprint.boxes.slides, spec)
    : blueprint.boxes.slides;
  const brollPreviewBox = overlay
    ? resolvePreviewSceneBox(overlay.layout, blueprint.boxes.broll, spec)
    : isStaged
      ? resolvePreviewSceneBox(blueprint.timelinePlan.main.layout, blueprint.boxes.broll, spec)
      : blueprint.boxes.broll;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-4 shadow-2xl">
      <div className="relative aspect-video overflow-hidden rounded-xl" style={{ background: theme.background }}>
        <div className="absolute left-4 top-4 z-[100] rounded-full bg-black/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          {isStaged ? "Fase principal" : "Composición continua"}
        </div>
        <div style={getBoxStyle(blueprint.boxes.primaryVisual, spec, 1)} className={`overflow-hidden ${isReferenceFrameLayout ? "" : "rounded-xl border"}`}>
          <div className="h-full w-full" style={{ borderColor: theme.border, background: isReferenceFrameLayout ? "transparent" : theme.panel }} />
        </div>

        {showAvatar ? (
          <div style={getBoxStyle(avatarPreviewBox, spec, 2)} className="overflow-hidden border">
            <div
              className="h-full w-full"
              style={{
                borderColor: theme.border,
                background: isReferenceFrameLayout
                  ? theme.panel
                  : `radial-gradient(circle at 50% 28%, rgba(255,255,255,0.26), ${accentColor}88 30%, rgba(15,23,42,0.16) 68%)`,
              }}
            />
          </div>
        ) : null}

        {showSlides ? (
          <div style={getBoxStyle(slidesPreviewBox, spec, 3)} className={`overflow-hidden border ${isReferenceFrameLayout ? "" : "rounded-xl shadow-2xl"}`}>
            <div
              className="h-full w-full"
              style={{
                borderColor: theme.border,
                background: isReferenceFrameLayout
                  ? theme.panel
                  : `linear-gradient(135deg, rgba(255,255,255,0.86), rgba(226,232,240,0.68)), linear-gradient(90deg, ${accentColor}44, transparent)`,
              }}
            >
              {!isReferenceFrameLayout ? (
                <>
                  <div className="m-[6%] h-[10%] w-[52%] rounded-full" style={{ backgroundColor: accentColor }} />
                  <div className="mx-[6%] mt-[7%] h-[7%] w-[78%] rounded-full" style={{ backgroundColor: "rgba(15,23,42,0.18)" }} />
                  <div className="mx-[6%] mt-[4%] h-[7%] w-[62%] rounded-full" style={{ backgroundColor: "rgba(15,23,42,0.14)" }} />
                  <div className="mx-[6%] mt-[9%] h-[28%] w-[42%] rounded-xl" style={{ backgroundColor: "rgba(15,23,42,0.1)" }} />
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {showBroll ? (
          <div style={getBoxStyle(brollPreviewBox, spec, 4)} className={`overflow-hidden border ${isReferenceFrameLayout ? "" : "rounded-xl shadow-2xl"}`}>
            <div
              className="h-full w-full"
              style={{
                borderColor: theme.border,
                background: isReferenceFrameLayout
                  ? theme.panel
                  : `radial-gradient(circle at 68% 36%, ${accentColor}99, transparent 28%), linear-gradient(135deg, rgba(15,23,42,0.18), rgba(15,23,42,0.84))`,
              }}
            />
          </div>
        ) : null}

        {!isReferenceFrameLayout && blueprint.renderText ? (
          <section className={`absolute z-10 ${theme.title}`} style={getTextBlockStyle(blueprint.layout, blueprint.designPlan.templateFamily)}>
            <div className="mb-5 h-2 w-24 rounded-full" style={{ backgroundColor: accentColor }} />
            <h1 className="text-5xl font-semibold leading-none tracking-normal">{title}</h1>
            <p className={`mt-5 text-2xl leading-snug ${theme.subtitle}`}>{subtitle}</p>
            {hasCaptions ? <div className="mt-7 h-12 rounded-xl bg-black/30" /> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-500">Preview no disponible</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">No pudimos abrir esta plantilla</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        <Link href=".." className="mt-5 inline-flex rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
          Volver al agente
        </Link>
      </div>
    </main>
  );
}

export default async function BundleAgentPreviewPage({ searchParams }: PreviewPageProps) {
  const params = await searchParams;
  if (!params.conversationId) {
    return <ErrorState message="Falta conversationId en el enlace de preview." />;
  }

  const authContext = await resolveBundleAgentAuthContext();
  const service = new BundleAgentConversationService(authContext);
  const data = await service.getConversation(params.conversationId);
  const specs = data.specs as BundleAgentSpecRow[];
  const specRow = params.specId
    ? specs.find((spec) => spec.id === params.specId)
    : specs[0];

  if (!specRow) {
    return <ErrorState message="La spec solicitada no existe o no pertenece a esta organizacion." />;
  }

  const spec = bundleAgentSpecSchema.parse(specRow.spec_json);
  const blueprint = buildBundleBlueprint(spec);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link
              href=".."
              className="mb-4 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:border-[#5B21B6]/40 hover:text-[#4C1D95]"
            >
              <ArrowLeft size={16} />
              Regresar al agente
            </Link>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#5B21B6]">Vista estructural</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">{spec.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Vista estructural de la fase principal. Los tiempos y transiciones se validan en el plan temporal antes de generar el ZIP.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Spec v{specRow.version_number}</p>
            <p>{spec.width}x{spec.height} - {spec.fps} fps - {blueprint.fallbackDurationFrames} frames de preview</p>
          </div>
        </header>

        <SpecPreviewCanvas spec={spec} />

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assets requeridos</p>
            <p className="mt-2 text-sm text-slate-700">{spec.requiredAssets.join(", ") || "Ninguno"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descripcion</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{spec.description || spec.visualStyle}</p>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm lg:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Plan visual compilado</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {blueprint.designPlan.templateFamily} · {blueprint.designPlan.layoutStrategy} · {blueprint.designPlan.transition}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Fondo {blueprint.designPlan.backgroundTreatment}, superficies {blueprint.designPlan.surfaceTreatment} y ritmo {blueprint.designPlan.pace}.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm lg:col-span-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">Plan temporal compilado</p>
            <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
              <div className="rounded-xl bg-white/70 p-3">
                <p className="font-semibold text-slate-900">Apertura</p>
                <p className="mt-1">{blueprint.timelinePlan.opening ? `${blueprint.timelinePlan.opening.asset} · ${blueprint.timelinePlan.opening.durationFrames} frames · ${blueprint.timelinePlan.opening.layout}` : "Sin fase separada"}</p>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <p className="font-semibold text-slate-900">Contenido</p>
                <p className="mt-1">{blueprint.timelinePlan.main.asset} · {blueprint.timelinePlan.main.layout} · {blueprint.timelinePlan.transition}</p>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <p className="font-semibold text-slate-900">Cierre y overlays</p>
                <p className="mt-1">{blueprint.timelinePlan.ending ? `${blueprint.timelinePlan.ending.asset} · ${blueprint.timelinePlan.ending.durationFrames} frames` : "Sin cierre separado"} · {blueprint.timelinePlan.overlays.length} overlay(s)</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
