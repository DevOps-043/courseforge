import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";

/** Privileged client coordination port, never supplied by request data. A lock
 * only serializes cooperative same-origin callers; it is not server authority. */
export interface HtmlSnapshotPublicationLock {
  runExclusive<T>(scope: HtmlSnapshotLocatorScope, task: () => Promise<T>): Promise<T>;
}

export function resolveHtmlSnapshotPublicationLock(): HtmlSnapshotPublicationLock | null {
  try {
    if (typeof navigator === "undefined" || !navigator.locks) return null;
    const locks = navigator.locks;
    return {
      runExclusive: async <T>(scope: HtmlSnapshotLocatorScope, task: () => Promise<T>) => {
        const valid = htmlSnapshotLocatorScopeSchema.parse(scope);
        const name = `courseforge:html-snapshot-publication:v1:${valid.actorId}:${valid.organizationId}:${valid.draftId}`;
        return locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
          if (!lock) throw new Error("HTML_SNAPSHOT_PUBLICATION_BUSY");
          return task();
        });
      },
    };
  } catch { return null; }
}
