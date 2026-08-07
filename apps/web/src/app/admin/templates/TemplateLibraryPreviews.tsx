"use client";

import type { RemotionTemplate, SlideTemplateLibraryItem } from "@/domains/production/actions/templates.actions";

type LayerKind = "avatar" | "slides" | "broll" | "caption" | "background" | "decorative" | "custom";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

const layerPalette: Record<LayerKind, string> = {
  avatar: "bg-[#23AEA8]/90",
  background: "bg-slate-800",
  broll: "bg-[#F59E0B]/85",
  caption: "bg-white/85",
  custom: "bg-[#7C3AED]/85",
  decorative: "bg-[#1F5AF6]/70",
  slides: "bg-white",
};

const layoutNames: Record<string, string> = {
  avatar_focus: "Avatar",
  full_slides: "Slides",
  split_avatar: "Split",
  split_media_text: "Media + texto",
  split_text_media: "Texto + media",
  three_column_framework: "3 columnas",
  data_explainer: "Datos",
  provocation: "Portada",
  closing: "Cierre",
};

function getTemplateAccent(template: RemotionTemplate) {
  const accent = template.default_config?.accentColor;
  return typeof accent === "string" && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#23AEA8";
}

function getTemplateBackground(template: RemotionTemplate) {
  const background = template.default_config?.backgroundColor;
  return typeof background === "string" && /^#[0-9a-fA-F]{6}$/.test(background) ? background : "#08111F";
}

function getInternalTemplateBlocks(template: RemotionTemplate) {
  switch (template.render_composition_id) {
    case "split-avatar":
      return [
        { kind: "slides" as const, label: "Slides", x: 80, y: 90, width: 1120, height: 760 },
        { kind: "avatar" as const, label: "Avatar", x: 1260, y: 120, width: 520, height: 680 },
        { kind: "caption" as const, label: "Caption", x: 180, y: 900, width: 1180, height: 70 },
      ];
    case "avatar-focus":
      return [
        { kind: "avatar" as const, label: "Avatar", x: 610, y: 110, width: 700, height: 700 },
        { kind: "slides" as const, label: "Slides", x: 80, y: 120, width: 430, height: 300 },
        { kind: "broll" as const, label: "B-roll", x: 1410, y: 120, width: 430, height: 300 },
        { kind: "caption" as const, label: "Caption", x: 430, y: 870, width: 1060, height: 80 },
      ];
    default:
      return [
        { kind: "slides" as const, label: "Slides", x: 110, y: 90, width: 1700, height: 760 },
        { kind: "avatar" as const, label: "Avatar", x: 1450, y: 650, width: 300, height: 300 },
        { kind: "caption" as const, label: "Caption", x: 230, y: 900, width: 1120, height: 70 },
      ];
  }
}

function getLayerStyle(block: { x: number; y: number; width: number; height: number }) {
  return {
    height: `${(block.height / CANVAS_HEIGHT) * 100}%`,
    left: `${(block.x / CANVAS_WIDTH) * 100}%`,
    top: `${(block.y / CANVAS_HEIGHT) * 100}%`,
    width: `${(block.width / CANVAS_WIDTH) * 100}%`,
  };
}

