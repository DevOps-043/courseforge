import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  FileCode2,
  LayoutTemplate,
  Plus,
  TriangleAlert,
} from "lucide-react";
import {
  getSlideTemplatePackagesAction,
  type SlideTemplateLibraryItem,
} from "@/domains/production/slides/slide-template-library.actions";

export const dynamic = "force-dynamic";

function statusLabel(status: SlideTemplateLibraryItem["status"]) {
  return {
    FAILED: "Falló",
    PACKAGED: "Lista",
    QUEUED: "En cola",
    RUNNING: "Generando",
    SUBMITTED_FOR_REVIEW: "En revisión",
    VALIDATION_FAILED: "Requiere ajustes",
  }[status];
}

function StatusBadge({ status }: { status: SlideTemplateLibraryItem["status"] }) {
  const visual = status === "PACKAGED"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : status === "FAILED" || status === "VALIDATION_FAILED"
      ? "bg-red-500/10 text-red-700 dark:text-red-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  const Icon = status === "PACKAGED" ? CheckCircle2 : status === "FAILED" || status === "VALIDATION_FAILED" ? TriangleAlert : Clock3;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${visual}`}><Icon size={13} />{statusLabel(status)}</span>;
}

function TemplatePreview({ template }: { template: SlideTemplateLibraryItem }) {
  const design = template.preview_design || {
    accent: "#00D4B3", accent2: "#2D7D6E", background: "#F7FAFC", muted: "#65758B", surface: "#FFFFFF", text: "#0A2540",
  };
  const slides = template.preview_slides.slice(0, 3);
  return (
    <div className="aspect-video overflow-hidden rounded-xl border border-black/10 p-4 shadow-inner dark:border-white/10" style={{ background: design.background, color: design.text }}>
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-center justify-between text-[8px] font-black uppercase tracking-[0.12em]" style={{ color: design.muted }}>
          <span>SofLIA slides</span><span>{template.runtime_canvas?.aspectRatio || "16:9"}</span>
        </div>
        <div>
          <span className="mb-2 block h-1.5 w-12 rounded-full" style={{ background: design.accent }} />
          <p className="line-clamp-2 text-lg font-black leading-tight">{slides[0]?.title || template.title}</p>
          <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed" style={{ color: design.muted }}>{slides[0]?.subtitle || template.description || "Plantilla HTML para diapositivas de cursos."}</p>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(slides.length ? slides : [{ title: "Contenido" }, { title: "Visual" }, { title: "Cierre" }]).map((slide, index) => (
            <div key={`${slide.title}-${index}`} className="h-7 rounded-md p-1" style={{ background: design.surface }}>
              <span className="block h-1 w-4 rounded-full" style={{ background: index % 2 ? design.accent2 : design.accent }} />
              <span className="mt-1 block h-1 w-full rounded-full opacity-30" style={{ background: design.muted }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function SlideTemplatesLibraryPage({
  adminBasePath = "/admin",
}: {
  adminBasePath?: string;
}) {
  const result = await getSlideTemplatePackagesAction();
  const templates = result.slideTemplates || [];

  return (
    <main className="space-y-6">
      <header className="engine-page-hero flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="engine-eyebrow flex items-center gap-2"><LayoutTemplate size={16} /> Producción visual</div>
          <h1 className="mt-3 text-3xl">Plantillas de diapositivas</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6">Administra las plantillas HTML de esta empresa. Cada una conserva su diseño, layouts, tipografías y configuración visual para los decks de SofLIA.</p>
        </div>
        <Link href={`${adminBasePath}/slides/templates`} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--engine-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#10395f]">
          <Plus size={17} /> Crear plantilla
        </Link>
      </header>

      {!result.success ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">No fue posible cargar las plantillas: {result.error || "intenta nuevamente."}</section>
      ) : templates.length === 0 ? (
        <section className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-white/15 dark:bg-[var(--engine-surface-solid)]">
          <FileCode2 className="mx-auto text-[var(--engine-accent-strong)]" size={34} />
          <h2 className="mt-4 text-lg font-bold text-gray-950 dark:text-white">Aún no hay plantillas de diapositivas</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">Crea una plantilla para definir el estilo, layouts, fuentes y tokens que utilizarán los próximos decks.</p>
          <Link href={`${adminBasePath}/slides/templates`} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--engine-accent-strong)] px-4 py-2.5 text-sm font-bold text-white"><Plus size={16} /> Crear la primera</Link>
        </section>
      ) : (
        <section className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {templates.map((template) => {
            const editorHref = `${adminBasePath}/slides/templates?conversationId=${template.conversation_id}`;
            const downloadHref = `/api/admin/remotion/bundle-agent/conversations/${template.conversation_id}/runs/${template.id}/download`;
            return <article key={template.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
              <div className="p-4"><TemplatePreview template={template} /></div>
              <div className="border-t border-gray-100 p-4 dark:border-white/10">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-base font-bold text-gray-950 dark:text-white">{template.title}</h2><p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-gray-500 dark:text-gray-400">{template.description || "Sin descripción."}</p></div><StatusBadge status={template.status} /></div>
                <div className="mt-3 flex flex-wrap gap-1.5">{template.layouts.slice(0, 4).map((layout) => <span key={layout} className="rounded-md bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">{layout}</span>)}{template.example_slide_count > 0 && <span className="rounded-md bg-[var(--engine-accent)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--engine-accent-strong)]">{template.example_slide_count} slides</span>}</div>
                {template.error_sanitized && <p className="mt-3 rounded-md bg-red-50 px-2.5 py-2 text-[11px] text-red-700 dark:bg-red-500/10 dark:text-red-300">{template.error_sanitized}</p>}
                <div className="mt-4 flex gap-2"><Link href={editorHref} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">Abrir <ArrowRight size={14} /></Link>{template.status === "PACKAGED" && <a href={downloadHref} className="inline-flex items-center justify-center rounded-lg border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 px-3 py-2 text-[var(--engine-accent-strong)]" title="Descargar paquete"><Download size={15} /></a>}</div>
              </div>
            </article>;
          })}
        </section>
      )}
    </main>
  );
}
