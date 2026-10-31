import type { CompositionVisualMask } from "./composition-visual-mask";

/** Conserva el último gesto aunque llegue una confirmación visual anterior. */
export function createCompositionMaskPreviewRuntime(
  resolveTarget: (hfId: string) => HTMLElement | null,
  apply: (target: HTMLElement, mask: CompositionVisualMask | null) => void,
  clipPath: (mask: CompositionVisualMask | null) => string,
) {
  const pending = new Map<string, CompositionVisualMask | null>();
  const canonical = (target: HTMLElement): CompositionVisualMask | null => {
    try { return JSON.parse(target.dataset.visualMask || "null"); } catch { return null; }
  };
  return {
    preview(hfId: string, mask: CompositionVisualMask | null, reset = false) {
      const target = resolveTarget(hfId);
      if (reset) {
        pending.delete(hfId);
        if (target) apply(target, canonical(target));
        return;
      }
      try { clipPath(mask); } catch { return; }
      if (!target) return;
      pending.set(hfId, mask);
      apply(target, mask);
    },
    reapply() {
      for (const [hfId, mask] of pending) {
        const target = resolveTarget(hfId);
        if (!target) { pending.delete(hfId); continue; }
        if (clipPath(canonical(target)) === clipPath(mask)) pending.delete(hfId);
        else apply(target, mask);
      }
    },
  };
}
