import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const requiredOptions = ["bundle", "sha256", "organization", "document", "document-hash"];
const rejected = reason => ({ scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status: "REJECTED", reason });

/** Explicit local artifact only; no ZIP extraction, network, SQL or writes.
 * Operator supplies independently retrieved pins/scope, not claims from bundle. */
export async function inspectSnapshotCompatibility(options) {
  try { return await inspectLocalSnapshot(options); }
  catch { return rejected("ARTIFACT_CLOSE_FAILED"); }
}

async function inspectLocalSnapshot(options) {
  let handle;
  try {
    if (Object.keys(options).some(key => !requiredOptions.includes(key))
      || requiredOptions.some(key => typeof options[key] !== "string" || !options[key])
      || !isAbsolute(options.bundle)) return rejected("INVALID_OPTIONS");
    const { diagnoseCompositionHtmlEditingSnapshotCompatibility, HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } = require(
      "../../.tmp/cap029-tests/domains/production/composition-editor/composition-html-editing-snapshot-bundle.server.js");
    const original = await lstat(options.bundle, { bigint: true });
    if (!original.isFile() || original.isSymbolicLink() || original.size > BigInt(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes))
      return rejected("ARTIFACT_UNAVAILABLE_OR_OVERSIZED");
    handle = await open(options.bundle, "r");
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.ino !== original.ino || opened.dev !== original.dev || opened.size !== original.size)
      return rejected("ARTIFACT_CHANGED");
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (length !== Number(opened.size) || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs)
      return rejected("ARTIFACT_CHANGED");
    const content = bytes.subarray(0, length);
    if (createHash("sha256").update(content).digest("hex") !== options.sha256) return rejected("BYTE_INTEGRITY_MISMATCH");
    return diagnoseCompositionHtmlEditingSnapshotCompatibility({ archivePath: HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath,
      encodedBundle: content.toString("utf8"), sha256: options.sha256,
      scope: { organizationId: options.organization, documentId: options.document }, documentHash: options["document-hash"] });
  } catch { return rejected("ARTIFACT_OR_COMPILED_INSPECTOR_UNAVAILABLE"); }
  finally { if (handle) await handle.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2), options = {};
  let valid = argumentsList.length === requiredOptions.length * 2;
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index].replace(/^--/, "");
    if (!argumentsList[index].startsWith("--") || Object.hasOwn(options, name)) valid = false;
    options[name] = argumentsList[index + 1];
  }
  const result = valid ? await inspectSnapshotCompatibility(options) : rejected("INVALID_OPTIONS");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS" ? 0 : 1;
}
