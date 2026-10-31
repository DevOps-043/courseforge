import type { CompositionReferenceGuides } from "./composition-reference-guides";

/** Autocontenido para serializar exclusivamente dentro del preview interactivo. */
export function createCompositionReferenceGuidesRuntime(
  root: HTMLElement,
  onMove: (id: string, ratio: number) => void,
  maximumGuides: number,
) {
  const document = root.ownerDocument;
  const layer = document.createElement("div");
  layer.className = "composition-reference-guides";
  Object.assign(layer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2147483646" });
  layer.setAttribute("aria-label", "Líneas de referencia");
  let state: CompositionReferenceGuides = { visible: true, guides: [] };
  let dragging = false;
  const render = () => {
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset.guideId;
    if (layer.parentElement !== root) root.appendChild(layer);
    layer.replaceChildren();
    if (!state.visible) return;
    for (const guide of state.guides) {
      const vertical = guide.axis === "x";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "composition-reference-guide";
      button.dataset.guideId = guide.id;
      button.dataset.axis = guide.axis;
      button.setAttribute("aria-label", `Guía ${vertical ? "vertical" : "horizontal"}`);
      button.title = "Arrastra para mover; usa flechas para 1 px o Shift para 10 px";
      Object.assign(button.style, {
        position: "absolute", margin: "0", padding: "0", border: "0", background: "transparent", pointerEvents: "auto",
        cursor: vertical ? "col-resize" : "row-resize",
        width: vertical ? "calc(8px * var(--editor-control-scale, 1))" : "100%",
        height: vertical ? "100%" : "calc(8px * var(--editor-control-scale, 1))",
        left: vertical ? `${guide.ratio * 100}%` : "0", top: vertical ? "0" : `${guide.ratio * 100}%`,
        transform: vertical ? "translateX(-50%)" : "translateY(-50%)",
      });
      const line = document.createElement("span");
      Object.assign(line.style, { position: "absolute", pointerEvents: "none", inset: "0",
        ...(vertical ? { left: "50%", borderLeft: `1px dashed ${guide.color}` } : { top: "50%", borderTop: `1px dashed ${guide.color}` }) });
      button.appendChild(line);
      const update = (ratio: number) => {
        guide.ratio = Math.max(0, Math.min(1, ratio));
        button.style[vertical ? "left" : "top"] = `${guide.ratio * 100}%`;
      };
      let pointerId: number | null = null;
      let originalRatio = guide.ratio;
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        pointerId = event.pointerId; originalRatio = guide.ratio; dragging = true;
        button.setPointerCapture(event.pointerId);
        button.focus({ preventScroll: true });
      });
      button.addEventListener("pointermove", event => {
        if (event.pointerId !== pointerId) return;
        event.stopPropagation();
        const box = root.getBoundingClientRect(), extent = vertical ? box.width : box.height;
        if (extent > 0) update(((vertical ? event.clientX - box.left : event.clientY - box.top)) / extent);
      });
      const finish = (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return;
        event.stopPropagation();
        pointerId = null; dragging = false;
        if (event.type === "pointercancel") update(originalRatio);
        else onMove(guide.id, guide.ratio);
      };
      button.addEventListener("pointerup", finish);
      button.addEventListener("pointercancel", finish);
      button.addEventListener("lostpointercapture", () => {
        if (pointerId === null) return;
        pointerId = null; dragging = false; update(originalRatio);
      });
      button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
      button.addEventListener("keydown", event => {
        event.stopPropagation();
        const decrease = vertical ? "ArrowLeft" : "ArrowUp", increase = vertical ? "ArrowRight" : "ArrowDown";
        if (![decrease, increase, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const extent = vertical ? root.offsetWidth : root.offsetHeight;
        if (extent <= 0) return;
        const step = (event.shiftKey ? 10 : 1) / extent;
        update(event.key === "Home" ? 0 : event.key === "End" ? 1 : guide.ratio + (event.key === decrease ? -step : step));
        onMove(guide.id, guide.ratio);
      });
      button.addEventListener("keyup", event => event.stopPropagation());
      layer.appendChild(button);
      if (focusedId === guide.id) button.focus({ preventScroll: true });
    }
  };
  return {
    update(candidate: CompositionReferenceGuides) {
      if (!candidate || typeof candidate.visible !== "boolean" || !Array.isArray(candidate.guides) || candidate.guides.length > maximumGuides
        || new Set(candidate.guides.map(guide => guide?.id)).size !== candidate.guides.length
        || candidate.guides.some(guide => !guide || typeof guide.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guide.id)
          || (guide.axis !== "x" && guide.axis !== "y") || !Number.isFinite(guide.ratio) || guide.ratio < 0 || guide.ratio > 1
          || typeof guide.color !== "string" || !/^#[0-9a-f]{6}$/i.test(guide.color))) return;
      dragging = false;
      state = { visible: candidate.visible, guides: candidate.guides.map(guide => ({ ...guide })) };
      render();
    },
    render,
    positions(axis: "x" | "y", extent: number) {
      return state.visible && !dragging ? state.guides.filter(guide => guide.axis === axis).map(guide => guide.ratio * extent) : [];
    },
  };
}
