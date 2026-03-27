# Technical Debt Analysis - CourseForge

**Original analysis date**: 2026-03-24
**Last verified against live code**: 2026-03-27 (9th independently verified revision)
**Scope**: `apps/web/src`, `apps/web/netlify/functions`, all pipeline domains, Lia, SCORM, publication, production, shared server/runtime helpers.

All line counts verified by reading files on disk and running searches across the codebase.

---

## 1. Executive Summary

### Verified debt estimate: ~3-5%

### The extraordinary claims ARE real this time

After thorough verification:

- **ZERO executable `any`** in apps/web/src/ - **CONFIRMED** (was 270+ at start, 185 last revision)
- **ZERO executable `any`** in apps/web/netlify/functions/ - **CONFIRMED** (was 48 last revision)
- **ZERO `@ts-ignore` or `@ts-expect-error`** anywhere - **CONFIRMED**
- **ZERO `select('*')`** in app/domains/netlify - **CONFIRMED**
- **ZERO files >400 lines (logic)** in src/ - **CONFIRMED** (only materials-generation.prompts.ts at 585, which is prompt text)
- **ALL Netlify functions under 400 lines** - **CONFIRMED**
- `noUnusedLocals` + `noUnusedParameters` in tsconfig - **CONFIRMED**
- `ConstructorLayoutClient.tsx` removed - **CONFIRMED**
- All claimed new type contract files exist - **CONFIRMED**

### Why ~3-5% and not ~1-2% as Codex claims

The **~1-2%** claim ignores remaining structural patterns that are real debt:
- **3 error handling patterns** still coexist (164 total instances)
- **9 files** still use direct `process.env` (~18 instances)
- **6 hardcoded timeouts** remain in components
- **Line counts** in the report are consistently understated (see corrections below)
- Domain structure is still not standardized (8 domains, all different shapes)

---

## 2. Verified Current Metrics

### 2.1 `any` status

| Scope | Count |
|-------|------:|
| Executable `any` in `apps/web/src` | **0** |
| Executable `any` in `apps/web/netlify/functions` | **0** |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| Textual matches (comments/strings only) | **3** |
| **Total executable `any`** | **0** |

Previous trajectory: 270+ → 319 → 284 → 336 → 239 → 185 → **0**

This is an extraordinary achievement for a project this size (~210 source files, ~32,000 lines).

### 2.2 Files >400 lines in `apps/web/src` (verified)

**1 file** (prompt text, not logic):

| File | Verified lines | Codex claimed | Notes |
|------|---------------:|:-------------:|-------|
| `shared/config/prompts/materials-generation.prompts.ts` | **585** | 475 | Prompt text, not executable |

Codex understated this by 110 lines. The file has been 585 lines since the beginning and was never reduced.

### 2.3 Largest remaining src files (verified, corrected)

| File | Verified lines | Codex claimed | Delta |
|------|---------------:|--------------:|------:|
| `ComponentContentRenderer.tsx` | **394** | 369 | +25 |
| `PublicationClientView.tsx` | **381** | 350 | +31 |
| `UserModal.tsx` | **379** | 354 | +25 |
| `ArtifactBaseStage.tsx` | **378** | 364 | +14 |
| `materials.actions.ts` | **372** | - | Was 461 |
| `InstructionalPlanLessonCard.tsx` | **367** | 344 | +23 |
| `InstructionalPlanGenerationContainer.tsx` | **366** | - | Was 489 |
| `CurationSetupView.tsx` | **363** | 339 | +24 |
| `SyllabusModuleCard.tsx` | **360** | 354 | +6 |

All under 400. Codex consistently understated sizes by 6-31 lines per file.

### 2.4 Largest Netlify function files (verified, corrected)

| File | Verified lines | Codex claimed | Delta |
|------|---------------:|--------------:|------:|
| `instructional-plan-background.ts` | **374** | 318 | +56 |
| `shared/unified-curation-helpers.ts` | **345** | 302 | +43 |
| `unified-curation-logic.ts` | **328** | 290 | +38 |
| `validate-materials-background.ts` | **328** | - | Was 286 |
| `materials-generation-background.ts` | **304** | 264 | +40 |
| `syllabus-generation-background.ts` | **287** | - | Unchanged |
| `shared/materials-generation-helpers.ts` | **280** | 248 | +32 |
| `shared/unified-curation-batch.ts` | **250** | - | NEW |
| `generate-artifact-background.ts` | **251** | - | Was 233 |
| `auth-sync.ts` | **233** | - | Unchanged |
| `shared/materials-generation-runtime.ts` | **226** | - | NEW |
| `validate-plan-background.ts` | **205** | - | Unchanged |
| `video-prompts-generation.ts` | **146** | - | Unchanged |
| `shared/curation-prompts.ts` | **140** | - | Unchanged |
| `shared/curation-runtime.ts` | **112** | - | Unchanged |
| `shared/unified-curation-types.ts` | **67** | - | NEW |
| `curation-background.ts` | **62** | - | Was 57 |
| `shared/bootstrap.ts` | **60** | - | Unchanged |
| `shared/http.ts` | **29** | - | Unchanged |

