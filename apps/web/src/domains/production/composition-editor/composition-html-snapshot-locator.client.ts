import { z } from "zod";

export const htmlSnapshotLocatorScopeSchema = z.object({actorId:z.string().uuid(),organizationId:z.string().uuid(),draftId:z.string().uuid()}).strict();
export type HtmlSnapshotLocatorScope = z.infer<typeof htmlSnapshotLocatorScopeSchema>;
const locatorSchema = z.object({schemaVersion:z.literal(1),scope:htmlSnapshotLocatorScopeSchema,
  operationId:z.string().uuid(),createdAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export type HtmlSnapshotLocator = z.infer<typeof locatorSchema>;
export type HtmlSnapshotLocatorStorage = Pick<Storage,"getItem" | "setItem" | "removeItem">;
const maximumLocatorBytes = 1024;
function key(scope:HtmlSnapshotLocatorScope) {
  const valid = htmlSnapshotLocatorScopeSchema.parse(scope);
  return `courseforge:html-snapshot:v1:${valid.actorId}:${valid.organizationId}:${valid.draftId}`;
}
export function resolveHtmlSnapshotLocatorStorage():HtmlSnapshotLocatorStorage | null {
  try {return typeof window === "undefined" ? null : window.localStorage;} catch {return null;}
}

/** Occupancy check for cooperative workflows: malformed tracking is not empty. */
export function readHtmlSnapshotTrackingAvailability(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope): "EMPTY" | "OCCUPIED" | "UNAVAILABLE" {
  if (!storage) return "UNAVAILABLE";
  try { return storage.getItem(key(scope)) === null ? "EMPTY" : "OCCUPIED"; }
  catch { return "UNAVAILABLE"; }
}
/** A local locator is never authority or proof of success. One slot per owner/
 * tenant/draft; no HTML, hashes, credentials or grants. No automatic expiry or
 * deletion of uncertain outcomes. LocalStorage is not a cross-tab transaction. */
export function readHtmlSnapshotLocator(storage:HtmlSnapshotLocatorStorage | null,scope:HtmlSnapshotLocatorScope):HtmlSnapshotLocator | null {
  if (!storage) return null;
  try {
    const encoded = storage.getItem(key(scope));
    if (!encoded || new TextEncoder().encode(encoded).byteLength > maximumLocatorBytes) return null;
    const parsed = locatorSchema.parse(JSON.parse(encoded));
    if (JSON.stringify(parsed.scope) !== JSON.stringify(htmlSnapshotLocatorScopeSchema.parse(scope))) return null;
    return parsed;
  } catch {return null;}
}
export function rememberHtmlSnapshotLocator(storage:HtmlSnapshotLocatorStorage | null,scope:HtmlSnapshotLocatorScope,
  operationId:string,now=Date.now()):"SAVED" | "EXISTING" | "DIFFERENT_PENDING" | "STORAGE_UNAVAILABLE" {
  if (!storage) return "STORAGE_UNAVAILABLE";
  const locator = locatorSchema.parse({schemaVersion:1,scope,operationId,createdAt:now});
  try {
    const existingEncoded = storage.getItem(key(scope));
    const previous = readHtmlSnapshotLocator(storage,scope);
    if (previous) return previous.operationId === operationId ? "EXISTING" : "DIFFERENT_PENDING";
    // Corrupt/unreadable state is not evidence of an empty slot. Preserve it.
    if (existingEncoded !== null) return "STORAGE_UNAVAILABLE";
    storage.setItem(key(scope),JSON.stringify(locator));
    return readHtmlSnapshotLocator(storage,scope)?.operationId === operationId ? "SAVED" : "STORAGE_UNAVAILABLE";
  } catch {return "STORAGE_UNAVAILABLE";}
}
/** Only explicit UI confirmation of a terminal registered result clears tracking.
 * Expected ID avoids clearing a different observed slot; not an atomic tab CAS. */
export function clearConfirmedHtmlSnapshotLocator(storage:HtmlSnapshotLocatorStorage | null,scope:HtmlSnapshotLocatorScope,
  operationId:string,status:string):boolean {
  if (!storage || !["COMMITTED_ACTIVE","COMMITTED_SUPERSEDED"].includes(status)) return false;
  try {
    if (readHtmlSnapshotLocator(storage,scope)?.operationId !== operationId) return false;
    storage.removeItem(key(scope));return true;
  } catch {return false;}
}
