// Corte 1cbbf559: contratos de once métodos en diez raíces delegadas.
export const SHARED_ROUTE_CASES = [
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-preview/renew/route.ts",
    "method": "GET",
    "handler": "PREVIEW:RESOURCE_RENEWAL"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-preview/resources/route.ts",
    "method": "GET",
    "handler": "RESOURCE"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-preview/route.ts",
    "method": "GET",
    "handler": "PREVIEW:PAGE"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-reconstruction-resource-links/[operationId]/route.ts",
    "method": "GET",
    "handler": "RECONSTRUCTION:read"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-reconstruction-resource-links/[operationId]/route.ts",
    "method": "POST",
    "handler": "RECONSTRUCTION:link"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/html-reconstruction-resources/[assetId]/route.ts",
    "method": "GET",
    "handler": "RECONSTRUCTION:lookup"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-extraction/apply/route.ts",
    "method": "POST",
    "handler": "EXTRACTION:APPLY"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-extraction/receipt/route.ts",
    "method": "POST",
    "handler": "EXTRACTION:RECOVERY"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-fragment/apply/route.ts",
    "method": "POST",
    "handler": "FRAGMENT:APPLY"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-fragment/plan/route.ts",
    "method": "POST",
    "handler": "FRAGMENT_PLAN"
  },
  {
    "file": "src/app/api/production/hyperframes/drafts/[draftId]/narrative-fragment/receipt/route.ts",
    "method": "POST",
    "handler": "FRAGMENT:RECOVERY"
  }
] as const;
