import {createHash} from "node:crypto";
import {readFile, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {materializeAuthorizedConformanceRevision} from "./composition-conformance-storage";
import {CONFORMANCE_MATERIALIZATION_LIMITS} from "./composition-conformance-materialization";
import {verifyConformanceReferenceSource, conformanceReferenceSourceSchema, CONFORMANCE_REFERENCE_ARCHIVE_PATHS} from "../composition-conformance-reference.service";
import {HTML_EDITING_SNAPSHOT_BUNDLE_POLICY, restoreCompositionHtmlEditingSnapshot, verifyCompositionHtmlEditingSnapshotContent,
  type HtmlEditingFrozenCompilationInput, type HtmlEditingFrozenSnapshotBundle} from "../composition-html-editing-snapshot-bundle.server";
import {compileCompositionHtmlEditingFragments} from "../composition-html-editing-compilation.server";
import {assertHtmlEditingImageIdentities, type HtmlEditingImageIdentity} from "../composition-html-editing-image-identity";
import {compileCompositionPreview, readCompositionAnimationRuntime, COMPOSITION_COMPILATION_TARGETS} from "../composition-preview-compiler.service";
import {conformanceFontPath} from "../composition-conformance-font-bindings";
import type {CompositionCompiledFont} from "../../fonts/organization-font.types";
import type {ControlledSupervisorRenderer} from "./composition-render-supervisor.service";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {assertControlledDeckSourcesLocal, applyControlledBrowserResourcePolicy} from "./composition-controlled-source-policy";
import {MATERIALIZED_MEASUREMENT_PLAN_POLICY} from "./composition-materialized-measurement-plan-policy";

type Descriptor = Parameters<ControlledSupervisorRenderer>[0];
type MaterializationInput = Parameters<typeof materializeAuthorizedConformanceRevision>[0] & {
  expected: Pick<Descriptor,"projectHash" | "documentHash" | "contract">;
  animationRuntimeSha256: string;
  // Host-owned resolver: authorize this revision/actor independently, resolve its
  // draft and read current template bindings/grants. Never echo archive authority.
  readHtmlEditingAuthority?: (request: {organizationId: string; revisionId: string; documentHash: string; signal?: AbortSignal})
    => Promise<Pick<HtmlEditingFrozenCompilationInput, "scope" | "authorities"> & {imageAssets: readonly HtmlEditingImageIdentity[]}>;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value),"utf8").digest("hex");

