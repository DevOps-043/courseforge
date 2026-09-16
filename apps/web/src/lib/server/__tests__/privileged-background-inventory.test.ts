import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import "../../../config/__tests__/web-security-policy.test";
import "../../../domains/production/hyperframes/__tests__/hyperframes-cloud.client.test";
import "../../../domains/production/providers/liveavatar/__tests__/liveavatar.client.test";

test("privileged Netlify handlers verify the internal signed envelope", () => {
  const functionsDir = join(process.cwd(), "netlify", "functions");
  const unguarded = readdirSync(functionsDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const source = readFileSync(join(functionsDir, name), "utf8");
      const isPrivileged =
        source.includes("createServiceRoleClient") ||
        source.includes("getSupabaseServiceKey");
      const hasSignedGuard = source.includes("parseVerifiedBackgroundBody");
      const hasScheduledGuard = source.includes('event.headers["x-nf-event"] !== "schedule"')
        && source.includes("schedule:");
      return isPrivileged && !hasSignedGuard && !hasScheduledGuard;
    });

  assert.deepEqual(
    unguarded,
    [],
    `Privileged handlers without a signed-envelope guard: ${unguarded.join(", ")}`,
  );
});

test("application code does not replace the complete material assets document", () => {
  const sourceRoot = join(process.cwd(), "src");
  const sourceFiles: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        if (name !== ".tmp") visit(path);
      } else if (/\.(?:ts|tsx)$/.test(name)) {
        sourceFiles.push(path);
      }
    }
  };
  visit(sourceRoot);

  const offenders = sourceFiles.filter((path) =>
    /\.update\(\s*\{\s*assets\s*:/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(
    offenders,
    [],
    `Full assets replacements bypass the atomic RPC: ${offenders.join(", ")}`,
  );
});

test("the legacy Express application cannot expose mock authentication", () => {
  const legacyApiRoot = resolve(process.cwd(), "..", "api", "src");
  const serverSource = readFileSync(join(legacyApiRoot, "server.ts"), "utf8");
  const authServiceSource = readFileSync(
    join(legacyApiRoot, "features", "auth", "auth.service.ts"),
    "utf8",
  );

  assert.doesNotMatch(serverSource, /app\.use\([^\n]*authRoutes/);
  assert.doesNotMatch(authServiceSource, /mock-jwt-token|password\s*===?\s*["']123456["']/);
  assert.match(authServiceSource, /Legacy authentication is disabled/);
});

test("audited outbound integrations keep explicit deadlines and download budgets", () => {
  const webRoot = resolve(process.cwd());
  const oneDriveSource = readFileSync(
    join(
      webRoot,
      "src",
      "domains",
      "production",
      "cloud-storage",
      "microsoft-graph.service.ts",
    ),
    "utf8",
  );
  const materialsRuntimeSource = readFileSync(
    join(
      webRoot,
      "netlify",
      "functions",
      "shared",
      "materials-generation-runtime.ts",
    ),
    "utf8",
  );
  const googleDriveSource = readFileSync(
    join(webRoot, "src", "domains", "production", "providers", "google-drive.service.ts"),
    "utf8",
  );
  const artlistSource = readFileSync(
    join(webRoot, "src", "domains", "production", "providers", "artlist.service.ts"),
    "utf8",
  );
  const googleOAuthSource = readFileSync(
    join(webRoot, "src", "app", "api", "auth", "google", "callback", "route.ts"),
    "utf8",
  );
  const microsoftOAuthSource = readFileSync(
    join(webRoot, "src", "app", "api", "auth", "microsoft", "callback", "route.ts"),
    "utf8",
  );
  const animatedDeckSource = readFileSync(
    join(webRoot, "src", "app", "api", "production", "slides", "animated-deck", "prepare", "route.ts"),
    "utf8",
  );
  const openDesignExportSource = readFileSync(
    join(webRoot, "src", "app", "api", "production", "open-design", "export", "route.ts"),
    "utf8",
  );
  const outboundHttpSource = readFileSync(
    join(webRoot, "src", "lib", "server", "outbound-http.ts"),
    "utf8",
  );
  const importConcurrencySource = readFileSync(
    join(webRoot, "src", "lib", "server", "external-import-concurrency.ts"),
    "utf8",
  );
  const boundedImportRoutes = [
    join(webRoot, "src", "app", "api", "production", "artlist", "import", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "google-drive", "import", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "cloud-storage", "import", "route.ts"),
  ].map((path) => readFileSync(path, "utf8"));

  assert.match(oneDriveSource, /fetchWithDeadline/);
  assert.match(oneDriveSource, /fetchIdempotentWithRetry/);
  assert.match(oneDriveSource, /new OutboundCircuitBreaker\(5, 30_000\)/);
  assert.match(oneDriveSource, /readResponseWithLimit\(contentResponse, MAX_ONEDRIVE_IMPORT_BYTES\)/);
  assert.match(googleDriveSource, /fetchWithDeadline/);
  assert.match(googleDriveSource, /fetchIdempotentWithRetry/);
  assert.match(googleDriveSource, /new OutboundCircuitBreaker\(5, 30_000\)/);
  assert.match(googleDriveSource, /readResponseWithLimit\(response, maxBytes\)/);
  assert.match(artlistSource, /fetchWithDeadline/);
  assert.match(artlistSource, /fetchIdempotentWithRetry/);
  assert.match(artlistSource, /new OutboundCircuitBreaker\(5, 30_000\)/);
  assert.match(artlistSource, /readResponseWithLimit\(response, MAX_ARTLIST_IMPORT_BYTES\)/);
  assert.match(animatedDeckSource, /assertSafeExternalMediaUrl\(normalizedUrl\)/);
  assert.match(animatedDeckSource, /redirect:\s*"error"/);
  assert.match(animatedDeckSource, /readResponseWithLimit\(response, MAX_REMOTE_ASSET_BYTES\)/);
  assert.match(openDesignExportSource, /escapeXml\(slide\.title\)/);
  assert.match(openDesignExportSource, /escapeXml\(slide\.narration/);
  assert.doesNotMatch(openDesignExportSource, /\$\{slide\.title\}/);
  assert.match(googleOAuthSource, /fetchWithDeadline/);
  assert.match(googleOAuthSource, /fetchIdempotentWithRetry/);
  assert.match(microsoftOAuthSource, /fetchWithDeadline/);
  assert.match(microsoftOAuthSource, /fetchIdempotentWithRetry/);
  for (const oauthSource of [googleOAuthSource, microsoftOAuthSource]) {
    assert.match(oauthSource, /OAUTH_RESPONSE_MAX_BYTES\s*=\s*64\s*\*\s*1024/);
    assert.match(oauthSource, /readJsonResponseWithLimit/);
    assert.match(oauthSource, /provider-json-contracts/);
    assert.doesNotMatch(oauthSource, /\.json\(\)/);
  }
  assert.doesNotMatch(googleOAuthSource, /message:\s*err(?:or)?\??\.?message/);
  assert.doesNotMatch(microsoftOAuthSource, /message:\s*err(?:or)?\??\.?message/);
  assert.match(materialsRuntimeSource, /signal: AbortSignal\.timeout\(triggerTimeoutMilliseconds\)/);
  assert.match(materialsRuntimeSource, /if \(!response\.ok\)/);
  assert.match(outboundHttpSource, /method !== "GET" && method !== "HEAD"/);
  assert.match(outboundHttpSource, /response\.headers\.get\("retry-after"\)/);
  assert.match(outboundHttpSource, /class OutboundCircuitBreaker/);
  assert.match(importConcurrencySource, /new BoundedConcurrencyLimiter\(3, 12, 10_000\)/);
  for (const providerSource of [oneDriveSource, googleDriveSource, artlistSource]) {
    assert.match(providerSource, /readJsonResponseWithLimit/);
    assert.match(providerSource, /provider-json-contracts/);
    assert.doesNotMatch(providerSource, /\.json\(\)/);
  }
  for (const routeSource of boundedImportRoutes) {
    assert.match(routeSource, /withExternalImportCapacity/);
    assert.match(routeSource, /Retry-After/);
    assert.match(routeSource, /request\.signal/);
  }
});

test("curation validates every redirect target and bounds remote HTML", () => {
  const webRoot = resolve(process.cwd());
  const publicUrlPolicySource = readFileSync(
    join(webRoot, "src", "lib", "server", "public-url-policy.ts"),
    "utf8",
  );
  const curationSources = [
    join(webRoot, "netlify", "functions", "shared", "curation-runtime.ts"),
    join(webRoot, "netlify", "functions", "shared", "curation-v2", "validation.ts"),
  ].map((path) => readFileSync(path, "utf8"));
  const externalMediaPolicySource = readFileSync(
    join(webRoot, "src", "domains", "production", "external-media-import-policy.ts"),
    "utf8",
  );

  assert.match(publicUrlPolicySource, /redirect:\s*"manual"/);
  assert.match(publicUrlPolicySource, /assertPublicHttpsUrl/);
  assert.match(publicUrlPolicySource, /response\.body\?\.cancel/);
  assert.match(externalMediaPolicySource, /assertPublicHttpsUrl/);
  for (const source of curationSources) {
    assert.match(source, /fetchPublicUrlWithRedirects/);
    assert.match(source, /readResponseTextWithLimit/);
    assert.doesNotMatch(source, /redirect:\s*["']follow["']/);
    assert.doesNotMatch(source, /response\.text\(\)/);
  }
});

test("remaining production provider JSON is bounded at the response boundary", () => {
  const webRoot = resolve(process.cwd());
  const consumers = [
    join(webRoot, "src", "domains", "production", "hyperframes", "hyperframes-cloud.client.ts"),
    join(webRoot, "src", "domains", "production", "providers", "liveavatar", "liveavatar.client.ts"),
    join(webRoot, "src", "domains", "production", "providers", "heygen", "heygen-webhook.service.ts"),
    join(webRoot, "src", "app", "api", "production", "import-external", "route.ts"),
    join(webRoot, "src", "domains", "production", "automation", "production-automation-dispatcher.service.ts"),
  ].map((path) => readFileSync(path, "utf8"));

  for (const source of consumers) {
    assert.match(source, /readJsonResponseWithLimit/);
    assert.doesNotMatch(source, /response\.json\(\)|heygenResponse\.json\(\)/);
  }
});

test("the central HeyGen client bounds successful and error response bodies", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src",
      "domains",
      "production",
      "providers",
      "heygen",
      "heygen.client.ts",
    ),
    "utf8",
  );

  assert.match(source, /HEYGEN_JSON_RESPONSE_MAX_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /HEYGEN_ERROR_RESPONSE_MAX_BYTES\s*=\s*32\s*\*\s*1024/);
  assert.match(source, /readJsonResponseWithLimit/);
  assert.match(source, /readResponseTextWithLimit/);
  assert.doesNotMatch(source, /response\.json\(\)|response\.text\(\)/);
});

test("the composition studio keeps cohesive panels and its API boundary outside the god component", () => {
  const editorRoot = resolve(
    process.cwd(),
    "src",
    "domains",
    "materials",
    "components",
    "composition-editor",
  );
  const previewSource = readFileSync(join(editorRoot, "NativeCompositionPreview.tsx"), "utf8");
  const librarySource = readFileSync(join(editorRoot, "CompositionStudioLibrary.tsx"), "utf8");
  const inspectorSource = readFileSync(join(editorRoot, "CompositionInspector.tsx"), "utf8");
  const deliverySource = readFileSync(join(editorRoot, "CompositionDeliveryPanel.tsx"), "utf8");
  const agentSource = readFileSync(join(editorRoot, "CompositionAgentConversation.tsx"), "utf8");
  const viewportSource = readFileSync(join(editorRoot, "CompositionPreviewViewport.tsx"), "utf8");
  const toolbarSource = readFileSync(join(editorRoot, "CompositionPreviewToolbar.tsx"), "utf8");
  const timelineSource = readFileSync(join(editorRoot, "CompositionTimelineWorkspace.tsx"), "utf8");
  const controlsSource = readFileSync(join(editorRoot, "useCompositionStudioControls.ts"), "utf8");
  const presetControllerSource = readFileSync(join(editorRoot, "useCompositionPresetController.ts"), "utf8");
  const agentControllerSource = readFileSync(join(editorRoot, "useCompositionAgentProposalController.ts"), "utf8");

  assert.match(previewSource, /import \{\s*CompositionStudioLibrary,/);
  assert.doesNotMatch(previewSource, /function StudioLibrary|function AssetThumbnail/);
  assert.match(librarySource, /export function CompositionStudioLibrary/);
  assert.match(previewSource, /import \{ CompositionInspector \}/);
  assert.doesNotMatch(
    previewSource,
    /function CompositionInspector|function MediaFitControls|function VisualCropControls/,
  );
  assert.match(inspectorSource, /export function CompositionInspector/);
  assert.match(previewSource, /CompositionDeliveryPanel/);
  assert.doesNotMatch(previewSource, /function AssemblyActions|function renderQualityLabel/);
  assert.match(deliverySource, /export function CompositionDeliveryPanel/);
  assert.match(previewSource, /CompositionAgentConversation/);
  assert.doesNotMatch(previewSource, /function AgentConversation/);
  assert.match(agentSource, /export function CompositionAgentConversation/);
  assert.match(previewSource, /CompositionPreviewViewport/);
  assert.doesNotMatch(previewSource, /title="Preview completo de composición"/);
  assert.match(viewportSource, /export function CompositionPreviewViewport/);
  assert.match(viewportSource, /title="Preview completo de composición"/);
  assert.match(previewSource, /CompositionPreviewToolbar/);
  assert.doesNotMatch(previewSource, /styles\.previewToolbar|function PreviewToolButton/);
  assert.match(toolbarSource, /export function CompositionPreviewToolbar/);
  assert.match(previewSource, /CompositionTimelineWorkspace/);
  assert.doesNotMatch(previewSource, /styles\.timelinePanel|<AudioMixControls/);
  assert.match(timelineSource, /export function CompositionTimelineWorkspace/);
  assert.match(previewSource, /useCompositionStudioControls/);
  assert.doesNotMatch(
    previewSource,
    /const \[(directEditingEnabled|gridVisible|snapEnabled|previewZoom|previewFullscreen|trimToolEnabled|visualCropEnabled|studioTopPanePercent|studioResizing|toolMenuOpen),/,
  );
  assert.match(controlsSource, /export function useCompositionStudioControls/);
  assert.match(controlsSource, /document\.addEventListener\("pointerdown"/);
  assert.match(previewSource, /useCompositionPresetController/);
  assert.doesNotMatch(
    previewSource,
    /async function (loadCompositionPresets|createCompositionPreset|previewCompositionPreset|applyCompositionPresetPreview|dismissCompositionPresetPreview|undoLastCompositionPreset)/,
  );
  assert.match(presetControllerSource, /export function useCompositionPresetController/);
  assert.match(presetControllerSource, /readCompositionApiResponse/);
  assert.match(previewSource, /useCompositionAgentProposalController/);
  assert.doesNotMatch(
    previewSource,
    /async function (requestAgentProposal|approveAgentProposal|dismissAgentProposal|undoLastAgentProposal)/,
  );
  assert.doesNotMatch(
    previewSource,
    /const \[(agentProposal|lastAppliedAgentProposal|proposing),/,
  );
  assert.match(agentControllerSource, /export function useCompositionAgentProposalController/);
  assert.match(agentControllerSource, /readCompositionApiResponse/);
  assert.doesNotMatch(agentControllerSource, /response\.json\(\)/);
  assert.match(previewSource, /composition-editor-api\.client/);
  assert.doesNotMatch(previewSource, /async function readCompositionApiResponse/);
});

test("obsolete diagnostic and publication-preview APIs stay retired", () => {
  const apiRoot = join(process.cwd(), "src", "app", "api");
  const retiredRoutes = [
    join(apiRoot, "debug", "soflia", "route.ts"),
    join(apiRoot, "test", "route.ts"),
    join(apiRoot, "test-publish", "route.ts"),
  ];
  assert.deepEqual(
    retiredRoutes.filter((path) => existsSync(path)),
    [],
    "Retired diagnostic routes must not be deployed again.",
  );
});

test("publication delivery uses a durable signed outbox instead of the request lifecycle", () => {
  const webRoot = resolve(process.cwd());
  const routeSource = readFileSync(join(webRoot, "src", "app", "api", "publish", "route.ts"), "utf8");
  const triggerRouteSource = readFileSync(join(webRoot, "src", "app", "api", "trigger-publish", "route.ts"), "utf8");
  const workerSource = readFileSync(join(webRoot, "netlify", "functions", "publication-outbox-background.ts"), "utf8");
  const reconcileSource = readFileSync(join(webRoot, "netlify", "functions", "publication-outbox-reconcile.ts"), "utf8");

  assert.match(routeSource, /outbox_payload/);
  assert.match(routeSource, /dispatchBackgroundFunctionJson/);
  assert.doesNotMatch(routeSource, /courseengine_inbox/);
  assert.match(triggerRouteSource, /export\s*\{\s*POST\s*\}\s*from\s*['"]@\/app\/api\/publish\/route['"]/);
  assert.match(workerSource, /parseVerifiedBackgroundBody/);
  assert.match(reconcileSource, /x-nf-event/);
  assert.match(reconcileSource, /signBackgroundPayload/);
});

test("durable SCORM and publication paths use structured operational events", () => {
  const webRoot = resolve(process.cwd());
  const auditedFiles = [
    join(webRoot, "src", "app", "api", "publish", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "scorm", "upload", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "scorm", "process", "route.ts"),
    join(webRoot, "src", "domains", "publication", "publication-outbox.service.ts"),
    join(webRoot, "src", "domains", "scorm", "services", "scorm-parsing.service.ts"),
    join(webRoot, "src", "domains", "scorm", "services", "scorm-transformation.service.ts"),
    join(webRoot, "netlify", "functions", "publication-outbox-background.ts"),
    join(webRoot, "netlify", "functions", "publication-outbox-reconcile.ts"),
    join(webRoot, "netlify", "functions", "scorm-parsing-background.ts"),
    join(webRoot, "netlify", "functions", "scorm-transformation-background.ts"),
  ];
  const rawConsoleUsers = auditedFiles.filter((path) => /console\.(?:log|warn|error)/.test(readFileSync(path, "utf8")));
  const withoutLogger = auditedFiles.filter((path) => !readFileSync(path, "utf8").includes("createOperationalLogger"));

  assert.deepEqual(rawConsoleUsers, [], `Durable paths with raw console logging: ${rawConsoleUsers.join(", ")}`);
  assert.deepEqual(withoutLogger, [], `Durable paths without structured logging: ${withoutLogger.join(", ")}`);
});

test("Lia does not log prompts, model responses, actions or credential state", () => {
  const webRoot = resolve(process.cwd());
  const liaApiSource = readFileSync(join(webRoot, "src", "lib", "lia-api.ts"), "utf8");
  const liaRouteSource = readFileSync(join(webRoot, "src", "app", "api", "lia", "route.ts"), "utf8");

  assert.doesNotMatch(liaApiSource, /console\.|Raw text|Full response|JSON string was|API Key check/);
  assert.doesNotMatch(liaRouteSource, /console\.|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_API_KEY/);
  assert.match(liaApiSource, /createOperationalLogger/);
  assert.match(liaRouteSource, /correlationId/);
});

test("critical public APIs preserve the shared response and request-boundary contract", () => {
  const webRoot = resolve(process.cwd());
  const jsonRoutes = [
    join(webRoot, "src", "app", "api", "admin", "slides", "fonts", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "[conversationId]", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "[conversationId]", "generate", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "[conversationId]", "messages", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "[conversationId]", "specs", "route.ts"),
    join(webRoot, "src", "app", "api", "lia", "route.ts"),
    join(webRoot, "src", "app", "api", "publish", "route.ts"),
    join(webRoot, "src", "app", "api", "save-draft", "route.ts"),
    join(webRoot, "src", "app", "api", "syllabus", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "scorm", "process", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "artlist", "import", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "cloud-storage", "import", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "google-drive", "import", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "import-external", "route.ts"),
    join(webRoot, "src", "app", "api", "storage", "signed-upload-url", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "login", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "sign-up", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "switch-organization", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "users", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "automation", "runs", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "automation", "runs", "[runId]", "configuration", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "automation", "runs", "[runId]", "items", "[componentId]", "clips", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "assets", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "clips", "generate", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "clips", "voice", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "connection", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "platform", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "presets", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "scenes", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "speech", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "standalone", "videos", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "videos", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "liveavatar", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "sound-effects", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "connection", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "settings", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "renders", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "assets", "sync", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "[compositionId]", "snapshot", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "[compositionId]", "revisions", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "document", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "files", "[...path]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "branding", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "detach-audio", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preview-metrics", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "composition-presets", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preset-applications", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "agent-proposals", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "agent-proposals", "[proposalId]", "apply", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "[compositionId]", "final-video", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "appearance", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "animated-deck", "prepare", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "open-design", "export", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "open-design", "html-to-png", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "generate", "route.ts"),
  ];
  const auditedRoutes = [
    ...jsonRoutes,
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "base-bundle", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "bundle-agent", "conversations", "[conversationId]", "runs", "[runId]", "download", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "remotion", "template-versions", "[versionId]", "download", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "google", "login", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "microsoft", "login", "route.ts"),
    join(webRoot, "src", "app", "api", "v1", "production", "jobs", "[jobId]", "status", "route.ts"),
    join(webRoot, "src", "app", "api", "video-metadata", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "google", "disconnect", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "microsoft", "disconnect", "route.ts"),
    join(webRoot, "src", "app", "api", "admin", "scorm", "upload", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "automation", "runs", "[runId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "automation", "runs", "[runId]", "dispatch", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "clips", "status", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "connection", "validate", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "jobs", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "jobs", "[jobId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "standalone", "videos", "[videoId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "heygen", "sync", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "artlist", "search", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "cloud-storage", "list", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "google-drive", "list", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "assembly-branding", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "sound-effects", "[soundEffectId]", "preview", "route.ts"),
    join(webRoot, "src", "app", "api", "storage", "media", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "connection", "validate", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "renders", "[requestId]", "cancel", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "renders", "[requestId]", "diagnostics", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "renders", "[requestId]", "poll", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "assets", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "[compositionId]", "draft", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "compositions", "[compositionId]", "approve", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "revisions", "[revisionId]", "preview", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "assets", "[assetId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preview", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "composition-presets", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preset-applications", "[applicationId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preset-applications", "[applicationId]", "apply", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preset-applications", "[applicationId]", "preview", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "preset-applications", "[applicationId]", "undo", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "agent-proposals", "[proposalId]", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "agent-proposals", "[proposalId]", "preview", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "hyperframes", "drafts", "[draftId]", "agent-proposals", "[proposalId]", "undo", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "html-preview", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "jobs", "route.ts"),
    join(webRoot, "src", "app", "api", "production", "slides", "templates", "route.ts"),
  ];

  for (const path of jsonRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /parseJsonRequest/);
    assert.doesNotMatch(source, /await\s+(?:request|req)\.json\(\)/);
  }
  for (const path of auditedRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /apiErrorResponse|bundleAgentRouteErrorResponse/);
    assert.doesNotMatch(source, /NextResponse\.json\(\s*\{\s*(?:success:\s*false,\s*)?error:/);
  }

  const binaryDownloadRoutes = auditedRoutes.filter((path) => path.includes("bundle-agent\\base-bundle") || path.endsWith("download\\route.ts"));
  for (const path of binaryDownloadRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /x-request-id/);
    assert.doesNotMatch(source, /Buffer\.from\(await data\.arrayBuffer\(\)\)/);
  }

  const adminSlidesPreviewSource = readFileSync(
    join(webRoot, "src", "app", "api", "admin", "slides", "html-preview", "route.ts"),
    "utf8",
  );
  const productionSlidesPreviewSource = readFileSync(
    join(webRoot, "src", "app", "api", "production", "slides", "html-preview", "route.ts"),
    "utf8",
  );
  assert.match(adminSlidesPreviewSource, /export\s*\{\s*GET\s*\}\s*from/);
  assert.match(adminSlidesPreviewSource, /export const runtime = "nodejs"/);
  assert.match(productionSlidesPreviewSource, /getAuthorizedMaterialComponentAdmin/);
  assert.match(productionSlidesPreviewSource, /registeredPath !== storagePath/);

  const oauthProtocolRoutes = [
    join(webRoot, "src", "app", "api", "auth", "callback", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "google", "callback", "route.ts"),
    join(webRoot, "src", "app", "api", "auth", "microsoft", "callback", "route.ts"),
  ];
  for (const path of oauthProtocolRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /resolveCorrelationId/);
    assert.match(source, /requestId/);
    assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
  }
  const oauthPopupSource = readFileSync(
    join(webRoot, "src", "lib", "server", "oauth-popup-response.ts"),
    "utf8",
  );
  assert.match(oauthPopupSource, /Content-Security-Policy/);
  assert.match(oauthPopupSource, /!redirectPath\.startsWith\("\/\/"\)/);
  assert.match(oauthPopupSource, /"x-request-id": requestId/);

  const slidesRouteSource = readFileSync(
    join(webRoot, "src", "app", "api", "production", "slides", "generate", "route.ts"),
    "utf8",
  );
  const slidesWorkerSource = readFileSync(
    join(webRoot, "netlify", "functions", "slides-generation-background.ts"),
    "utf8",
  );
  assert.doesNotMatch(slidesRouteSource, /NextResponse/);
  assert.match(slidesWorkerSource, /parseVerifiedBackgroundBody/);
  assert.match(slidesWorkerSource, /slidesGenerationBackgroundRequestSchema\.parse/);

  const syllabusWorkerSource = readFileSync(
    join(webRoot, "netlify", "functions", "syllabus-generation-background.ts"),
    "utf8",
  );
  assert.match(syllabusWorkerSource, /parseVerifiedBackgroundBody/);
  assert.match(syllabusWorkerSource, /syllabusGenerationBackgroundRequestSchema\.safeParse/);

  const assemblyBrandingRouteSource = readFileSync(
    join(webRoot, "src", "app", "api", "production", "assembly-branding", "route.ts"),
    "utf8",
  );
  assert.doesNotMatch(assemblyBrandingRouteSource, /export async function POST/);
  assert.doesNotMatch(assemblyBrandingRouteSource, /request\.formData\(\)/);
  assert.match(assemblyBrandingRouteSource, /parseAssemblyBrandingStoragePath/);
  assert.match(assemblyBrandingRouteSource, /new UrlSource/);

  const assemblyBrandingUiSource = readFileSync(
    join(webRoot, "src", "app", "admin", "integrations", "AssemblyBrandingCard.tsx"),
    "utf8",
  );
  assert.match(assemblyBrandingUiSource, /uploadWithSignedUrl/);
  assert.match(assemblyBrandingUiSource, /purpose:\s*"assembly-branding"/);
  assert.doesNotMatch(assemblyBrandingUiSource, /new FormData/);

  const assemblyBrandingCleanupSource = readFileSync(
    join(webRoot, "netlify", "functions", "assembly-branding-upload-cleanup.ts"),
    "utf8",
  );
  assert.match(assemblyBrandingCleanupSource, /schedule:\s*"17 \* \* \* \*"/);
  assert.match(assemblyBrandingCleanupSource, /x-nf-event/);
  assert.match(assemblyBrandingCleanupSource, /isAbandonedAssemblyUpload/);
  assert.match(assemblyBrandingCleanupSource, /organization_assembly_assets/);
  assert.match(assemblyBrandingCleanupSource, /MAX_DELETIONS_PER_RUN/);
  assert.match(assemblyBrandingCleanupSource, /\.remove\(orphanPaths\)/);
});

test("critical AI provider calls keep deadlines and bounded response parsing", () => {
  const webRoot = resolve(process.cwd());
  const providerFiles = [
    join(webRoot, "src", "lib", "lia-api.ts"),
    join(webRoot, "src", "domains", "production", "bundle-agent", "ai-spec.service.ts"),
    join(webRoot, "src", "domains", "production", "composition-editor", "composition-agent-provider.service.ts"),
    join(webRoot, "src", "domains", "production", "slides", "agents", "visible-copy-synthesis-agent.service.ts"),
  ];

  for (const path of providerFiles) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /readJsonResponseWithLimit/);
    assert.match(source, /fetchWithDeadline|AbortSignal\.timeout/);
    assert.doesNotMatch(source, /\.json\(\)/);
  }
});

test("render control-plane responses and template bundle downloads stay bounded", () => {
  const webRoot = resolve(process.cwd());
  const productionActions = readFileSync(
    join(webRoot, "src", "domains", "materials", "actions", "production.actions.ts"),
    "utf8",
  );
  const templateVersions = readFileSync(
    join(webRoot, "src", "domains", "production", "templates", "template-version.service.ts"),
    "utf8",
  );

  assert.match(productionActions, /fetchProductionApiRead/);
  assert.match(productionActions, /fetchWithDeadline/);
  assert.match(productionActions, /readJsonResponseWithLimit/);
  assert.doesNotMatch(productionActions, /\bfetch\s*\(|\.json\(\)/);
  assert.match(templateVersions, /TEMPLATE_BUNDLE_MAX_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
  assert.match(templateVersions, /readResponseArrayBufferWithLimit/);
  assert.match(templateVersions, /fetchWithDeadline/);
  assert.doesNotMatch(templateVersions, /\.arrayBuffer\(\)|\bfetch\s*\(/);
});

test("critical material asset boundaries do not regress to any", () => {
  const webRoot = resolve(process.cwd());
  const auditedFiles = [
    join(webRoot, "src", "domains", "materials", "components", "ProductionAssetHeader.tsx"),
    join(webRoot, "src", "domains", "materials", "components", "ProductionStructuredAssetSections.tsx"),
    join(webRoot, "src", "domains", "materials", "hooks", "useProductionAssetState.ts"),
    join(webRoot, "src", "domains", "production", "providers", "artlist.service.ts"),
    join(webRoot, "src", "domains", "production", "providers", "artlist.types.ts"),
    join(webRoot, "src", "domains", "production", "providers", "google-picker-runtime.types.ts"),
    join(webRoot, "src", "lib", "server", "desktop-worker-assets.ts"),
    join(webRoot, "src", "lib", "server", "desktop-worker-control-plane.ts"),
    join(webRoot, "src", "lib", "server", "desktop-worker-job-contracts.ts"),
  ];
  const unsafeAnyPattern = /(?:\bas\s+any\b|:\s*any\b|<any>|Record<string,\s*any>)/;
  const offenders = auditedFiles.filter((path) =>
    unsafeAnyPattern.test(readFileSync(path, "utf8")),
  );

  assert.deepEqual(
    offenders,
    [],
    `Critical material boundaries using unsafe any: ${offenders.join(", ")}`,
  );
});

test("desktop worker persistence rows do not regress to unsafe any", () => {
  const webRoot = resolve(process.cwd());
  const controlPlaneSource = readFileSync(
    join(webRoot, "src", "lib", "server", "desktop-worker-control-plane.ts"),
    "utf8",
  );
  const persistenceTypesSource = readFileSync(
    join(webRoot, "src", "lib", "server", "desktop-worker-db.types.ts"),
    "utf8",
  );

  assert.match(controlPlaneSource, /readDatabaseRows<ProductionJobRow>/);
  assert.match(controlPlaneSource, /readDatabaseRows<RemotionTemplateBuildRow>/);
  assert.match(controlPlaneSource, /readDatabaseRows<RemotionTemplatePreviewRow>/);
  assert.match(controlPlaneSource, /readDatabaseRows<RenderWorkerJobRunRow>/);
  assert.doesNotMatch(
    controlPlaneSource,
    /\b(?:job|worker|build|preview|run|row|candidate)\s*:\s*any\b|const\s+claimed\s*:\s*any\[\]/,
  );
  assert.doesNotMatch(
    persistenceTypesSource,
    /\bas\s+any\b|:\s*any\b|<any>|Record<string,\s*any>/,
  );
});

test("SCORM parsing and transformation stay outside requests and behind signed background boundaries", () => {
  const webRoot = resolve(process.cwd());
  const routeSource = readFileSync(
    join(webRoot, "src", "app", "api", "admin", "scorm", "process", "route.ts"),
    "utf8",
  );
  const backgroundSource = readFileSync(
    join(webRoot, "netlify", "functions", "scorm-transformation-background.ts"),
    "utf8",
  );
  const uploadSource = readFileSync(
    join(webRoot, "src", "app", "api", "admin", "scorm", "upload", "route.ts"),
    "utf8",
  );
  const parsingBackgroundSource = readFileSync(
    join(webRoot, "netlify", "functions", "scorm-parsing-background.ts"),
    "utf8",
  );
  const transformationSource = readFileSync(
    join(webRoot, "src", "domains", "scorm", "services", "scorm-transformation.service.ts"),
    "utf8",
  );

  assert.match(routeSource, /dispatchBackgroundFunctionJson/);
  assert.doesNotMatch(routeSource, /ScormTransformationService/);
  assert.match(backgroundSource, /parseVerifiedBackgroundBody/);
  assert.match(uploadSource, /dispatchBackgroundFunctionJson/);
  assert.doesNotMatch(uploadSource, /ScormParserService|parsePackage/);
  assert.match(parsingBackgroundSource, /parseVerifiedBackgroundBody/);
  assert.match(transformationSource, /claimScormImportJob/);
});
