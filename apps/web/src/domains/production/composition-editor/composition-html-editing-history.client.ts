import { z } from "zod";
import { htmlEditingInspectorViewSchema, type HtmlEditingInspectorView } from "./html-editing/html-editing-inspector.contract";
import { htmlEditingBindingsMatch } from "./html-editing/html-editing-validation";
import { htmlEditingMutationAcknowledgmentSchema, type HtmlEditingMutationRequest } from "./composition-html-editing-mutation.contract";
import type { HtmlEditingClientScope } from "./composition-html-editing-http.client";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";

type Locator = { version: number; sha256: string };
type Entry = { before: Locator; after: Locator };
type Direction = "UNDO" | "REDO";
const maximumEntries = 100;
/** Session-local history of confirmed server locators, never source/HTML or
 * optimistic content. Owner-keyed callers must discard this instance on logout.
 * Unknown writes require an explicit authorized read and lose local history:
 * observing matching content cannot attribute a write to this client. */
export class HtmlEditingEditorialHistory {
  readonly #scope: HtmlEditingClientScope;
  readonly #actorId: string;
  #view: HtmlEditingInspectorView | null = null;
  #head: Locator | null = null;
  #undo: Entry[] = [];
  #redo: Entry[] = [];
  #status: "EMPTY" | "READY" | "PENDING" | "REFRESH_REQUIRED" | "UNCERTAIN" = "EMPTY";
  #pending: "COMMAND" | Direction | null = null;
  constructor(scope: HtmlEditingClientScope & { actorId: string }) {
    this.#actorId = z.string().uuid().parse(scope.actorId);
    this.#scope = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true }).parse({
      organizationId: scope.organizationId, documentId: scope.documentId, clipId: scope.clipId });
  }
  observe(input: HtmlEditingInspectorView, actorId: string) {
    const view = htmlEditingInspectorViewSchema.parse(input), binding = view.manifest.binding;
    if (actorId !== this.#actorId || binding.organizationId !== this.#scope.organizationId || binding.documentId !== this.#scope.documentId
      || binding.clipId !== this.#scope.clipId || this.#status === "PENDING") throw new Error("HTML_EDITING_HISTORY_SCOPE_OR_PENDING");
    const head = { version: view.revisionVersion, sha256: view.revisionSha256 };
    if (this.#status === "UNCERTAIN" || (this.#head && !matches(head, this.#head))
      || (this.#view && !htmlEditingBindingsMatch(binding, this.#view.manifest.binding))) { this.#undo = []; this.#redo = []; }
    this.#view = structuredClone(view); this.#head = head; this.#status = "READY";
  }
  beginCommand(): { expected: Locator; expectedCompositionDocumentHash: string } {
    const base = this.base(); this.#pending = "COMMAND"; this.#status = "PENDING"; return base;
  }
  beginRestore(direction: Direction): HtmlEditingMutationRequest {
    const base = this.base(), entry = (direction === "UNDO" ? this.#undo : this.#redo).at(-1);
    if (!entry) throw new Error("HTML_EDITING_HISTORY_EMPTY");
    this.#pending = direction; this.#status = "PENDING";
    return { ...base, action: "RESTORE", restore: { ...(direction === "UNDO" ? entry.before : entry.after) } };
  }
  confirm(input: z.infer<typeof htmlEditingMutationAcknowledgmentSchema>) {
    const ack = htmlEditingMutationAcknowledgmentSchema.parse(input);
    if (this.#status !== "PENDING" || !this.#head || !matches(ack.previous, this.#head)) throw new Error("HTML_EDITING_HISTORY_ACK_MISMATCH");
    if (ack.changed) {
      if (this.#pending === "COMMAND") { this.#undo.push({ before: ack.previous, after: ack.next }); this.#redo = []; }
      else if (this.#pending === "UNDO") { this.#undo.pop(); this.#redo.push({ before: ack.next, after: ack.previous }); }
      else { this.#redo.pop(); this.#undo.push({ before: ack.previous, after: ack.next }); }
      this.#undo = this.#undo.slice(-maximumEntries); this.#redo = this.#redo.slice(-maximumEntries);
    }
    this.#head = { ...ack.next }; this.#pending = null; this.#status = "REFRESH_REQUIRED";
  }
  markUncertain() { this.#pending = null; this.#status = "UNCERTAIN"; }
  snapshot() { return { status: this.#status, canUndo: this.#status === "READY" && this.#undo.length > 0,
    canRedo: this.#status === "READY" && this.#redo.length > 0, undoCount: this.#undo.length, redoCount: this.#redo.length }; }
  private base() {
    if (this.#status !== "READY" || !this.#head || !this.#view) throw new Error("HTML_EDITING_HISTORY_NOT_READY");
    return { expected: { ...this.#head }, expectedCompositionDocumentHash: this.#view.compositionDocumentHash };
  }
}
function matches(left: Locator, right: Locator) { return left.version === right.version && left.sha256 === right.sha256; }
