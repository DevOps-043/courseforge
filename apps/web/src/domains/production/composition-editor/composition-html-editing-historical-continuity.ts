import type { HtmlSnapshotHistoryPage } from "./composition-html-editing-snapshot-history.contract";
import type { HtmlSnapshotInspectionResult } from "./composition-html-editing-snapshot-inspection.contract";

type Guidance = {code: string; instruction: string};
const metadataGuidance = {
  HTML_PIN_REQUIRES_BYTE_INSPECTION: {code: "INSPECT_PINNED_BYTES",
    instruction: "Inspecciona los bytes fijados. El pin no autoriza restauración, ejecución ni publicación."},
  MISSING_OR_INVALID_HTML_METADATA: {code: "INVESTIGATE_METADATA",
    instruction: "Conserva el registro y solicita investigación autorizada de procedencia. No reconstruyas pins desde el borrador actual ni descartes el archivo."},
  NOT_MARKED_AS_SNAPSHOT: {code: "PRESERVE_NON_SNAPSHOT_RECORD",
    instruction: "Conserva este registro en el inventario. No lo conviertas automáticamente en snapshot HTML ni lo restaures por este flujo."},
} satisfies Record<HtmlSnapshotHistoryPage["entries"][number]["metadataStatus"], Guidance>;

/** Display guidance only, never permission or evidence of historical continuity.
 * No automatic repair/retry, source rewriting, restoration or compiler fallback. */
export function historicalHtmlMetadataGuidance(status: HtmlSnapshotHistoryPage["entries"][number]["metadataStatus"]) {
  return metadataGuidance[status];
}

export function historicalHtmlInspectionGuidance(diagnostic: HtmlSnapshotInspectionResult["diagnostic"]): Guidance {
  switch (diagnostic.status) {
    case "LEGACY_V1_REQUIRES_REVIEW":
    case "PROFILE_MISMATCH_REQUIRES_REVIEW":
      return {code: "PREPARE_SEPARATE_REVIEWED_REVISION",
        instruction: "Solicita al operador un candidato separado y aprobación independiente del ZIP completo. Si el contenido no es admitido actualmente, conserva el original y registra el bloqueo: este flujo no instala un ejecutor histórico ni reescribe la fuente. Nunca activa la revisión ni cambia el borrador."};
    case "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS":
      return {code: "VERIFY_CURRENT_CONTENT_AND_AUTHORITY",
        instruction: "Usa las verificaciones vigentes de documento, recursos y permisos. Un perfil igual no acredita paridad visual ni autoriza otra publicación; no corresponde migrarlo por el flujo histórico."};
    case "REJECTED":
      if (diagnostic.reason === "BYTE_INTEGRITY_MISMATCH" || diagnostic.reason === "SCOPE_MISMATCH") {
        return {code: "INVESTIGATE_IDENTITY_OR_INTEGRITY",
          instruction: "Bloquea ejecución y republicación. Conserva los pins del expediente y solicita investigación de identidad/integridad; no sustituyas el hash ni uses bytes de otra revisión."};
      }
      return {code: "PRESERVE_UNSUPPORTED_ARCHIVE",
        instruction: "Conserva el original sin ejecutarlo ni repararlo automáticamente. Solicita investigación autorizada del formato/contenido y registra el bloqueo de continuidad. No recompiles silenciosamente ni conviertas este rechazo en aprobación."};
  }
}
