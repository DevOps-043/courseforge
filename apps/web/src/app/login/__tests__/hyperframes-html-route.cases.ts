// Contratos de composición del corte e22013bd; no dependen de OpenSpec.
export const HTML_ROUTE_CASES = [
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/generated-deck-initialization/current/route.ts",
    "method": "GET",
    "factory": "createGeneratedDeckCurrentHandler",
    "module": "@/domains/production/composition-editor/http/composition-generated-deck-current-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/generated-deck-initialization/route.ts",
    "method": "GET",
    "factory": "createGeneratedDeckInitializationHandler",
    "module": "@/domains/production/composition-editor/http/composition-generated-deck-initialization-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/generated-deck-initialization/route.ts",
    "method": "POST",
    "factory": "createGeneratedDeckInitializationHandler",
    "module": "@/domains/production/composition-editor/http/composition-generated-deck-initialization-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing-initial-anchor/route.ts",
    "method": "GET",
    "factory": "createHtmlInitialAnchorHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-initial-anchor-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing-initial-anchor/route.ts",
    "method": "POST",
    "factory": "createHtmlInitialAnchorHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-initial-anchor-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/adopt/candidates/[candidateId]/route.ts",
    "method": "GET",
    "factory": "createHtmlLegacyReviewHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-legacy-review-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/adopt/operations/[operationId]/route.ts",
    "method": "POST",
    "factory": "createHtmlLegacyAdoptionHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-legacy-adoption-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/adopt/operations/[operationId]/route.ts",
    "method": "GET",
    "factory": "createHtmlLegacyAdoptionHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-legacy-adoption-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/initialize/operations/[operationId]/route.ts",
    "method": "POST",
    "factory": "createHtmlEditingInitializationOperationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-initialization-operation-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/initialize/operations/[operationId]/route.ts",
    "method": "GET",
    "factory": "createHtmlEditingInitializationOperationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-initialization-operation-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/initialize/route.ts",
    "method": "POST",
    "factory": "createHtmlEditingInitializationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-initialization-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/operations/[operationId]/route.ts",
    "method": "GET",
    "factory": "createHtmlEditingOperationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-operation-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/operations/[operationId]/route.ts",
    "method": "POST",
    "factory": "createHtmlEditingOperationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-operation-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/route.ts",
    "method": "GET",
    "factory": "createHtmlEditingInspectorHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-inspector-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/route.ts",
    "method": "POST",
    "factory": "createHtmlEditingMutationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-mutation-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/templates/route.ts",
    "method": "GET",
    "factory": "createHtmlTemplateChoicesHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-template-choices-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-historical-candidates/[candidateId]/route.ts",
    "method": "GET",
    "factory": "createHtmlHistoricalCandidateHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-historical-candidate-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-historical-publications/[operationId]/route.ts",
    "method": "POST",
    "factory": "createHtmlHistoricalPublicationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-historical-publication-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-historical-publications/[operationId]/route.ts",
    "method": "GET",
    "factory": "createHtmlHistoricalPublicationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-historical-publication-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-legacy-inventory/route.ts",
    "method": "GET",
    "factory": "createHtmlLegacyInventoryHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-legacy-inventory-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-reconstruction-library/route.ts",
    "method": "GET",
    "factory": "createHtmlReconstructionLibraryHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-library-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-reconstruction-opening/route.ts",
    "method": "GET",
    "factory": "createHtmlReconstructionOpeningHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-reconstruction-opening-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-snapshot-history/[revisionId]/inspection/route.ts",
    "method": "GET",
    "factory": "createHtmlSnapshotInspectionHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-snapshot-inspection-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-snapshot-history/[revisionId]/review/route.ts",
    "method": "GET",
    "factory": "createHtmlSnapshotRepublicationReviewHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-snapshot-republication-review-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-snapshot-history/route.ts",
    "method": "GET",
    "factory": "createHtmlSnapshotHistoryHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-editing-snapshot-history-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-snapshots/[operationId]/route.ts",
    "method": "GET",
    "factory": "createHtmlSnapshotRecoveryHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-snapshot-recovery-handler.server"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-snapshots/route.ts",
    "method": "POST",
    "factory": "createHtmlSnapshotPublicationHandler",
    "module": "@/domains/production/composition-editor/http/composition-html-snapshot-publication-handler.server"
  }
] as const;
