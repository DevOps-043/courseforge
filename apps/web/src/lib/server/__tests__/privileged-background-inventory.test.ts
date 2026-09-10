import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

test("privileged Netlify handlers verify the internal signed envelope", () => {
  const functionsDir = join(process.cwd(), "netlify", "functions");
  const unguarded = readdirSync(functionsDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const source = readFileSync(join(functionsDir, name), "utf8");
      const isPrivileged =
        source.includes("createServiceRoleClient") ||
        source.includes("getSupabaseServiceKey");
      return isPrivileged && !source.includes("parseVerifiedBackgroundBody");
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

  assert.match(oneDriveSource, /fetchWithDeadline/);
  assert.match(oneDriveSource, /readResponseWithLimit\(contentResponse, MAX_ONEDRIVE_IMPORT_BYTES\)/);
  assert.match(googleDriveSource, /fetchWithDeadline/);
  assert.match(googleDriveSource, /readResponseWithLimit\(response, maxBytes\)/);
  assert.match(artlistSource, /fetchWithDeadline/);
  assert.match(artlistSource, /readResponseWithLimit\(response, MAX_ARTLIST_IMPORT_BYTES\)/);
  assert.match(googleOAuthSource, /fetchWithDeadline/);
  assert.match(microsoftOAuthSource, /fetchWithDeadline/);
  assert.doesNotMatch(googleOAuthSource, /message:\s*err(?:or)?\??\.?message/);
  assert.doesNotMatch(microsoftOAuthSource, /message:\s*err(?:or)?\??\.?message/);
  assert.match(materialsRuntimeSource, /signal: AbortSignal\.timeout\(triggerTimeoutMilliseconds\)/);
  assert.match(materialsRuntimeSource, /if \(!response\.ok\)/);
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

test("SCORM transformation stays outside the request and behind a signed background boundary", () => {
  const webRoot = resolve(process.cwd());
  const routeSource = readFileSync(
    join(webRoot, "src", "app", "api", "admin", "scorm", "process", "route.ts"),
    "utf8",
  );
  const backgroundSource = readFileSync(
    join(webRoot, "netlify", "functions", "scorm-transformation-background.ts"),
    "utf8",
  );
  const transformationSource = readFileSync(
    join(webRoot, "src", "domains", "scorm", "services", "scorm-transformation.service.ts"),
    "utf8",
  );

  assert.match(routeSource, /dispatchBackgroundFunctionJson/);
  assert.doesNotMatch(routeSource, /ScormTransformationService/);
  assert.match(backgroundSource, /parseVerifiedBackgroundBody/);
  assert.match(
    transformationSource,
    /\.eq\('processing_step', SCORM_PROCESSING_STEP\.queued\)/,
  );
});