/** Local render compilation from authorized frozen source; never reuses preview HTML as render evidence. */
export async function materializeControlledRenderRevision(input: MaterializationInput) {
  input.signal?.throwIfAborted();
  if (!/^[a-f0-9]{64}$/.test(input.animationRuntimeSha256)) throw new Error("CONTROLLED_RENDER_RUNTIME_EXPECTATION_INVALID");
  const reference = await materializeAuthorizedConformanceRevision(input);
  const generated: string[] = [];
  const cleanup = async () => {
    for (const path of generated.slice().reverse()) await rm(path,{force:true});
    await reference.cleanup();
  };
  try {
    if (reference.receipt.projectHash !== input.expected.projectHash || reference.receipt.documentHash !== input.expected.documentHash)
      throw new Error("CONTROLLED_RENDER_MATERIALIZATION_BINDING_MISMATCH");
    const sourceFiles = [CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview, CONFORMANCE_REFERENCE_ARCHIVE_PATHS.metadata,
      "composition-document.json","conformance-contract.json","font-manifest.json","materialization.json"];
    const sourcePins = await Promise.all(sourceFiles.map(async relative => ({relative,
      pin: await pinConformanceFile(join(reference.directory,relative),CONFORMANCE_MATERIALIZATION_LIMITS.sourceFileBytes)})));
    const text = (relative: string) => readFile(join(reference.directory,relative),"utf8");
    const [previewHtml,metadata,documentJson,contractJson,fontManifest] = await Promise.all(sourceFiles.slice(0,5).map(text));
    const parsedMetadata = conformanceReferenceSourceSchema.parse(JSON.parse(metadata));
    let htmlEditingBundle: HtmlEditingFrozenSnapshotBundle | undefined;
    if (parsedMetadata.htmlEditingSnapshot) {
      const pin = parsedMetadata.htmlEditingSnapshot;
      sourcePins.push({relative: pin.path, pin: await pinConformanceFile(join(reference.directory,pin.path),
        HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes)});
      htmlEditingBundle = {archivePath: pin.path, sha256: pin.sha256, encodedBundle: await text(pin.path)};
    }
    const source = verifyConformanceReferenceSource({previewHtml, metadata: parsedMetadata,documentJson,contractJson,
      fontManifest: JSON.parse(fontManifest), htmlEditingBundle});
    const usedHtmlImageIds = htmlEditingBundle ? verifyCompositionHtmlEditingSnapshotContent({...htmlEditingBundle,
      document: source.document, documentHash: source.metadata.documentHash}).usedAssetIds : [];
    if (source.contract.schemaVersion !== 4 || !source.contract.renderExecution
      || digest(source.contract) !== digest(input.expected.contract)) throw new Error("CONTROLLED_RENDER_MATERIALIZATION_CONTRACT_MISMATCH");
    const fonts = source.fontManifest!;
    const fontAssets = new Map<string,CompositionCompiledFont>(fonts.map(font => [font.fontAssetId,
      {assetId:font.fontAssetId,family:font.family,sourceUrl:conformanceFontPath(font),
        format: font.mimeType === "font/otf" ? "opentype" : font.mimeType === "font/ttf" ? "truetype" : font.mimeType.slice(5) as "woff" | "woff2"}]));
    const assetUrls = new Map(source.metadata.bindings.map(binding => [binding.assetId,binding.localPath]));
    const deckAssetUrls = new Map(source.metadata.bindings.map(binding => {
      const storedPath = binding.storagePath.startsWith(`${binding.storageBucket}/`)
        ? binding.storagePath.slice(binding.storageBucket.length+1) : binding.storagePath;
      return [new URL(`/storage/v1/object/public/${binding.storageBucket}/${storedPath}`,input.supabaseUrl).href,binding.localPath];
    }));
    const refreshHtmlEditingAuthority = async () => {
      if (!htmlEditingBundle) return undefined;
      if (!input.readHtmlEditingAuthority) throw new Error("CONTROLLED_RENDER_HTML_AUTHORITY_REQUIRED");
      input.signal?.throwIfAborted();
      const authority = await input.readHtmlEditingAuthority({organizationId: input.organizationId,
        revisionId: input.revisionId, documentHash: source.metadata.documentHash, signal: input.signal});
      input.signal?.throwIfAborted();
      if (authority?.scope?.organizationId !== input.organizationId) throw new Error("CONTROLLED_RENDER_HTML_AUTHORITY_SCOPE_MISMATCH");
      assertHtmlEditingImageIdentities({usedAssetIds: usedHtmlImageIds, currentImages: authority.imageAssets,
        frozenBindings: source.metadata.bindings});
      const snapshot: HtmlEditingFrozenCompilationInput = {...htmlEditingBundle,
        scope: authority.scope, authorities: authority.authorities};
      const context = restoreCompositionHtmlEditingSnapshot({...snapshot,
        document: source.document, documentHash: source.metadata.documentHash});
      // Current grants and actual materialized aliases must both cover every
      // used image; content-only verification never supplies these permissions.
      const fragments = compileCompositionHtmlEditingFragments({document: source.document, documentHash: source.metadata.documentHash,
        context, assetUrls});
      return {snapshot, fragments};
    };
    const htmlEditing = await refreshHtmlEditingAuthority();
    assertControlledDeckSourcesLocal({document:source.document,remoteToLocal:deckAssetUrls,
      localFiles:new Set([...assetUrls.values(),...fonts.map(conformanceFontPath)]), resolvedDeckFragments: htmlEditing?.fragments});
    const [compiledHtml,runtime] = await Promise.all([
      compileCompositionPreview({document:source.document,documentHash:source.metadata.documentHash,
        assetUrls,deckAssetUrls,fontAssets,htmlEditingSnapshot: htmlEditing?.snapshot,target:COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER}),
      readCompositionAnimationRuntime(),
    ]);
    const html = applyControlledBrowserResourcePolicy(compiledHtml);
    if (createHash("sha256").update(runtime,"utf8").digest("hex") !== input.animationRuntimeSha256)
      throw new Error("CONTROLLED_RENDER_RUNTIME_HASH_MISMATCH");
    if ([html,runtime].some(bytes => Buffer.byteLength(bytes,"utf8") > CONFORMANCE_MATERIALIZATION_LIMITS.sourceFileBytes))
      throw new Error("CONTROLLED_RENDER_COMPILED_SOURCE_TOO_LARGE");
    input.signal?.throwIfAborted();
    for (const [relative,bytes] of [["index.html",html],["assets/gsap.min.js",runtime]] as const) {
      const path = join(reference.directory,relative); generated.push(path);
      await writeFile(path,bytes,{flag:"wx",mode:0o600});
    }
    const mediaFiles = source.metadata.bindings.map(binding => binding.localPath);
    const fontFiles = [...new Set(fonts.map(conformanceFontPath))];
    const filePins = [...sourcePins,...await Promise.all([...mediaFiles,...fontFiles,"index.html","assets/gsap.min.js"].map(async relative => ({relative,
      pin: await pinConformanceFile(join(reference.directory,relative),CONFORMANCE_MATERIALIZATION_LIMITS.mediaBytes)})))];
    const assertUnchanged = async () => {
      input.signal?.throwIfAborted();
      for (const file of filePins) await assertConformanceFileUnchanged(join(reference.directory,file.relative),file.pin,
        CONFORMANCE_MATERIALIZATION_LIMITS.mediaBytes);
      await refreshHtmlEditingAuthority();
      input.signal?.throwIfAborted();
    };
    await assertUnchanged();
    // Keep an independent frozen source snapshot. Executors receive copies, not
    // the objects used to authorize recompilation or refresh HTML grants.
    const measurementPlan = structuredClone({
      scope: MATERIALIZED_MEASUREMENT_PLAN_POLICY.scope,
      organizationId: input.organizationId, revisionId: input.revisionId,
      projectHash: input.expected.projectHash, documentHash: source.metadata.documentHash,
      contractSha256: digest(source.contract), document: source.document,
      contract: source.contract, fonts,
      files: filePins.map(file => ({path: file.relative, sha256: file.pin.sha256, sizeBytes: file.pin.sizeBytes})),
    });
    const measurementBytes = JSON.stringify(measurementPlan);
    if (Buffer.byteLength(measurementBytes) > MATERIALIZED_MEASUREMENT_PLAN_POLICY.maximumBytes)
      throw new Error("CONTROLLED_RENDER_MEASUREMENT_PLAN_TOO_LARGE");
    const measurementPath = join(reference.directory, MATERIALIZED_MEASUREMENT_PLAN_POLICY.path);
    generated.push(measurementPath);
    await writeFile(measurementPath, measurementBytes, {flag: "wx", mode: 0o600});
    const measurementPin = await pinConformanceFile(measurementPath, MATERIALIZED_MEASUREMENT_PLAN_POLICY.maximumBytes);
    const measurementPlanReference = {sha256: measurementPin.sha256, sizeBytes: measurementPin.sizeBytes};
    const verifyMeasurementPlan = async () => {
      await assertUnchanged();
      await assertConformanceFileUnchanged(measurementPath, measurementPin, MATERIALIZED_MEASUREMENT_PLAN_POLICY.maximumBytes);
      input.signal?.throwIfAborted();
    };
    const readMeasurementPlan = async () => {
      await verifyMeasurementPlan();
      const snapshot = structuredClone(measurementPlan);
      input.signal?.throwIfAborted();
      return snapshot;
    };
    return {directory:reference.directory,entryPath:join(reference.directory,"index.html"),assertUnchanged: verifyMeasurementPlan,cleanup,
      readMeasurementPlan, measurementPlanReference,
      receipt:{scope:"AUTHORIZED_SOURCE_RECOMPILED_NOT_ORIGINAL_RENDER_HTML" as const,
        organizationId:input.organizationId,revisionId:input.revisionId,projectHash:input.expected.projectHash,
        documentHash:source.metadata.documentHash,contractSha256:digest(source.contract),
        files:filePins.map(file => ({path:file.relative,sha256:file.pin.sha256,sizeBytes:file.pin.sizeBytes}))}};
  } catch (error) {await cleanup(); throw error;}
}
