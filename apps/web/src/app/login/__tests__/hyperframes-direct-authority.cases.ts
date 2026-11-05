// Contratos HTTP del corte original, sin depender de la ubicación de OpenSpec.
export const DIRECT_HTTP_CASES = [
  {
    "file": "src/app/api/production/hyperframes/assets/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/assets/sync/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/approve/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/draft/route.ts",
    "method": "POST",
    "legacyReason": true
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/final-video/route.ts",
    "method": "DELETE",
    "legacyReason": true
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/revisions/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/revisions/route.ts",
    "method": "PUT",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/revisions/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/[compositionId]/snapshot/route.ts",
    "method": "POST",
    "legacyReason": true
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/compositions/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/assets/[assetId]/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/branding/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/branding/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/detach-audio/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/document/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/document/route.ts",
    "method": "GET",
    "legacyReason": true
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/document/route.ts",
    "method": "PUT",
    "legacyReason": true
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/files/[...path]/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/files/[...path]/route.ts",
    "method": "PUT",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-extraction/plan/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/preview-metrics/route.ts",
    "method": "POST",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/preview/route.ts",
    "method": "GET",
    "legacyReason": false
  },
  {
    "file": "src/app/api/production/hyperframes/revisions/[revisionId]/preview/route.ts",
    "method": "GET",
    "legacyReason": false
  }
] as const;
