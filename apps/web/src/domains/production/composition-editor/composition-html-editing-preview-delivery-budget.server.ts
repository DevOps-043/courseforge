export const HTML_PREVIEW_DELIVERY_BUDGET = Object.freeze({ simultaneousReads: 4, privateDiskBytes: 2 * 1024 * 1024 * 1024 });
/** Shared preparation/delivery per-instance guard, NEVER authorization or cache.
 * Shared HTTP quotas remain required. Each instance has its own temp volume;
 * fleet-wide byte/concurrency admission is an additional deployment concern. */
export function createHtmlPreviewDeliveryBudget() {
  let reads = 0, bytes = 0;
  return {
    reserve(size: number) {
      if (!Number.isSafeInteger(size) || size < 0 || reads >= HTML_PREVIEW_DELIVERY_BUDGET.simultaneousReads
        || size > HTML_PREVIEW_DELIVERY_BUDGET.privateDiskBytes - bytes) throw new Error("HTML_PREVIEW_RESOURCE_BACKPRESSURE");
      reads++; bytes += size;
      let released = false;
      return () => { if (!released) { released = true; reads--; bytes -= size; } };
    },
    state: () => ({ reads, bytes }),
  };
}
export const htmlPreviewDeliveryBudget = createHtmlPreviewDeliveryBudget();
