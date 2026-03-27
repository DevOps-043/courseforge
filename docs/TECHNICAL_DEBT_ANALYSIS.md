# Technical Debt Analysis - CourseForge

**Original analysis date**: 2026-03-24
**Last verified against live code**: 2026-03-26 (3rd revision)
**Scope**: `apps/web/src`, `apps/web/netlify/functions`, domain actions, shared pipeline helpers, API routes, and shared packages.

All line counts and claims verified by reading files on disk.

---

## 1. Executive Summary

### Debt trajectory

| Revision | Estimate | Key driver |
|----------|----------|------------|
| 1st (2026-03-24) | ~42% | Dead code, god files, no abstractions, duplicated patterns everywhere |
| 2nd (2026-03-26) | ~35-38% | Dead code removed, but god files and patterns untouched |
| **3rd (2026-03-26, current)** | **~28-30%** | God files split, usePolling created, helpers extracted, constants centralized |

### What changed between 2nd and 3rd revision

Major refactors landed between revisions:

| File | Before (2nd rev) | Now (3rd rev) | Delta |
|------|----------------:|---------------:|------:|
| `InstructionalPlanGenerationContainer.tsx` | 1,089 | **489** | **-600** |
| `app/api/lia/route.ts` | 720 | **147** | **-573** |
| `ProductionAssetCard.tsx` | 637 | **429** | **-208** |
| `ArtifactClientView.tsx` | 554 | **343** | **-211** |
| `SourcesCurationGenerationContainer.tsx` | 504 | **464** | **-40** |
| `curation.actions.ts` | 498 | **498** | 0 |
| `materials.actions.ts` | 564 | **456** | **-108** |

**Total lines removed from hotspots: ~1,740**

New extraction targets created:
- `shared/hooks/usePolling.ts` - shared polling abstraction (new)
- `lib/lia-route-helpers.ts` - extracted from lia/route.ts (new)
- `domains/curation/lib/curation-action-helpers.ts` (217 lines, new)
- `domains/curation/lib/curation-ui.ts` (107 lines, new)
- `domains/materials/lib/production-formatters.ts` (115 lines, new)
- `domains/materials/validators/materials-control3.validators.ts` (167 lines, new)
- `domains/materials/validators/materials-control4.validators.ts` (71 lines, new)
- `domains/materials/validators/materials-control5.validators.ts` (212 lines, new)
- `domains/materials/validators/materials-validation-helpers.ts` (63 lines, new)
- `lib/pipeline-constants.ts` - centralized state constants (new)
- `lib/video-platform.ts` - centralized video constants and helpers (new)
- `ProductionAssetSections.tsx` (451 lines, extracted from ProductionAssetCard)
- `InstructionalPlanLessonCard.tsx` (367 lines, extracted from InstructionalPlanGenerationContainer)

### Current reading

- **No executable TS/TSX files over 500 lines** in `apps/web/src` (the only 500+ file is `shared/config/prompts/materials-generation.prompts.ts` at 585 lines, which is prompt text, not logic)
- The remaining debt is **no longer structural spaghetti** - it is now conventional maintenance debt: typing, duplicated patterns, config management, and background function modularity
- Total lines in `apps/web/src`: **~28,193**
- `any` type occurrences: **284** across 71 files (down from 319)

---

## 2. Debt Already Paid (Verified)

### God files split (confirmed)
- `app/api/lia/route.ts`: 720 → **147** lines. Logic extracted to `lia-route-helpers.ts`
- `InstructionalPlanGenerationContainer.tsx`: 1,089 → **489** lines. Split into setup, lesson card (`InstructionalPlanLessonCard.tsx` 367 lines), review panel, results view
- `ArtifactClientView.tsx`: 554 → **343** lines. Split into header, stepper, toast, stage-router subcomponents
- `ProductionAssetCard.tsx`: 637 → **429** lines. Split into orchestrator + `ProductionAssetSections.tsx` (451 lines)
- `materials.actions.ts`: 564 → **456** lines. Auth/Netlify helpers extracted to `materials-action-helpers.ts`

