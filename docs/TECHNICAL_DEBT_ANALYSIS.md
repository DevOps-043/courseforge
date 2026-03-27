# Technical Debt Analysis - CourseForge

**Original analysis date**: 2026-03-24
**Last verified against live code**: 2026-03-27
**Revision**: 12 (verified with on-disk `wc -l`, `rg` searches, `tsc --noEmit`)

---

## 1. Executive Summary

### Verified debt estimate: ~3-5%

CourseForge has undergone major structural cleanup. The codebase is typed, modular, and free of the worst categories of debt (god files, spaghetti, `any` abuse, raw `process.env` scatter).

Current verified state:

- **Zero executable `any`** in `apps/web/src` and `apps/web/netlify/functions`
- **Zero `@ts-ignore` / `@ts-expect-error`**
- **Zero `select('*')`** in runtime paths
- **Zero hardcoded timeout literals** in active code
- **Zero direct `process.env` reads** outside centralized config layers
- **Dead packages removed** (`packages/shared/`, `packages/ui/` no longer exist)

What keeps the estimate at 3-5% rather than lower:

- **28 files in `apps/web/src`** exceed 300 lines (1 exceeds 400)
- **12 files in `apps/web/netlify/functions`** exceed 200 lines
- **5 residual `error instanceof Error`** checks outside shared helpers
- **43 direct `toast.error` calls** without a centralized UI error wrapper
- No end-to-end test coverage for pipeline happy paths

---

## 2. Verified Current Metrics

### 2.1 Type-safety and runtime cleanliness

| Metric | Verified value |
|--------|---------------:|
| Executable `any` in `apps/web/src` | **0** |
| Executable `any` in `apps/web/netlify/functions` | **0** |
| `@ts-ignore` / `@ts-expect-error` | **0** |
| Wildcard runtime selects (`select('*')`) | **0** |
| Hardcoded timeout literals | **0** |
| `error instanceof Error` outside shared helpers | **5** |

Shared error boundaries:

- `apps/web/src/lib/errors.ts` (14 lines) - `getErrorMessage()`, `getErrorDetails()`
- `apps/web/netlify/functions/shared/errors.ts` (6 lines) - `getErrorMessage()`

Shared timeout constants:

- `apps/web/src/shared/constants/timing.ts` (10 lines) - 10 named constants
- `apps/web/netlify/functions/shared/timing.ts` (4 lines) - 4 named constants

### 2.2 Direct `process.env` access

Isolated to centralized config layers only:

| File | Lines | Purpose |
|------|------:|---------|
| `apps/web/src/lib/server/env.ts` | 172 | Zod-validated Next/web server env |
| `apps/web/netlify/functions/shared/bootstrap.ts` | 104 | Netlify runtime env via `getRequiredEnv()`/`getOptionalEnv()` |

**0 operational/feature files** access `process.env` directly.

### 2.3 Error handling patterns

Error handling uses three coexisting patterns, documented as an intentional layered convention:

| Pattern | Instances | Location |
|---------|----------:|----------|
| `{ success: false, error }` returns | ~87 | Server actions |
| `toast.error(...)` calls | ~43 | UI components |
| `getErrorMessage()` helper usage | ~34 | Actions and components |
| Direct `error instanceof Error` | 5 | Residual (outside helpers) |

The three-layer approach (server actions return objects, routes serialize JSON, UI shows toasts) is intentional boundary separation, not inconsistency. The 5 remaining direct `instanceof` checks are minor residual debt.

### 2.4 File size (verified with `wc -l`)

**Files over 400 lines in `apps/web/src`: 1**

| File | Lines | Notes |
|------|------:|-------|
| `shared/config/prompts/materials-generation.prompts.ts` | **585** | Prompt text only, not executable logic |

**Files over 300 lines in `apps/web/src`: 28**

Top 10 largest active runtime files:

| File | Lines |
|------|------:|
| `domains/materials/components/ComponentContentRenderer.tsx` | **394** |
| `app/admin/artifacts/[id]/publish/PublicationClientView.tsx` | **382** |
| `app/admin/artifacts/new/page.tsx` | **381** |
| `app/admin/users/UserModal.tsx` | **379** |
| `app/admin/artifacts/[id]/ArtifactBaseStage.tsx` | **378** |
| `domains/materials/actions/production.actions.ts` | **377** |
| `domains/plan/components/InstructionalPlanLessonCard.tsx` | **367** |
| `domains/plan/components/InstructionalPlanGenerationContainer.tsx` | **366** |
| `domains/materials/actions/materials.actions.ts` | **365** |
| `domains/materials/types/materials.types.ts` | **363** |

**Netlify functions over 200 lines: 12**

| File | Lines |
|------|------:|
| `instructional-plan-background.ts` | **375** |
| `shared/unified-curation-helpers.ts` | **345** |
| `unified-curation-logic.ts` | **329** |
| `validate-materials-background.ts` | **325** |
| `materials-generation-background.ts` | **304** |
| `syllabus-generation-background.ts` | **284** |
| `shared/materials-generation-helpers.ts` | **282** |
| `generate-artifact-background.ts` | **252** |
| `shared/unified-curation-batch.ts` | **250** |
| `auth-sync.ts` | **230** |
| `shared/materials-generation-runtime.ts` | **218** |
| `validate-plan-background.ts` | **207** |

