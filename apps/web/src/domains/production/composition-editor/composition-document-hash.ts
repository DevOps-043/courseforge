import { createHash } from "node:crypto";
import type { CompositionEditorDocument } from "./composition-document.types";
import {canonicalCompositionDocumentJson} from "./composition-document-canonical-json";

export function hashCompositionDocument(document: CompositionEditorDocument) {
  return createHash("sha256").update(canonicalCompositionDocumentJson(document)).digest("hex");
}