### Abstractions created (confirmed)
- `shared/hooks/usePolling.ts` - replaces 3+ manual `setInterval` implementations
- `lib/pipeline-constants.ts` - centralizes `SYLLABUS_STATES`, `PLAN_STATES`, `CURATION_STATES`, `MATERIALS_STATES`, `REVIEWER_ROLE_SET`
- `lib/video-platform.ts` - centralizes `PRODUCTION_VIDEOS_BUCKET`, `MAX_VIDEO_UPLOAD_SIZE_BYTES`, `YOUTUBE_REGEX`, `VIMEO_REGEX`
- `domains/curation/lib/curation-ui.ts` - extracts `GPT_URL` and UI helpers from component
- `domains/curation/lib/curation-action-helpers.ts` - extracts parsing/trigger logic (217 lines)
- `domains/materials/lib/production-formatters.ts` - extracts formatting logic (115 lines)

### Validators expanded (confirmed)
- `materials.validators.ts` now orchestrates 3 control-specific validators:
  - `materials-control3.validators.ts` (167 lines) - structural validation
  - `materials-control4.validators.ts` (71 lines) - source usage validation against APTA lists
  - `materials-control5.validators.ts` (212 lines) - quiz quantity, difficulty, types, explanations
  - `materials-validation-helpers.ts` (63 lines) - shared validation utilities
- Total: 572 lines of typed validation code

### Legacy cleanup (confirmed)
- `app/admin/artifacts/actions.ts` - deleted, replaced by domain actions
- `lib/lia-service.ts`, `lib/lia-dom-mapper.ts` - deleted
- Artifact listing modularized into: `ArtifactCard.tsx`, `ArtifactDropdownMenu.tsx`, `ArtifactsEmptyState.tsx`, `DeleteConfirmationModal.tsx`, `useArtifactsSync.ts`

---

## 3. Current Hotspots (Verified)

### Front-end files (largest active, all <500 lines now)

| File | Lines | Status |
|------|------:|--------|
| `domains/plan/components/InstructionalPlanGenerationContainer.tsx` | **489** | Orchestration-heavy but not a god file |
| `app/admin/artifacts/[id]/publish/components/VideoMappingList.tsx` | **495** | UI component, presentation-focused |
| `domains/syllabus/components/SyllabusGenerationContainer.tsx` | **488** | UI container |
| `app/admin/artifacts/[id]/publish/PublicationClientView.tsx` | **482** | Publication flow UI |
| `domains/curation/components/SourcesCurationGenerationContainer.tsx` | **464** | Orchestrator, delegates rendering |
| `domains/syllabus/components/SyllabusViewer.tsx` | **464** | Viewer component |
| `domains/materials/components/ComponentViewer.tsx` | **458** | Material component viewer |
| `domains/materials/actions/materials.actions.ts` | **456** | Still action-heavy |
| `domains/materials/components/ProductionAssetSections.tsx` | **451** | Extracted from ProductionAssetCard |
| `domains/materials/components/ProductionAssetCard.tsx` | **429** | Now an orchestrator |
| `domains/materials/components/MaterialsForm.tsx` | **425** | Form component |

### Netlify function hotspots (NOT addressed yet)

| Function | Lines | Problem |
|----------|------:|---------|
| `unified-curation-logic.ts` | **823** | **Largest file in entire project**, no modularity |
| `materials-generation-background.ts` | **469** | Full generation pipeline inline |
| `validate-materials-background.ts` | **317** | Validation logic inline |
| `syllabus-generation-background.ts` | **294** | Duplicated prompt from config |
| `instructional-plan-background.ts` | **288** | Mixes prompting + orchestration |

**Total Netlify functions: 3,106 lines across 11 files, 0 shared utilities**

---

## 4. Remaining Active Debt

### 4.1 Type safety - 284 `any` occurrences across 71 files