Total codebase size:

- `apps/web/src`: ~32,207 lines across 232 TypeScript files
- `apps/web/netlify/functions`: ~4,166 lines

### 2.5 Domain structure

Standardized as **capability-based** (documented in `apps/web/src/domains/README.md`):

Supported folders: `actions/`, `components/`, `config/`, `hooks/`, `lib/`, `services/`, `types/`, `validators/`

Rules:
1. Use the same folder names everywhere.
2. Add only the folders the domain actually needs.
3. Do not create empty placeholder folders.
4. Keep business rules out of route handlers and view components.

### 2.6 Dead code status

| Item | Status |
|------|--------|
| `packages/shared/` | **Removed** (no longer exists) |
| `packages/ui/` | **Removed** (no longer exists) |

---

## 3. Improvements Across Revisions

### 3.1 Structural cleanup (revisions 1-11)

Major file decompositions completed:

| File | Before | After | Reduction |
|------|-------:|------:|----------:|
| `SourcesCurationGenerationContainer.tsx` | 1,375 | 235 | -83% |
| `InstructionalPlanGenerationContainer.tsx` | 1,251 | 366 | -71% |
| `api/lia/route.ts` | 720 | 147 | -80% |
| `ProductionAssetCard.tsx` | 696 | 198 | -72% |
| `unified-curation-logic.ts` | 823 | 329 | -60% |
| `publication-payload.ts` | 450 | 124 | -72% |
| `materials.actions.ts` | 564 | 365 | -35% |

### 3.2 Error handling centralized

- Shared `getErrorMessage()` helpers created for both web and netlify
- Inline `error instanceof Error ? error.message` reduced to 5 residual instances
- Three-layer error convention documented as intentional

### 3.3 Timeout debt eliminated

All hardcoded timeout literals replaced with named constants:

- `API_ABORT_TIMEOUT_MS`, `COPY_FEEDBACK_RESET_DELAY_MS`, `STATUS_MESSAGE_DISMISS_DELAY_MS`
- `PRODUCTION_COMPLETION_RECHECK_DELAY_MS`, `SCORM_REVIEW_STEP_DELAY_MS`
- `SCORM_UPLOAD_PROGRESS_TICK_MS`, `CURATION_REDIRECT_RESOLUTION_TIMEOUT_MS`
- `CURATION_CONTENT_VALIDATION_TIMEOUT_MS`, `CURATION_MODEL_COOLDOWN_DELAY_MS`
- `MATERIALS_RETRY_BACKOFF_BASE_MS`

### 3.4 Configuration access centralized

- Web server: `src/lib/server/env.ts` (Zod-validated)
- Netlify: `netlify/functions/shared/bootstrap.ts`
- Zero `process.env` in operational code

### 3.5 Shared netlify utilities

`netlify/functions/shared/` directory adopted by all background functions:

- `bootstrap.ts` - env, Supabase client, Gemini client
- `errors.ts` - error message extraction
- `timing.ts` - timeout constants
- `http.ts` - HTTP utilities
- `curation-prompts.ts`, `curation-runtime.ts` - curation helpers
- `materials-generation-helpers.ts`, `materials-generation-runtime.ts` - materials helpers
- `unified-curation-batch.ts`, `unified-curation-helpers.ts`, `unified-curation-types.ts` - curation batch processing

---

## 4. Remaining Active Debt

### Estimated remaining debt: ~3-5%

No god files, no spaghetti, no cross-phase fragility remain. Residual debt is operational maturity:

1. **5 residual `error instanceof Error` checks** outside shared helpers - minor cleanup.
2. **43 direct `toast.error` calls** - could benefit from a centralized UI error display utility.
3. **28 files over 300 lines** in `apps/web/src` - none are god files, but some could be split for readability.
4. **No end-to-end test coverage** for pipeline happy paths and recovery paths.
5. **No query-plan review** or production index validation under real traffic.
6. **No tracing/observability** around background jobs and long-running phase transitions.

Items 1-3 are minor code hygiene. Items 4-6 are operational maturity improvements.

---

## 5. Debt Trajectory

| Revision | Date | Estimate | Key changes |
|----------|------|----------|-------------|
| 1 | 2026-03-24 | ~42% | Initial analysis - god files, spaghetti, raw env |
| 2-4 | 2026-03-24 | ~35% | First decompositions, shared utilities |
| 5-7 | 2026-03-25 | ~28% | Major file splits, domain restructure |
| 8-10 | 2026-03-26 | ~8-10% | Error/timeout centralization, env isolation |
| 11 | 2026-03-27 | ~3-5% | Dead packages removed, all metrics at zero |
| 12 | 2026-03-27 | ~3-5% | Verified with corrected line counts |

---

## 6. Conclusion

CourseForge is in a professional, maintainable state:

- Typed (zero `any`, zero suppressions)
- Modular (capability-based domains, no god files)
- Config-centralized (Zod-validated env, zero operational `process.env`)
- Timeout-centralized (14 named constants, zero hardcoded literals)
- Error-handling standardized by boundary layer
- Free of wildcard data reads in runtime paths
- Dead packages cleaned up

**Current verified estimate: ~3-5%**

The next gains come from testing, observability, and production profiling rather than structural cleanup.