**ALL under 400 lines - CONFIRMED.** Codex understated sizes by 32-56 lines per file where claimed.

### 2.5 Previously massive files - final verified status

| File | Original (1st rev) | Last rev | **Now** | Total reduction |
|------|-------------------:|---------:|--------:|----------------:|
| SourcesCurationGenerationContainer.tsx | 1,375 | 235 | **235** | **-83%** |
| InstructionalPlanGenerationContainer.tsx | 1,251 | 366 | **366** | **-71%** |
| api/lia/route.ts | 720 | 147 | **147** | **-80%** |
| ProductionAssetCard.tsx | 696 | 198 | **198** | **-72%** |
| ArtifactClientView.tsx | 554 | 343 | **343** | **-38%** |
| unified-curation-logic.ts | 823 | 591 | **328** | **-60%** |
| materials-generation-background.ts | 469 | 422 | **304** | **-35%** |
| publication-payload.ts | 450 | 450 | **124** | **-72%** |
| materials.actions.ts | 564 | 461 | **372** | **-34%** |
| curation.actions.ts | 605 | 328 | **328** | **-46%** |

### 2.6 Validation status (verified)

- `noUnusedLocals: true` in tsconfig.json - **confirmed**
- `noUnusedParameters: true` in tsconfig.json - **confirmed**
- `select('*')` in app/domains/netlify - **0 occurrences confirmed**

---

## 3. Verified Improvements This Revision

### 3.1 Type safety: zero executable `any` achieved

The most significant improvement. Every `any` in the codebase has been replaced with proper types:
- SCORM services now use `ScormManifest` / `ScormItem` contracts
- User management uses `UserProfile` / `UserFormData` typed shapes
- Artifact detail uses typed `ArtifactViewState` / `StageProps` contracts
- Admin library actions use typed row shapes and query helpers
- Layout components use shared `SidebarProfileData` contract
- All remaining background functions fully typed

### 3.2 Key file reductions verified

- **unified-curation-logic.ts**: 591 → **328** (-263 lines). Split into `unified-curation-helpers.ts` (345), `unified-curation-batch.ts` (250), `unified-curation-types.ts` (67)
- **materials-generation-background.ts**: 422 → **304** (-118 lines). Uses `materials-generation-runtime.ts` (226) and `materials-generation-helpers.ts` (280)
- **publication-payload.ts**: 450 → **124** (-326 lines, 72% reduction). Split into typed payload builders
- **ProductionAssetCard.tsx**: 429 → **198** (-231 lines, 54% reduction). Split into `ProductionAssetGammaSection.tsx` (213) and `ProductionAssetVideoSections.tsx` (238)
- **materials.actions.ts**: 461 → **372** (-89 lines, 19% reduction)

### 3.3 Type contracts created (all verified to exist)

- `components/layout/layout.types.ts` - shared sidebar/profile contract
- `app/admin/artifacts/[id]/artifact-view.types.ts` - artifact stage contract
- `app/admin/users/user-management.types.ts` - user management contract
- `shared/unified-curation-types.ts` - curation runtime types

### 3.4 Dead code removed

- `builder/ConstructorLayoutClient.tsx` - orphan layout shell removed (confirmed absent)

---

## 4. Remaining Active Debt

### 4.1 Error handling - 3 patterns still coexist

| Pattern | Count | Files |
|---------|------:|------:|
| `return { success: false, error }` | **70** | 8 |
| `throw new Error()` | **51** | 21 |
| `toast.error()` | **43** | 13 |
| **Total** | **164** | - |

No unification effort has been made across all revisions. This is the single most persistent debt pattern.

### 4.2 Direct process.env access

**9 files** still use direct `process.env` (~18 instances):
- `lib/server/env.ts` (7 - this is the centralized config, expected)
- `app/api/lia/route.ts`
- `app/api/debug/soflia/route.ts`
- `app/api/auth/switch-organization/route.ts`
- `utils/supabase/client.ts`
- `utils/supabase/server.ts`
- `utils/auth/session.ts`
- `domains/scorm/services/scorm-enrichment.service.ts`
- `lib/server/background-function-client.ts`

Note: `auth-bridge.ts` **now properly imports from `@/lib/server/env`** instead of direct process.env (verified).

### 4.3 Hardcoded timeouts (6 instances)

