import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  renderBatchRequestSchema,
  renderWorkerCapacitySchema,
} from "../render-batch.types";

describe("render batch contracts", () => {
  it("defaults worker capacity conservatively to one concurrent job", () => {
    const capacity = renderWorkerCapacitySchema.parse({});

    assert.equal(capacity.maxConcurrentJobs, 1);
    assert.equal(capacity.runningJobs, 0);
    assert.equal(capacity.source, "UNKNOWN");
  });

  it("rejects unsafe worker concurrency limits", () => {
    assert.throws(() => renderWorkerCapacitySchema.parse({ maxConcurrentJobs: 0 }));
    assert.throws(() => renderWorkerCapacitySchema.parse({ maxConcurrentJobs: 9 }));
  });

  it("accepts a batch request with global template and per-item overrides", () => {
    const request = renderBatchRequestSchema.parse({
      artifactId: "11111111-1111-4111-8111-111111111111",
      defaultTemplateId: "22222222-2222-4222-8222-222222222222",
      assignmentMode: "MIXED",
      items: [
        {
          componentId: "33333333-3333-4333-8333-333333333333",
          templateId: "44444444-4444-4444-8444-444444444444",
          preferredWorkerId: "55555555-5555-4555-8555-555555555555",
          variables: { componentTitle: "Leccion 1" },
        },
      ],
    });

    assert.equal(request.assignmentMode, "MIXED");
    assert.equal(request.items[0].templateId, "44444444-4444-4444-8444-444444444444");
    assert.equal(request.items[0].preferredWorkerId, "55555555-5555-4555-8555-555555555555");
  });

  it("keeps external custom-template preview wired to the desktop worker control plane", () => {
    const routePath = path.resolve(
      process.cwd(),
      "src/app/api/v1/production/remotion/external-preview/route.ts",
    );
    const requestRoutePath = path.resolve(
      process.cwd(),
      "src/app/api/v1/production/remotion/external-preview/request/route.ts",
    );
    const postproductionPath = path.resolve(
      process.cwd(),
      "src/domains/materials/components/PostproductionAssemblyContainer.tsx",
    );
    const externalPreviewPlayerPath = path.resolve(
      process.cwd(),
      "src/domains/materials/components/RemotionExternalPreviewPlayer.tsx",
    );
    const layoutOverridePreviewOverlayPath = path.resolve(
      process.cwd(),
      "src/domains/materials/components/LayoutOverridePreviewOverlay.tsx",
    );
    const productionActionsPath = path.resolve(
      process.cwd(),
      "src/domains/materials/actions/production.actions.ts",
    );
    const desktopWorkerControlPlanePath = path.resolve(
      process.cwd(),
      "src/lib/server/desktop-worker-control-plane.ts",
    );
    const externalPreviewHookPath = path.resolve(
      process.cwd(),
      "src/domains/materials/hooks/useExternalTemplatePreview.ts",
    );
    const templateActionsPath = path.resolve(
      process.cwd(),
      "src/domains/production/actions/templates.actions.ts",
    );
    const templatesContainerPath = path.resolve(
      process.cwd(),
      "src/app/admin/templates/TemplatesContainer.tsx",
    );

    assert.equal(fs.existsSync(routePath), true);
    assert.equal(fs.existsSync(requestRoutePath), true);
    assert.equal(fs.existsSync(externalPreviewHookPath), true);
    assert.match(fs.readFileSync(routePath, "utf8"), /getExternalTemplatePreviewData/);
    assert.match(fs.readFileSync(requestRoutePath, "utf8"), /requestExternalTemplatePreview/);
    const postproductionSource = fs.readFileSync(postproductionPath, "utf8");
    const externalPreviewPlayerSource = fs.readFileSync(externalPreviewPlayerPath, "utf8");
    const externalPreviewHookSource = fs.readFileSync(externalPreviewHookPath, "utf8");
    const layoutOverridePreviewOverlaySource = fs.readFileSync(layoutOverridePreviewOverlayPath, "utf8");
    const productionActionsSource = fs.readFileSync(productionActionsPath, "utf8");
    const desktopWorkerControlPlaneSource = fs.readFileSync(desktopWorkerControlPlanePath, "utf8");
    const templateActionsSource = fs.readFileSync(templateActionsPath, "utf8");
    const templatesContainerSource = fs.readFileSync(templatesContainerPath, "utf8");

    assert.match(
      postproductionSource,
      /const selectedTemplateUsesExternalPreview = selectedTemplateUsesCloudBundle;/,
    );
    assert.match(
      postproductionSource,
      /const selectedTemplateBlocksFinalRender = selectedTemplateUsesExternalBundle \|\| selectedTemplateNeedsCloudBuild;/,
    );
    assert.match(
      postproductionSource,
      /No se mostrara una composicion interna como reemplazo/,
    );
    assert.match(postproductionSource, /layoutOverrides: activeExternalPreviewLayoutOverrides/);
    assert.match(postproductionSource, /setExternalPreviewLayoutOverrideSnapshots/);
    assert.match(postproductionSource, /getLayoutOverrideDraftKey/);
    assert.match(postproductionSource, /activeLayoutDraftKey/);
    assert.match(postproductionSource, /hasLayoutOverridesToDiscard/);
    assert.match(postproductionSource, /saveRemotionLayoutOverridesAction\(\s*activePreview\.id,\s*activeLayoutOverrides,\s*\{\s*templateId: selectedTemplate/s);
    assert.match(layoutOverridePreviewOverlaySource, /snapBoxToGridReference/);
    assert.match(layoutOverridePreviewOverlaySource, /snapBoxToSmartGuides/);
    assert.match(layoutOverridePreviewOverlaySource, /clampNumber\(selectedBox\.x \* canvasScale\.x/);
    assert.doesNotMatch(layoutOverridePreviewOverlaySource, /width:\s*Math\.max\(gridSize,\s*snapValueToGrid\(box\.width/);
    assert.match(productionActionsSource, /scopedTemplateId/);
    assert.match(productionActionsSource, /existingLayoutOverrides\.filter\(\(manifest\) => !isSameLayoutScope\(manifest\)\)/);
    assert.match(desktopWorkerControlPlaneSource, /publishInternalBundle/);
    assert.match(desktopWorkerControlPlaneSource, /INTERNAL_COMPOSITION/);
    assert.match(desktopWorkerControlPlaneSource, /courseforge-internal-bundle\.json/);
    assert.match(desktopWorkerControlPlaneSource, /const bundleHash = sha256Buffer\(zipBuffer\)/);
    assert.match(desktopWorkerControlPlaneSource, /readNonEmptyString\(params\.build\.build_hash\)\s*\|\|\s*readNonEmptyString\(params\.build\.bundle_hash\)/);
    assert.match(desktopWorkerControlPlaneSource, /TEMPLATE_PREVIEW_PAYLOAD_PREPARE_FAILED/);
    assert.doesNotMatch(
      desktopWorkerControlPlaneSource,
      /claimedTemplatePreviews\.map\(\(preview: any\) => this\.buildClaimedTemplatePreviewPayload\(preview\)\)/,
    );
    assert.match(templateActionsSource, /serveUrl: string \| null;/);
    assert.match(templateActionsSource, /previewStatus: "READY" \| "MISSING" \| "QUEUED" \| "RUNNING" \| "FAILED" \| "STALE";/);
    assert.match(templateActionsSource, /requestExternalBundlePreviewRenderAction/);
    assert.match(externalPreviewPlayerSource, /useExternalTemplatePreview/);
    assert.match(externalPreviewPlayerSource, /Mostrando el ultimo preview mientras se genera la version actualizada/);
    assert.match(externalPreviewHookSource, /shouldAutoRequestPreview/);
    assert.match(externalPreviewHookSource, /POLL_INTERVAL_MS/);
    assert.match(
      templateActionsSource,
      /requiere build con worker para usar la plantilla custom/,
    );
    assert.match(templateActionsSource, /requireTemplateReviewerPermission\("construir"\)/);
    assert.match(templatesContainerSource, /cloudBuildHasUsableArtifact/);
    assert.match(templatesContainerSource, /Build sin artefacto renderizable/);
  });

  it("keeps quick custom-template previews idempotent and stale-safe", () => {
    const controlPlanePath = path.resolve(
      process.cwd(),
      "src/lib/server/desktop-worker-control-plane.ts",
    );
    const previewCacheMigrationPath = path.resolve(
      process.cwd(),
      "../../supabase/migrations/20260720133000_add_template_preview_cache_key.sql",
    );
    const previewPosterMimeMigrationPath = path.resolve(
      process.cwd(),
      "../../supabase/migrations/20260720134500_allow_preview_poster_mime_types.sql",
    );

    const controlPlaneSource = fs.readFileSync(controlPlanePath, "utf8");
    const previewCacheMigrationSource = fs.readFileSync(previewCacheMigrationPath, "utf8");
    const previewPosterMimeMigrationSource = fs.readFileSync(previewPosterMimeMigrationPath, "utf8");

    assert.match(controlPlaneSource, /buildTemplatePreviewCacheKey/);
    assert.match(controlPlaneSource, /latestSuccessfulPreview/);
    assert.match(controlPlaneSource, /preview_cache_key/);
    assert.match(controlPlaneSource, /template_preview_requeued/);
    assert.match(previewCacheMigrationSource, /preview_cache_key text/);
    assert.match(previewCacheMigrationSource, /UNIQUE INDEX IF NOT EXISTS idx_remotion_template_previews_cache_key/);
    assert.match(previewPosterMimeMigrationSource, /production-videos/);
    assert.match(previewPosterMimeMigrationSource, /image\/png/);
  });
});