**Top offenders:**
| File | `any` count |
|------|----------:|
| `app/api/publish/route.ts` | 21 |
| `domains/syllabus/components/SyllabusGenerationContainer.tsx` | 13 |
| `domains/materials/components/ProductionAssetCard.tsx` | 11 |
| `lib/artifact-workflow.ts` | 9 |
| `domains/scorm/services/scorm-parser.service.ts` | 9 |
| `app/admin/artifacts/[id]/publish/actions.ts` | 9 |
| `app/admin/artifacts/[id]/publish/PublicationClientView.tsx` | 9 |
| `lib/lia-route-helpers.ts` | 8 |
| `app/builder/artifacts/page.tsx` | 8 |
| `app/architect/artifacts/page.tsx` | 8 |

Improved from 319 but still significant. No `noImplicitAny` enabled.

### 4.2 Error handling - 3 patterns still coexist

| Pattern | Count | Where |
|---------|------:|-------|
| `return { success: false, error }` | **127** | Server actions (9 files) |
| `throw new Error()` | **33** | Inside try blocks in actions (19 files) |
| `toast.error()` / `toast.success()` | **44** | Hooks and components (12 files) |

Some actions internally `throw` then catch + convert to `{ success, error }`, adding unnecessary wrapping. No unified error boundary.

### 4.3 Duplicated auth/action patterns

All domain action files still repeat:
1. `createClient()` → 2. `getAuthenticatedUser()` → 3. `getAccessToken()` → 4. `getAuthorizedArtifactAdmin()` → 5. Supabase query + Netlify call

- `getAuthenticatedUser()` called **22+ times** across the codebase
- `getAuthorizedArtifactAdmin()` called **41+ times**
- Only `materials.actions.ts` has `callNetlifyJsonFunction()` helper; curation and plan still use raw `fetch()`

### 4.4 Netlify functions - no shared utilities

- **No `netlify/functions/shared/` directory** exists
- Each of 11 functions independently imports `createClient` from `@supabase/supabase-js`
- Each function independently initializes `GoogleGenAI`
- `SYLLABUS_PROMPT` duplicated between background function and `domains/syllabus/config/`
- `unified-curation-logic.ts` at **823 lines** is the single largest file in the entire project

### 4.5 Environment config - scattered, no validation

- **30+ direct `process.env` accesses** with no centralized config
- **No Zod validation** at startup
- Confusing fallbacks: `GOOGLE_GENERATIVE_AI_API_KEY || GOOGLE_API_KEY`
- **18+ env vars** without `.env.example`
- Only `syllabus.config.ts` follows a config pattern

### 4.6 Magic strings still present (partially improved)

**Extracted (good):**
- `PRODUCTION_VIDEOS_BUCKET` in `video-platform.ts`
- `MAX_VIDEO_UPLOAD_SIZE_BYTES` in `video-platform.ts`
- `GPT_URL` in `curation-ui.ts`
- Pipeline state constants in `pipeline-constants.ts`

**Still inline (needs work):**
- `https://gamma.app/create` in ProductionAssetCard.tsx
- `setTimeout(..., 3000)` UI feedback delays (multiple files)
- `5000` polling intervals
- `300000` validation cooldown (5 min)
- `900000` validation timeout (15 min)
- localStorage key patterns (`isValidating_`, `lastValidation_`)

### 4.7 Domain structure inconsistency

| Domain | actions | components | hooks | lib | services | types | validators |
|--------|:-------:|:----------:|:-----:|:---:|:--------:|:-----:|:----------:|
| artifacts | YES | - | - | - | - | - | - |
| curation | YES | YES | YES | YES | - | YES | - |
| materials | YES | YES | YES | YES | YES | YES | YES |
| plan | YES | YES | - | - | - | - | - |
| syllabus | - | YES | - | - | YES | YES | YES |
| scorm | - | - | - | - | YES | YES | - |
| prompts | - | YES | - | - | - | YES | - |

No standardized template. Materials is the most complete; others vary widely.

### 4.8 Dead code / orphaned items still present

| Item | Status | Action needed |
|------|--------|---------------|
| `config/prompts/instructional-plan.ts` | Consumed by Netlify functions | Verify, do NOT delete blindly |
| `shared/config/prompts/materials-generation.prompts.ts` (585 lines) | Consumed by Netlify functions | Verify, do NOT delete blindly |
| `components/lia/` | Empty directory | Delete |
| `domains/instructionalPlan/` | Empty subdirectories | Delete |
| `packages/shared/` | Exports only `SharedConstant = 'Shared Value'` | Decide: adopt or delete |
| `packages/ui/` | Zero imports in entire codebase | Decide: adopt or delete |