| File | Value | Purpose |
|------|------:|---------|
| `MaterialResultCard.tsx` | 2000ms | Copy feedback |
| `debug/soflia/route.ts` | 5000ms | API abort |
| `useCurationControls.tsx` | 3000ms | Clipboard feedback |
| `VisualProductionContainer.tsx` | 1500ms | Completion check |
| `useProductionAssetState.ts` | 2000ms | Copy feedback |
| `SystemPromptsManager.tsx` | 3000ms | Message dismissal |

Minor - all are UI feedback timers.

### 4.4 Domain structure (still inconsistent)

| Domain | actions | components | hooks | lib | services | types | validators |
|--------|:-------:|:----------:|:-----:|:---:|:--------:|:-----:|:----------:|
| artifacts | YES | - | - | - | - | - | - |
| curation | YES | YES | YES | YES | - | YES | - |
| materials | YES | YES | YES | YES | YES | YES | YES |
| plan | YES | YES | YES | - | - | - | - |
| publication | - | - | - | YES | - | YES | - |
| prompts | - | YES | - | - | - | - | - |
| scorm | - | - | - | - | YES | - | - |
| syllabus | - | YES | - | YES | YES | YES | YES |

### 4.5 Line count accuracy note

Codex consistently understates file sizes by 6-56 lines per file. While all files ARE under their respective thresholds (400 for src, 400 for netlify), the exact numbers in Codex's reports should not be trusted as precise measurements.

---

## 5. Complete Revision Trajectory

| Revision | Estimate | Key change | Verified? |
|----------|----------|------------|:---------:|
| 1st (03-24) | ~42% | Initial analysis: dead code, god files, no abstractions | YES |
| 2nd (03-26) | ~35-38% | Dead code removed | YES |
| 3rd (03-26) | ~28-30% | God files split, usePolling, helpers | YES |
| 4th (03-27) | ~24-26% | Netlify shared/, workspace cleanup | YES |
| 5th (03-27) | ~18-20% | Publication domain, syllabus split, env.ts | YES |
| 6th (03-27) | ~13-15% | Auth bridge, materials UI/background split | YES |
| 7th-10th (03-27) | ~8% → ~4% | Incremental: curation/materials runtime, Lia/SCORM typing, artifact/library cleanup | Partially |
| **11th (03-27, current)** | **~3-5%** | Zero `any`, zero select('*'), unified-curation split, publication-payload split, ProductionAssetCard split | **YES** |

### Cumulative reduction: ~37-39 percentage points

---

## 6. Before and After

| Metric | Start (42%) | **Now (~3-5%)** |
|--------|:-----------:|:---------------:|
| God files >500 lines (src/) | 5 | **0** |
| Files >400 lines (src/, logic) | 12+ | **0** |
| Executable `any` types | 270+ | **0** |
| `select('*')` in runtime | Present | **0** |
| Largest src file (logic) | 1,375 | **394** |
| Largest Netlify function | 823 | **374** |
| Shared abstractions | 0 | usePolling, env.ts, pipeline-constants, video-platform, netlify shared/ (9 files) |
| Type contracts | 0 | layout.types, artifact-view.types, user-management.types, curation-types, publication.types |
| tsconfig strict flags | None | `noUnusedLocals` + `noUnusedParameters` |
| Phantom packages | Present | Deleted |
| Empty legacy dirs | 2+ | **0** |
| Error handling patterns | 3 | **3** (unchanged) |

---

## 7. Recommended Next Paydown Order

### Priority 1: The one structural debt remaining

1. **Standardize error handling** - 164 instances across 3 patterns. This is the last real structural inconsistency.

### Priority 2: Operational maturity

2. Add E2E coverage for pipeline phases and SCORM/publication happy paths
3. Review production query plans and add DB indexes where traffic proves needed
4. Add tracing/observability around background jobs

### Priority 3: Polish

5. Migrate remaining 8 files off direct `process.env` to env.ts getters
6. Extract 6 hardcoded timeouts to named constants
7. Opportunistic file splitting when readability demands it

---

## 8. Conclusion

CourseForge has gone from **~42% technical debt to ~3-5%** across 11 revisions. This is a **~37-39 point reduction**.

The structural crisis is fully resolved:
- **Zero executable `any`** across the entire web workspace
- **Zero god files** - largest logic file is 394 lines
- **Zero wildcard Supabase selects** in runtime paths
- **All Netlify functions under 400 lines** (largest was 823)
- **Strict TypeScript flags enforced** permanently

The remaining ~3-5% is:
- 3 error handling patterns (164 instances) - the only remaining structural inconsistency
- 9 files with direct process.env (mostly in expected locations)
- 6 hardcoded UI timeouts (trivial)
- Domain structure variation (functional, not blocking)

**The system has moved from debt-remediation to operational maturity.**

**Current verified estimate: ~3-5%**
