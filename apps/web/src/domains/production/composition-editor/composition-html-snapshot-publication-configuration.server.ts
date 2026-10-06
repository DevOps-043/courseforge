import { controlledRenderExecutionContractSchema } from "./composition-render-execution-contract";
import { HTML_SNAPSHOT_PUBLICATION_HTTP_POLICY } from "./composition-html-snapshot-publication-http.contract";

/** Operator-owned expected pins only, NOT proof that a renderer/browser/files
 * have actually run or matched. No fallback pins, paths or request overrides. */
export function readHtmlSnapshotExecutionConfiguration(encoded:unknown) {
  if (typeof encoded !== "string" || Buffer.byteLength(encoded)>HTML_SNAPSHOT_PUBLICATION_HTTP_POLICY.maximumConfigurationBytes)
    throw new Error("HTML_SNAPSHOT_EXECUTION_CONFIGURATION_UNAVAILABLE");
  try {return controlledRenderExecutionContractSchema.parse(JSON.parse(encoded));}
  catch {throw new Error("HTML_SNAPSHOT_EXECUTION_CONFIGURATION_UNAVAILABLE");}
}
