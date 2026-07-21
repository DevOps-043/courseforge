import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BundleAgentConversationService } from "@/domains/production/bundle-agent/conversation.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentSpecSchema, type BundleAgentSpec } from "@/domains/production/bundle-agent/types";
import { inferVisualProfile } from "@/domains/production/bundle-agent/visual-profile.service";

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

function SpecPreviewCanvas({ spec }: { spec: BundleAgentSpec }) {
  const accentColor = getAccentColor(spec);
  const profile = inferVisualProfile(spec);
  const title = getStringProp(spec, "title", spec.title);
  const subtitle = getStringProp(spec, "subtitle", spec.description || spec.visualStyle);
  const hasAvatar = spec.requiredAssets.includes("avatar");
  const hasSlides = spec.requiredAssets.includes("slides");
  const hasBroll = spec.requiredAssets.includes("broll");
  const hasCaptions = spec.requiredAssets.includes("captions");
  const isLight = profile.backgroundPreset === "editorial-light";
  const isCinematic = profile.layoutVariant === "cinematic-overlay";
  const isMediaFirst = profile.layoutVariant === "media-first";
  const isTextLed = profile.layoutVariant === "text-led";
  const background = isLight
    ? "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 52%, #fef3c7 100%)"
    : profile.backgroundPreset === "cinematic-dark"
      ? "radial-gradient(circle at 50% 20%, rgba(255,255,255,0.18), transparent 26%), linear-gradient(145deg, #030712 0%, #111827 42%, #020617 100%)"
      : profile.backgroundPreset === "minimal-contrast"
        ? `linear-gradient(135deg, #111827 0%, #1f2937 50%, ${accentColor} 180%)`
        : "linear-gradient(135deg, #09090f 0%, #151022 48%, #2e1065 100%)";
  const textColor = isLight ? "text-slate-950" : "text-white";
  const mutedTextColor = isLight ? "text-slate-700" : "text-white/80";

  if (isCinematic) {
    return (
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 p-4 shadow-2xl">
        <div className="relative aspect-video overflow-hidden rounded-2xl p-10 text-white" style={{ background }}>
          <div
            className="absolute inset-0"
            style={{
              background: hasBroll || hasSlides
                ? `radial-gradient(circle at 68% 38%, ${accentColor}88, transparent 28%), linear-gradient(120deg, rgba(15,23,42,0.22), rgba(15,23,42,0.88))`
                : `radial-gradient(circle at 70% 42%, ${accentColor}, transparent 26%)`,
            }}
          />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-white/10" />
          <div className="absolute bottom-10 left-10 max-w-2xl">
            <div className="mb-6 h-2 w-36 rounded-full" style={{ backgroundColor: accentColor }} />
            <h1 className="text-6xl font-semibold leading-none tracking-normal">{title}</h1>
            <p className="mt-6 text-2xl leading-snug text-white/85">{subtitle}</p>
            <div className="mt-8 h-2 w-full overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-2/3" style={{ backgroundColor: accentColor }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 p-4 shadow-2xl">
      <div
        className={`relative aspect-video overflow-hidden rounded-2xl p-10 ${textColor}`}
        style={{ background }}
      >
        <div className="absolute left-0 top-0 h-full w-1/3 bg-white/10 blur-2xl" />
        <div
          className="relative grid h-full gap-8"
          style={{
            gridTemplateColumns: isMediaFirst ? "1.22fr 0.78fr" : isTextLed ? "0.84fr 1.16fr" : "1fr 1fr",
          }}
        >
          <section
            className="flex flex-col justify-between rounded-[28px] border p-8"
            style={{
              borderColor: accentColor,
              background: isLight ? "rgba(255,255,255,0.68)" : "linear-gradient(180deg, rgba(91,33,182,0.26), rgba(12,10,18,0.9))",
              boxShadow: isLight ? "0 28px 80px rgba(15,23,42,0.16)" : `inset 0 0 48px ${accentColor}44`,
            }}
          >
            <div className="inline-flex w-fit rounded-full border border-current/20 bg-white/10 px-4 py-2 text-sm font-semibold">
              {isMediaFirst ? "Visual principal" : hasAvatar ? "Avatar en primera persona" : "Area visual principal"}
            </div>
            <div
              className={`mx-auto flex items-center justify-center text-3xl font-black ${isMediaFirst ? "h-64 w-full rounded-3xl" : "h-56 w-56 rounded-full"}`}
              style={{
                background: isMediaFirst
                  ? `linear-gradient(135deg, ${accentColor}44, rgba(15,23,42,0.26))`
                  : `radial-gradient(circle at 50% 32%, rgba(255,255,255,0.28), ${accentColor} 38%, rgba(12,10,18,0.2) 68%)`,
              }}
            >
              {isMediaFirst ? (hasBroll ? "B-roll" : "Slides") : "POV"}
            </div>
            <p className={`text-xl leading-snug ${mutedTextColor}`}>
              Placeholder sin assets: aqui se validan encuadre, jerarquia visual y zona del avatar.
            </p>
          </section>

          <section className={`flex flex-col justify-center rounded-[28px] border p-9 ${isLight ? "border-slate-900/15 bg-white/70" : "border-white/15 bg-white/10"}`}>
            <div className="mb-7 h-2 w-28 rounded-full" style={{ backgroundColor: accentColor }} />
            <h1 className={`${isTextLed ? "text-6xl" : "text-5xl"} font-semibold leading-none tracking-normal`}>{title}</h1>
            <p className={`mt-6 text-2xl leading-snug ${isLight ? "text-slate-700" : "text-white/90"}`}>{subtitle}</p>
            <p className={`mt-6 text-base leading-relaxed ${isLight ? "text-slate-600" : "text-white/65"}`}>Direccion visual: {spec.visualStyle}</p>
            <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
              <div className={isLight ? "rounded-xl bg-slate-900/10 p-3" : "rounded-xl bg-white/10 p-3"}>{hasSlides ? "Slides: soporte visual" : "Slides: no requeridas"}</div>
              <div className={isLight ? "rounded-xl bg-slate-900/10 p-3" : "rounded-xl bg-white/10 p-3"}>{hasBroll ? "B-roll: soporte visual" : "B-roll: no requerido"}</div>
            </div>
            {hasCaptions ? (
              <div className="mt-7 rounded-xl bg-black/35 px-4 py-3 text-center text-lg font-semibold text-white">
                Subtitulos blancos de alta legibilidad
              </div>
            ) : null}
          </section>
        </div>
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
            <p className="text-sm font-semibold uppercase tracking-wide text-[#5B21B6]">Preview sin assets</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-950">{spec.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Vista estructural segura para revisar layout, estilo y props antes de generar build cloud o usar assets reales.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Spec v{specRow.version_number}</p>
            <p>{spec.width}x{spec.height} - {spec.fps} fps - {spec.durationFrames} frames</p>
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
        </section>
      </div>
    </main>
  );
}