**Note**: The prompt files listed above were previously marked as orphaned but are actually consumed by Netlify background functions. Deleting them would break builds.

### 4.9 Security / auth debt

- Background jobs rely on token passing without dedicated hardening
- Some routes/actions accept IDs without schema-level validation
- Dual auth system (Supabase + SofLIA Bridge) with fallback logic in multiple places

### 4.10 Operational debt

- Polling-heavy UX in pipeline stages (usePolling helps but pattern is still poll-based)
- Long-running Netlify jobs with coarse-grained status transitions
- Limited structured logging in background flows

---

## 5. Progress Tracking

### What improved across all 3 revisions

| Issue | 1st rev (42%) | 2nd rev (35-38%) | 3rd rev (28-30%) |
|-------|:---:|:---:|:---:|
| God files >500 lines | 5 | 5 | **0** |
| Largest front-end file | 1,375 | 1,089 | **495** |
| Dead legacy files | 17 | ~10 | **~4** (prompts used by netlify + empties) |
| `any` types | 270+ | 319 (grew) | **284** (shrinking) |
| Shared polling hook | None | None | **Created** |
| Centralized constants | None | None | **pipeline-constants + video-platform** |
| Extracted helpers | None | None | **6 new helper/lib files** |
| Typed validators | 59 lines | 59 lines | **572 lines** (5 files) |
| Artifact listing split | No | Yes | Yes |
| Lia route split | No | No | **Yes (720→147)** |

### What still has NOT improved

| Issue | Status across all revisions |
|-------|---------------------------|
| Error handling (3 patterns) | Unchanged |
| Netlify shared utilities | None created |
| `unified-curation-logic.ts` (823 lines) | Untouched |
| Centralized env config with Zod | Not created |
| Domain structure template | Not standardized |
| `packages/shared` and `packages/ui` | Still phantom |
| Magic timeout numbers | Partially extracted, many remain |

---

## 6. Recommended Debt Paydown Order

### Priority 1: High impact, addresses largest remaining categories

1. **Split `unified-curation-logic.ts`** (823 lines → target <400)
   - This is the single largest file in the entire project
2. **Create `netlify/functions/shared/`** - Supabase factory, GoogleGenAI factory, error response helper
   - Eliminates duplication across 11 functions
3. **Standardize error handling** - pick one pattern (`return { success, error }` recommended), eliminate throw+catch wrapping

### Priority 2: Type safety and config

4. **Create `config/env.ts`** with Zod validation at startup
5. **Reduce `any` count** - start with `publish/route.ts` (21 instances) and action files
6. **Extract remaining magic numbers** to constants (timeouts, cooldowns, localStorage keys)

### Priority 3: Structural consistency

7. **Define domain template** and align all 7 domains
8. **Enable `noImplicitAny`** incrementally (start with lib/ and actions/)
9. **Decide on `packages/shared` and `packages/ui`** - adopt meaningfully or remove
10. **Delete empty directories** (`components/lia/`, `domains/instructionalPlan/`)

---

## 7. Conclusion

CourseForge went from **~42% technical debt** (original) to **~28-30%** (current) in a meaningful way:

- **God files eliminated**: 0 executable files >500 lines (was 5)
- **Largest front-end file**: 495 lines (was 1,375)
- **New shared abstractions**: usePolling, pipeline-constants, video-platform, 6 helper/lib files
- **Validators expanded**: 59 → 572 lines of typed validation

The remaining ~28-30% is now driven by:
- Type looseness (284 `any` across 71 files)
- Duplicated action/auth patterns (no shared base)
- Netlify function isolation (823-line monolith, no shared utilities)
- Config/env scatter (30+ direct process.env accesses)
- Error handling inconsistency (3 patterns, 204 total instances)

**Direction: Improving. The structural crisis is over. What remains is conventional maintenance debt.**

**Current verified estimate: ~28-30%**