export function VideoTemplatePreview({ template }: { template: RemotionTemplate }) {
  const accent = getTemplateAccent(template);
  const editableBlocks = (template.editable_layers || [])
    .filter((layer) => layer.defaultBox)
    .slice()
    .sort((left, right) => (left.defaultStackOrder || 0) - (right.defaultStackOrder || 0))
    .slice(0, 6)
    .map((layer) => ({
      kind: layer.kind as LayerKind,
      label: layer.label,
      ...layer.defaultBox!,
    }));
  const blocks = editableBlocks.length > 0 ? editableBlocks : getInternalTemplateBlocks(template);

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-lg border border-white/10 shadow-inner"
      style={{ background: getTemplateBackground(template) }}
    >
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: `linear-gradient(135deg, ${accent}22, transparent 52%)` }} />
      <div className="absolute left-[6%] top-[7%] h-[2px] w-[28%]" style={{ background: accent }} />
      {blocks.map((block, index) => (
        <div
          key={`${block.label}-${index}`}
          className={`absolute overflow-hidden rounded-md border border-white/20 ${layerPalette[block.kind] || layerPalette.custom}`}
          style={getLayerStyle(block)}
          title={block.label}
        >
          <span className={`absolute left-2 top-1 text-[9px] font-semibold ${block.kind === "slides" || block.kind === "caption" ? "text-slate-800" : "text-white"}`}>
            {block.label}
          </span>
          {block.kind === "slides" && (
            <div className="absolute inset-x-3 bottom-3 space-y-1.5">
              <div className="h-2 w-2/3 rounded bg-slate-300" />
              <div className="h-2 w-1/2 rounded bg-slate-200" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SlideLayoutSketch({ layout, index }: { layout: string; index: number }) {
  const isSplit = layout.includes("split");
  const isData = layout === "data_explainer";
  const isColumns = layout === "three_column_framework";
  const isClosing = layout === "closing";

  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-slate-200 bg-[#F3F7F8] shadow-sm dark:border-white/10">
      <div className="absolute left-3 top-2 text-[8px] font-bold uppercase tracking-wide text-[#0A2540]/50">
        {index + 1}
      </div>
      {isSplit ? (
        <>
          <div className="absolute left-[8%] top-[24%] h-[10%] w-[35%] rounded-sm bg-[#0A2540]" />
          <div className="absolute left-[8%] top-[40%] h-[8%] w-[28%] rounded-sm bg-[#23AEA8]" />
          <div className="absolute right-[8%] top-[18%] h-[62%] w-[38%] rounded-md bg-white shadow-sm" />
        </>
      ) : isData ? (
        <>
          <div className="absolute left-[8%] top-[18%] h-[10%] w-[45%] rounded-sm bg-[#0A2540]" />
          <div className="absolute bottom-[18%] left-[10%] flex h-[42%] w-[78%] items-end gap-2">
            {[42, 70, 55, 86].map((height, barIndex) => (
              <div key={barIndex} className="flex-1 rounded-t bg-[#23AEA8]" style={{ height: `${height}%` }} />
            ))}
          </div>
        </>
      ) : isColumns ? (
        <div className="absolute inset-x-[8%] top-[24%] grid h-[56%] grid-cols-3 gap-2">
          {[0, 1, 2].map((column) => (
            <div key={column} className="rounded-md bg-white p-2 shadow-sm">
              <div className="mb-2 h-2 w-2/3 rounded bg-[#0A2540]" />
              <div className="h-1.5 w-full rounded bg-[#23AEA8]/50" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className={`absolute left-[10%] ${isClosing ? "top-[38%] w-[72%]" : "top-[30%] w-[58%]"} h-[12%] rounded-sm bg-[#0A2540]`} />
          <div className={`absolute left-[10%] ${isClosing ? "top-[56%] w-[42%]" : "top-[48%] w-[48%]"} h-[7%] rounded-sm bg-[#23AEA8]`} />
        </>
      )}
    </div>
  );
}

function SlideGeneratedPreview({
  design,
  slide,
}: {
  design: NonNullable<SlideTemplateLibraryItem["preview_design"]>;
  slide: SlideTemplateLibraryItem["preview_slides"][number];
}) {
  const layout = slide.layout || "";
  const isFramework = layout === "framework";
  const isData = layout === "data" || slide.chart_points.length > 0;
  const isSplit = layout.includes("split");
  const chartMax = Math.max(...slide.chart_points, 1);

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-md border shadow-sm"
      style={{
        background: design.background,
        borderColor: `${design.muted}33`,
        color: design.text,
      }}
      title={`${slide.title} (${slide.type})`}
    >
      <div className="absolute left-[8%] top-[9%] flex w-[84%] items-center justify-between text-[7px] font-black uppercase tracking-wide" style={{ color: design.text }}>
        <span>SofLIA</span>
        <span>{slide.type.replace(/_/g, " ")}</span>
      </div>
      <span className="absolute left-[8%] top-[27%] h-1 w-[18%] rounded-full" style={{ background: design.accent }} />

      {isData ? (
        <div className="absolute inset-x-[8%] bottom-[15%] flex h-[38%] items-end gap-1.5 rounded-md p-2" style={{ background: design.surface }}>
          {(slide.chart_points.length > 0 ? slide.chart_points : [4, 3, 5]).map((value, index) => (
            <span
              key={`${value}-${index}`}
              className="flex-1 rounded-t-sm"
              style={{
                background: index % 2 === 0 ? design.accent : design.accent2,
                height: `${Math.max(18, (value / chartMax) * 100)}%`,
              }}
            />
          ))}
        </div>
      ) : isFramework ? (
        <div className="absolute inset-x-[8%] bottom-[13%] grid h-[38%] grid-cols-3 gap-1.5">
          {(slide.body_items.length > 0 ? slide.body_items : ["idea", "dato", "accion"]).slice(0, 3).map((item, index) => (
            <div key={`${item}-${index}`} className="rounded-md p-1 shadow-sm" style={{ background: design.surface }}>
              <span className="text-[7px] font-black" style={{ color: design.accent }}>0{index + 1}</span>
              <div className="mt-1 h-1.5 w-4/5 rounded" style={{ background: design.text }} />
              <div className="mt-1 h-1 w-3/5 rounded" style={{ background: design.muted }} />
            </div>
          ))}
        </div>
      ) : isSplit ? (
        <>
          <div className="absolute left-[8%] top-[41%] h-2 w-[39%] rounded" style={{ background: design.text }} />
          <div className="absolute left-[8%] top-[55%] h-1.5 w-[31%] rounded" style={{ background: design.muted }} />
          <div className="absolute right-[8%] top-[29%] h-[48%] w-[34%] rounded-md shadow-sm" style={{ background: `linear-gradient(135deg, ${design.accent}, ${design.accent2})` }} />
        </>
      ) : (
        <>
          <h3 className="absolute left-[8%] top-[38%] line-clamp-2 w-[76%] text-[11px] font-black leading-tight" style={{ color: design.text }}>
            {slide.title}
          </h3>
          <div className="absolute left-[8%] top-[68%] h-1.5 w-[42%] rounded" style={{ background: design.muted }} />
        </>
      )}
    </div>
  );
}

export function SlideTemplatePreview({ item }: { item: SlideTemplateLibraryItem }) {
  const layouts = item.layouts.length > 0 ? item.layouts.slice(0, 4) : ["provocation", "split_text_media", "data_explainer", "closing"];
  const hasGeneratedPreviews = item.preview_design && item.preview_slides.length > 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#0F1419]">
      <div className="grid grid-cols-2 gap-2">
        {hasGeneratedPreviews
          ? item.preview_slides.slice(0, 4).map((slide) => (
              <SlideGeneratedPreview
                key={`${slide.order}-${slide.type}`}
                design={item.preview_design!}
                slide={slide}
              />
            ))
          : layouts.map((layout, index) => (
              <SlideLayoutSketch key={`${layout}-${index}`} layout={layout} index={index} />
            ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(hasGeneratedPreviews ? item.preview_slides.map((slide) => slide.type) : layouts).slice(0, 3).map((label) => (
          <span key={label} className="rounded-full bg-[#23AEA8]/10 px-2 py-0.5 text-[10px] font-semibold text-[#138A87]">
            {layoutNames[label] || label.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
