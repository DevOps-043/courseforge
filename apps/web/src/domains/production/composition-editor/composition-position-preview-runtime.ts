export type CompositionPositionPreview = { x?: number; y?: number };

/** Estado efímero: se rebasa sobre el DOM canónico sin alterar hashes ni motion. */
export function createCompositionPositionPreviewRuntime(
  resolveTarget: (hfId: string) => HTMLElement | null,
  limits: { minimum: number; maximum: number },
) {
  const pending = new Map<string, { target: HTMLElement; left: string; top: string; position: CompositionPositionPreview }>();
  const apply = (entry: { target: HTMLElement; position: CompositionPositionPreview }) => {
    if (entry.position.x !== undefined) entry.target.style.left = `${entry.position.x}px`;
    if (entry.position.y !== undefined) entry.target.style.top = `${entry.position.y}px`;
  };
  const reset = (hfId: string) => {
    const entry = pending.get(hfId);
    if (!entry) return;
    entry.target.style.left = entry.left;
    entry.target.style.top = entry.top;
    pending.delete(hfId);
  };
  return {
    preview(hfId: string, position: CompositionPositionPreview | null) {
      if (position === null) { reset(hfId); return; }
      const keys = Object.keys(position);
      if (!keys.length || keys.some(key => key !== "x" && key !== "y")
        || Object.values(position).some(value => !Number.isFinite(value) || value < limits.minimum || value > limits.maximum)) return;
      const target = resolveTarget(hfId);
      if (!target) return;
      const entry = pending.get(hfId) ?? { target, left: target.style.left, top: target.style.top, position: {} };
      entry.position = { ...entry.position, ...position };
      pending.set(hfId, entry);
      apply(entry);
    },
    restore() {
      for (const entry of pending.values()) {
        entry.target.style.left = entry.left;
        entry.target.style.top = entry.top;
      }
    },
    rebase() {
      for (const [hfId, entry] of pending) {
        const target = resolveTarget(hfId);
        if (!target) { pending.delete(hfId); continue; }
        entry.target = target;
        entry.left = target.style.left;
        entry.top = target.style.top;
        if ((entry.position.x === undefined || Number.parseFloat(entry.left) === entry.position.x)
          && (entry.position.y === undefined || Number.parseFloat(entry.top) === entry.position.y)) {
          pending.delete(hfId);
        } else apply(entry);
      }
    },
  };
}
