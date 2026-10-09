# CAP-029: declarative contract foundation (not enabled)

## 2026-10-08: full-node reset staging

The fields UI now explicitly prepares the original of every declared field on a
multi-field physical target. `stageHtmlEditingTargetReset` replaces staged edits
for that node, retains unrelated drafts and produces one ordinary bounded batch
of typed field RESETs. No target selector/authority is sent. No publication until
Save batch; default image grants and aggregate budgets reject the entire staging
operation before replacing local state. Existing individual RESET/ALL semantics,
server CAS, durable tracking and history remain unchanged. Real mounted UI and
authenticated DB/browser behavior still require QA.

## 2026-10-08: explicitly declared multi-field DOM targets

Manifest fields can optionally declare `targetElementId`. Without it, the DOM
target remains `elementId`, preserving previous declarations and their digests.
With it, multiple independent fields may edit distinct properties of one physical
node. The compiler and inspector resolve targets from trusted declarations only;
commands still identify fields and reject client selectors/target overrides.

Conflicting physical sinks are rejected (same text/chart content, same attribute,
same range CSS property, locale text vs lang/dir). State, defaults, staging and
history remain keyed by field, while the DOM marker keeps the physical ID. Source
is immutable; field RESET leaves unrelated fields untouched. `RESET ALL` retains
its field scope, not a promise to reset the entire multi-field physical node.
Full-node reset UX/batching needs explicit closure against OP028. Older strict
clients cannot consume newly enrolled target declarations: coordinate template
version/consumer deployment; do not rewrite installed manifests in place.

## 2026-10-08: frozen compilation profile and output pins

New frozen bundles are `courseforge-html-editable-snapshot-bundle-v2` (schema2).
They include the exact compiler/geometry/isolation profile and SHA256 of every
derived clip fragment. Authorized restore and offline content verification reject
foreign profiles or any output drift before consuming fragments. Offline checking
still is not authorization. Grants and delivery URLs are never frozen as authority.

V1 archives now fail explicitly with `COMPILATION_VERSION_MISMATCH`, not implicit
recompilation. Keep their bytes/receipts for audit/rollback. Before deployment,
inventory existing V1: continued historical rendering requires a separately pinned
authorized legacy executor or an explicit new publication after visual review.
This patch does not implement a legacy executor or authorize republication. No
automatic Storage rewrite, migrations, flags or installation. The profile pin
protects frozen snapshots; live revision/template provenance remains an audit item.

## 2026-10-08: static geometry and compiler-owned CSS isolation

Current editable fragments pass `html-editing-geometry.server.ts` during static
admission and `html-editing-isolation.server.ts` after typed overrides. The shared
compiler produces a per-clip scope, rewrites each qualified selector subject, puts
supported pseudo-elements outside `:is()`, namespaces CSS layers and wraps the
derived fragment in a protected layout/paint containment box. Original source and
editorial revision bytes are not rewritten. No independent preview renderer.

Static length fields use bounded explicit units; pixel font sizes avoid nested
relative amplification. SVG viewports/known shape coordinates are independently
bounded. Source-owned fixed/sticky positioning, transforms/perspective/backdrop,
indirect geometry, font shorthand, document-root selectors, CSS nesting, nested
layers and unsupported pseudo-elements fail explicitly, requiring template review.
These are admission rules, not complete CSS interpretation or GPU/raster budgets.

This changes derived HTML/checksums and can reject previously admitted templates.
Existing frozen compiled checksums require versioned reconciliation before rollout;
do not switch a stored render to a newly compiled version silently. The constants
identify the new derivation, but do not alone implement persisted renderer-version
negotiation. The source remains available for rollback and manual visual comparison.

DOM selector tests prove that generated selectors do not select host/other-clip
elements. They do not prove browser cascade, layout, clipping, CSP enforcement,
codec/font behavior or preview/render pixel parity. Those remain QA obligations;
remaining geometry sinks and version/provenance flow are also implementation audit
items, not excused as manual QA. See the current CAP029 completion plan in
`docs/architecture/SOFLIA_ENGINE_CAP029_COMPLETION_PLAN.md` at repository root.

The companion's catalogue UX, CAP022/025/027 and global trackers are not changed.
No flags, operator templates, migrations or deployments are activated by this cut.

2026-10-06 durable initialization service/HTTP wired: shared legacy/durable current
source/anchor/catalog/grants preparation; registerOperation derives request digest,
reads authorized receipt first, returns exact historical result without current
CAS preparation/re-registration/reactivation, otherwise explicitly requested first
attempt prepares and commits once. Read failure is not absence/retry permission.
New initialize/operations/[ID] typed POST + digest-query metadata GET, auth/tenant/
reviewer before service-role, bounded/correlated owner/ID/body/digest, safe errors.
POST shares legacy initialization quotas10org/3actor; GET60org/30actor. Separate
receipt+inspector read gates; POST initialization gate additionally, GET writesoff.
Always200 historical receipt; created does not imply newly created on replay.
Sixteen tests new; 324/324 code +16/16 lexical SQL guards and TypeScript pass, RPC/
Request-Response ports simulated, not real session/NextHTTP/browser/DB/RLS/locks/
Storage/UI/render/formal QA/migration/flag/rollout. Client still legacy: persist ID/
digest before durable POST, journal receipt, missingACK/historical recovery and
panel wiring remain next. Product unknown initialization still blocked.

2026-10-06 durable initialization receipt foundation: owner/org/draft/clip/op/
request digest + typed template/version/native CAS + initial-v1 ACK metadata,
explicitly historical not current/render. Shared versioned preimage, server Node
digest, adapter independently recomputes digest of returned request. Internal
initializationOperationId selects one commit+receipt RPC; legacy register/readback
unchanged. Metadata reader bounded/scoped/auth; NOT_FOUND is not retry evidence.
Prepared SQL090000 wraps registrationV2 + exact initial revision + receipt in one
transaction, draft-first NOWAIT/current actor, duplicate ID correlation + template
not revoked, no re-registration/reactivation/native append; reader fresh current
authorization, private RLS/service-only/retained metadata, no cleanup/update/delete.
Eight code/eight lexical SQL guards new; 308/308 code + 16/16 guards pass with
TypeScript. No PostgreSQL execution/atomicity/RLS/concurrency proof, HTTP/UI/browser/
Storage/render/formal QA/migration/flag/rollout. Not connected to bootstrap host/
HTTP/client/journal/recovery yet: product initialization without ACK stays blocked.
Inventory173SQL/four preexisting duplicate prefix groups require deployment history
reconciliation; do not rename/apply blindly. Disable new writes without deleting
receipts/read capability; no retry-from-absence or legacy fallback.

2026-10-06 global recovery wired outside selected-clip inspector: actor/org/draft
context key independent of clip/hash/tab/write flags, changed identity remounts
request-owning panels, invalid context never falls back to an old owner. Global
center offers only tracked recovery, no POST form. Installed-template initializer
form remains at DECK target with EMPTY tracking/write gate; pending/unavailable
actions live globally, not duplicated. Historical editorial receipt recovery can
close after clip removal or source replacement without adoption/restore/current/
render claim. Unknown initial ACK still blocks with no inference/requests even
without its clip. Six new pure/context and simulated-host tests; 300/300 code plus
8/8 lexical SQL guards, TypeScript pass. Wiring inspected, React/Native not mounted:
layout/focus/scroll/cross-panel refresh and real abort remain tester work. No real
HTTP/DB/render/formal QA/migration/flag/rollout activation. Initial durable receipts,
changed-native initial history, catalog UX/sandbox/gates remain partial.

2026-10-06 Native/UI initialization wired: shared lock/native reservation, total
deadline, source/CAS admission, intent before one POST, direct ACK persistence,
authorized document+inspector refresh with exact canonical native hash/version,
template/source/owner/clip/initial-v1/SHA/empty overrides before exact closure.
No adoption/document edits/undo/render. Host tracks initialization and blocks
native/editorial while pending/corrupt even with writes disabled. Recovery uses
only two GETs and requires persisted ACK; unknown outcomes never infer success.
Panel requests installed template ID/version only; server owns catalog/grants/
source/CAS. New SEND opt-in port remains off; tracking/recovery stays visible when
new writes off, unmount/context change aborts. Nine tests; 294/294 code + 8/8 SQL
lexical guards and TypeScript pass, simulated host/queue/storage/HTTP only; React/
Native not mounted, no browser/DB/render/formal QA/migration/flag/rollout activation.
Still partial: server durable receipt for missing initial ACK, changed native
historical closure, global recovery when no DECK clip selectable, catalog UX,
sandbox/gates and integrated evidence. Current reads cannot resolve causality.

2026-10-06 initialization transport/tracking foundation: shared strict ACK schema
for handler/client; one relative POST with typed template/version/hash only,
correlated v1/hash/200-existing/201-created response, bounded JSON and deadline.
Unknown/lost responses never retry or infer ACK from inspector. Separate 4KiB
actor/org/draft journal retains initial intent, refuses overwrite and unknown
closure, accepts only direct hash-correlated ACK with exact tracking snapshot.
Not connected to host/UI yet: Native barriers, shared lock/reservation, verified
refresh, explicit ACK recovery and panel remain next work, not complete UI.
Caller must verify source/template/native integrity before acknowledged closure;
local metadata is not authorization/CAS/server receipt. Eight new tests; 285/285
code plus 8/8 lexical SQL guards, TypeScript pass. Simulated ports only; no Native/
UI/browser/HTTP real/DB/render/formal QA, migration/flag/rollout activation.

2026-10-06 explicit historical tracking closure: panel/host historicalOnly always
reauthorizes the durable receipt, including cached receipts, then verifies an
authorized native GET matches the canonical hash/version of already loaded state.
Shared lock/reservation and owner/base/signal/exact-entry fences precede closure.
Superseded revisions can close historical tracking without restoring ACK.next,
adopting content, reconstructing undo, POST or claiming current/render authority.
No claim of causal ordering between historical receipt and current native state.
Legacy without digest, denied/missing/foreign receipt, drift/abort stay blocked;
stale payload requires explicit reload. Exact recovery retains its prior semantics.
Six new tests: 277/277 code + 8/8 lexical SQL guards; TypeScript passes. Simulated
ports only, no mounted UI/Native/browser/HTTP/DB/render/formal QA or migration/flag/
rollout activation. Initialization UI/sandbox/catalog/gates remain partial.

2026-10-06 missing local ACK recovery cut: explicit panel/host action accepts
durable digest tracking without ACK, performs one authorized receipt GET under
lock/reservation, rechecks owner/base/signal/unchanged tracking, and records only
exact owner/ID/digest/expected-correlated receipt evidence. Current document and
inspector verification still precede closure of the same ID/exact loaded revision.
NOT_FOUND remains unknown with no current GET/retry/POST; legacy without digest
cannot infer causality. Valid receipt survives stale loaded state; explicit reload
can then close without another receipt query. Late abort/drift cannot record or
close; no adoption or history reconstruction. Superseded revision closure remains
unimplemented/fails closed, not full recovery completion. Eight new tests include
durable host lost POST -> reload -> three GETs -> exact closure and initial no-op.
271/271 code plus 8/8 lexical SQL guards and TypeScript pass, simulated ports only.
No mounted Native/React/browser/session/HTTP/DB/Storage/render/formal QA, no migration/
flag/rollout activation. Other initialization/sandbox/catalog/gates remain partial.

2026-10-06 durable client cut: shared canonical preimage, matching Node/Web Crypto
digest; bounded correlated one-POST/explicit-GET transports. Opt-in dispatcher
persists ID/digest before sending, records exact receipt before guarded rebase and
closure. Lost response keeps identity without ACK/legacy fallback/retry. Journal
v1 adds optional digest/receipt, retains legacy compatibility, rejects plain ACK
for durable entries and foreign/mismatched receipts. Native host accepts optional
durableEnabled supplied by new public receipts flag, not activated. Server gates
remain mandatory. Missing-ACK recovery UI still does not call receipt GET: explicit
recovery integration and superseded handling remain incomplete. Eight new tests;
263/263 code plus 8/8 lexical SQL guards and TypeScript pass, simulated ports only.
No Native/React/browser/session/HTTP/DB/Storage/render/formal QA or migration/flag/
rollout activation. Source/timing unchanged; older cuts below are historical.

2026-10-06 durable HTTP cut: operations/[operationId] POST connects strict bounded
command to server digest/durable service; GET requires one requestSha256 query and
returns only authorized RECORDED/NOT_FOUND metadata. Session/tenant/reviewer before
service-role, strict same-origin POST/JSON, foreign origin/site rejection, bounded
IDs/URL/body/deadlines, shared POST legacy quota and separate read quotas, no-store,
safe errors and full receipt correlation. New receipts gate remains off; inspector
gate required, mutations gate only for POST so GET can work with writes off.
Legacy client still does not use this route. NOT_FOUND is never retry permission,
receipt is historical not latest/render. Eleven new tests; 255/255 code plus 8/8
lexical SQL guards and TypeScript pass. Simulated handler/auth/ports, no actual
Next HTTP/session/browser/DB/render/formal QA/migrations/flags/rollout. Client
transport/digest/journal/missing or superseded ACK recovery and other capability
gates remain incomplete. Source/timing unchanged.

2026-10-06 durable service/gateway cut: opt-in service computes request digest
server-side, checks authorized owner/draft/clip/ID-correlated recorded receipt and
returns its historical result without preparing/re-appending current state. ID
reuse for another command/owner/CAS fails. Absence is not retry authorization.
Shared gateway preparation now requires commitOperation for durable no-ops too;
exact owner/ID/digest/ACK validation, no legacy fallback on cancellation/lost or
malformed receipt. Legacy factory/HTTP behavior remains unchanged. Locator/ACK/
receipt contracts are now foundation-owned, with compatible reexports, so the
gateway has no HTTP-layer dependency and isolated unit build remains valid.
Nine new tests; 244/244 code plus 8/8 lexical SQL guards pass; web/test/unit builds
pass. In-memory ports, not real DB/RLS/transaction/concurrency/HTTP/UI/render QA.
Durable HTTP dispatch/read, client/journal and missing/superseded ACK recovery,
initialization UI/sandbox/catalog/gates remain incomplete. No flags/migrations/
rollout activated; older cuts below are historical.

2026-10-06 durable receipt foundation: strict owner/draft/operation/request-digest/
clip/ACK metadata contract, versioned server semantic request digest, and repository
commit/read ports prepared. SQL 20261006080000 (not applied) stores private bounded
receipts with RLS/direct privileges revoked. Service-only commit nests existing
native/HTML append plus receipt in one transaction; no-op validates unchanged
CAS/content/current grants and records a receipt without appending. Reused ID with
different clip/digest fails; identical recorded ID never appends/reactivates.
Authorized read returns metadata, NOT_FOUND is not failure/retry proof. Prepared
ports are NOT connected to gateway/service/HTTP/client/journal/recovery yet.
Missing-ACK writes still cannot be reconciled. Nine new adapter/contract tests;
235/235 directed code tests plus 8/8 lexical SQL guards pass; TypeScript passes.
No PostgreSQL execution/RLS/concurrency/HTTP/browser/render/formal QA proof, no
migration/flag/rollout activation. Wiring must preserve one dispatch and server-
derived digest, durable no-op, full receipt correlation and superseded handling.
Migration inventory also found four duplicated version groups outside this new
file; compare applied DB history before any migration renaming or deployment.

2026-10-06 acknowledged recovery cut: native host and an explicit recovery panel
coordinate saved POST ACK + cooperative lock/queue reservation + two bounded
authorized GETs. Recovery verifies the already loaded document against current
hash/version/source/template/pointer and exact ACK next revision, then rechecks
owner/base/signal/unchanged tracking before closing the same ID. No POST/retry,
adoption, merge, reconstructed undo, render or inferred missing ACK. Stale loaded
state requires explicit reload. New-write flags need not be enabled; server read
gates/authorization remain mandatory. No-op initial revision without a pointer
requires its exact original native hash. Cancel/deadline releases the reservation
even for noncooperative reads; late callbacks cannot close. Panel is not mounted
or browser-tested. Eight new tests; 226/226 directed selection and TypeScript pass.
No migrations/flags/rollout activated. Missing-ACK operations need a durable server
receipt; superseded ACK recovery, initialization UI, sandbox/catalog/gates and real
validation remain incomplete. Never delete tracking or resend to resolve them.

2026-10-06 atomic batch cut: inspector stages up to 50 typed field overrides
locally, replaces same-element changes in manifest order and submits one command
through the existing native host. Removing/discarding staged fields never clears
tracking or changes server state. Fields remount on revision/native hash changes;
a synchronous guard blocks duplicate submission. Final preflight rejects incomplete
declared-image repair, allowing multiple revoked defaults to be replaced together.
Current server grants, full compiled dependencies and native/editorial CAS remain
authoritative. One confirmed batch produces one forward revision and one editorial
undo entry; source/timing stay unchanged. Six new tests, 218/218 directed selection
and TypeScript web/test build pass. In-memory ports/repository, not React/native UI,
browser/HTTP/DB/Storage/concurrency/render or formal QA evidence. Recovery with/without
ACK, initialization UI, sandbox/catalog/gates and real validation remain partial.
No migrations, flags or rollout activated. Older cuts below are historical.

2026-10-06 native host cut: `CompositionHtmlEditorialNativeHost` is now supplied
by NativeCompositionPreview. Inspector/mutation flags and matching server gates
remain required; none were enabled by this work. Host coordinates fresh owner/base,
queue/lock/tracking/one POST/verified refresh/guarded adoption/closure. Pending
tracking survives disabled mutation flags, no-op preserves native payload/history,
unmount cancels waiting, and late owner/base drift cannot adopt. Native queue,
controller ports, shortcut/settings and explicit bypass wrappers are fenced;
runtime coverage of all entry points is not yet proved. No renderer is invoked.
Native undo/redo checkpoints pin current HTML references without reverting editorial
state: compatible contiguous tails survive, changed/missing sources and removed
references form barriers. Projection is atomic on callback failure and memory
budget includes redo-only stacks. Twelve new tests; 212/212 directed selection and
TypeScript pass with simulated ports/HTTP. Native/hooks/React not mounted. Recovery,
atomic batch repair, initialization UI, sandbox/catalog/gates and real QA remain.
No migrations/flags/rollout are activated. Older cuts below describe prior states.

2026-10-06 inspector controls cut: native inspector now delegates lifecycle to
`useCompositionHtmlEditorialSession` and has optional typed text/image/theme/reset
controls plus session history undo/redo. A mutations flag AND an explicit native
host port are mandatory; NativeCompositionPreview supplies no such port yet, so
its inspector remains read-only. Host must complete fencing/tracking/dispatch/
verified refresh/guarded adoption before resolving. UI validates ACK/view identity,
uses no innerHTML/raw POST, and never clears tracking via an inspector GET.
Owner/tenant/draft/clip key discards history on scope changes but no longer on hash
changes; incompatible hash invalidates view, in-flight reads check current hash.
Pure field preflight enforces symbolic choices/current projected grants and CAS
body without authority fields. Five tests added, 197/197 directed selection and
TypeScript pass; components/hooks not mounted/tested. Atomic multi-field repair,
native fences/host, uncertain recovery, initialization UI and sandbox remain.
No browser/DB/render/formal QA/migrations/flags/rollout are activated.

2026-10-06 rebase verifier cut: `composition-html-editing-rebase.client.ts`
reads bounded native document and inspector responses using explicit same-origin
GETs. It verifies owner routing, immutable binding/manifest, ACK locators, native
version, source SHA and browser canonical hashes; the only permitted document
change is the confirmed editorial reference and V4 promotion. Other edits with
valid hashes are conflicts, not merge permission. No-op preserves the native
document/version. Returned payload/view are detached and never automatically
adopted: Native host must fence bypasses and check current owner/base/signal just
before adoption. This is integrity/concurrency validation, not authorization or
render evidence. Cooperative reads propagate a 20 s deadline; non-cooperative
dependencies require the dispatch coordinator's outer bounded wait. Nine tests
added, 192/192 directed selection and TypeScript pass, including simulated full
dispatch/refresh/adoption/closure. Not wired to native UI, no formal QA/rollout.

2026-10-06 dispatch coordinator cut: `composition-html-editing-dispatch.client.ts`
combines the existing publication Web Lock, explicit native reservation port,
fresh owner/base admission, persisted journal, a single typed POST, persisted ACK,
authorized rebase port and exact closure. Failed/lost POST leaves uncertainty;
confirmed ACK with failed/drifting/aborted rebase requires refresh and retains ACK.
Client waiting is bounded for non-cooperative transports; rebase callbacks must
guard late adoption against owner/base/signal. `CompositionSaveQueue` now supports
immediate idle-only reservations and rejects concurrent saves while reserved.
Neither coordinator nor reservation is wired into NativeCompositionPreview yet;
queue-bypassing mutation fences, authorized refresh/rebase and edit/history UI
remain required. Ten new tests, 183/183 directed selection and TypeScript pass.
No browser/DB/render/formal QA/migrations/flags/rollout are activated.

2026-10-06 editorial journal cut: `composition-html-editing-journal.client.ts`
prepares a bounded owner/tenant/draft metadata slot before dispatch. Pending or
unreadable slots are never overwritten/expired. Only a direct validated POST ACK
can be recorded; explicit native rebase to its next locator is required before
closing. A matching GET cannot establish causality for a lost ACK. No HTML,
overrides, grants or credentials are stored. This is not a server operation ledger
or cross-tab CAS: callers must use a shared cooperative lock/native fence. It is
NOT wired into transport/UI yet. Four new tests; 32/32 client/journal/snapshot
selection pass, web/test TypeScript pass. No browser/DB/render/formal QA/rollout.

This isolated module declares a V1 editable-element manifest and validates bounded
JSON commands, reduces isolated override snapshots and applies them to restricted static HTML fragments. It has no product entry point, renderer integration, persistence,
active durable repository, live operations gateway, or imported HTML support. A native V4
reference contract and service adapter are prepared below; V1–V3 documents remain compatible.
This is partial CAP-029 work, not a complete capability or rollout.

## Contract

- Stable element IDs, not CSS selectors or DOM paths.
- Binding to organization, document, revision, document hash, clip, template and
  version, immutable source hash, and verified manifest hash.
- Up to 200 declared elements; at most 50 overrides in a command; maximum command
  size 64 KiB UTF-8 and manifest size 256 KiB UTF-8, checked before JSON parsing.
- Plain text up to 4,096 UTF-16 code units globally and the declared per-element
  Unicode code-point limit. V1 excludes markup delimiters and control characters;
  future adapters must use `textContent`, never HTML interpolation. Empty text is
  permitted; line separators are rejected on single-line elements.
- Images reference UUIDs, not URLs. Both a template allowlist and current
  caller-supplied ownership grants must permit the asset. Fits use the existing
  composition vocabulary `CONTAIN`/`COVER` without importing the large document
  schema and its unrelated dependencies.
- Theme choices are symbolic IDs declared by a template, never CSS values.
- Reset names a declared property; duplicate element/property writes are rejected
  rather than relying on order-dependent last-write-wins behavior.
- Unknown fields and unsupported operations are rejected; returned errors contain
  stable codes, not user content or detailed validation internals.

## Versioned manifest digest (server-only)

`html-editing-manifest-digest.server.ts` adds content-integrity checks using Node's
built-in SHA-256; no dependency or format change. Its exact UTF-8 preimage is:

1. ASCII `courseforge-html-editable-manifest-digest-v1` followed by one LF.
2. Canonical JSON of the validated manifest with **only**
   `binding.manifestSha256` removed: recursively sorted object keys, original
   array order, JSON.stringify string/scalar escaping, no whitespace or terminal LF.

All other binding fields, format, elements, text limits, image permissions/fits,
and theme declarations are covered. Array order is intentionally significant,
even for allowlists. Unicode is not normalized. This bounded project-specific
encoding does not claim RFC 8785/JCS conformance. A future change must use a new
digest version, not reinterpret existing hashes. The self-digest omission avoids
an impossible hash fixed point; issuers may compute using a schema-valid placeholder
in both supplied bindings, then insert the resulting digest without changing it.

`verifyHtmlEditableManifestContent` requires an independently authoritative binding
and compares the recomputed digest with it, not just the hash claimed by the JSON.
`validateContentVerifiedHtmlEditingCommand` verifies manifest content anew before
the original command preflight; do not substitute a cached mutable manifest.
The existing `parseHtmlEditableManifest`/`validateHtmlEditingCommand` retain their
original schema/preflight-only semantics for compatibility. No existing consumer
was switched or product editing enabled.

## Pure atomic override reduction (experimental)

`html-editing-override-reducer.server.ts` accepts a bounded encoded prior snapshot,
encoded manifest/command, authoritative binding, and current asset grants. It
verifies manifest content, rejects stale snapshot identity and malformed/duplicate
stored overrides, validates the entire command, and returns independent
`previousState` / `nextState` snapshots plus deterministic `changedElementIds`.
No input is mutated and no partial result is published on failure.

The additive `courseforge-html-editable-override-state-v1` format stores only SET
values (no RESET commands), up to 200 overrides and 256 KiB UTF-8. Values reuse the
command property schemas, not a second permissive value model. Result ordering
follows the manifest's declared element order. RESET removes a declared override,
so a future renderer can use the immutable template/source default; this reducer
does not invent default content or modify source. Same-value writes and reset of
an absent override report no semantic change.

Previously stored values must still satisfy template policy. An old image with a
revoked grant can be removed via RESET, but current grants are checked against the
entire resulting snapshot: retaining or newly setting that image fails. Validation
reuses the existing bounded command policy per stored override; at most 200 items
are checked. A snapshot can exceed one command's count/byte budget without bypassing
the original command limits.

This is atomic **in-memory reduction only**, not a database transaction, operation
gateway, OCC/version update, or durable undo/redo system. The before snapshot is
available for future history integration but restoring it must recheck binding,
manifest integrity, and current permissions. Caller-provided metadata is still
not proof of authority, and the reducer is not called by the live editor.

## Static fragment compiler (experimental, not enabled)

`html-editing-compiler.server.ts` verifies the exact immutable UTF-8 source SHA-256,
manifest digest, snapshot binding and every stored override before applying changes.
It bounds source/output bytes and DOM element count, requires unique source IDs
and a compatible target for every manifest declaration, and instruments only those
targets with `data-courseforge-editable-id`. Text uses a DOM text setter, images
use exact materialized `conformance-media/<UUID>` paths and declared object-fit,
and themes use fixed token/choice data attributes consumed by template selectors.
No free CSS, selectors, JavaScript or HTML replacement operation is exposed.

The resource admission policy is shared with controlled-render deck admission,
preserving that adapter's existing rejection codes. This compiler additionally
allows only static visual tags (no SVG animation) and rechecks resources after
serialization against current grants. A revoked source default can be replaced,
but RESET cannot silently resurrect it. Image defaults must also satisfy the
template allowlist. No returned result is published until all checks pass.
Inputs are immutable; resetting means compiling the original source with an
override removed, never reusing previously compiled HTML as the original.

This reusable fragment transformation is now invoked by both compiler targets
when the exact host context is supplied. That is not evidence of live route
activation or matching pixels/seek/fonts. Fragment IDs are checked locally; the
native consumer additionally checks IDs across the assembled composition. Parser admission
does not replace a sanitizer, CSP/iframe isolation or OS-level network denial.
The source/manifest/grants must come from independently authorized backend state;
image MIME/bytes must be verified by materialization. Versioned document storage
and the DEC-104 persistence choice remain unresolved; overrides are not added
as out-of-document live render parameters that would bypass document hashing.

## Versioned revision and experimental gateway

`html-editing-revision.contract.ts` defines a bounded (1 MiB UTF-8) revision that
contains original source, complete manifest, SET snapshot and a monotonically
increasing version. `html-editing-revision.server.ts` hashes all validated fields
under `courseforge-html-editable-revision-digest-v1\n` using the same canonical
JSON encoding as the manifest. The digest is external to the revision, avoiding
a self-hash cycle. Manifest binding remains the immutable issuance/base anchor;
it is not silently relabeled as the hash of today's native composition document.
This is an experimental versioned subdocument, not an amendment to native V1–V3.
DEC-104 remains provisional pending storage integration and template size evidence.

Preparation checks both expected version and complete digest, then reduces and
compiles the new state. No-op preserves both version and exact digest, including
non-manifest ordering in an old snapshot. Undo/redo restores only the same immutable
source/manifest with old overrides at a NEW version, rechecking current grants.
A revoked old override may be removed; it cannot be reintroduced from history.
Before/after values are independent and usable by a future session history.

`html-editing-revision-gateway.server.ts` obtains source, binding, grants and
materialized paths from a host-owned repository, not the command request. It
checks the current native composition hash separately from the template anchor.
The repository must atomically recheck that hash, source identity, current actor
authorization/grants and expected HTML version/digest before appending. The
coordinator returns mutation success only on an exact committed acknowledgement;
conflicts reject, missing/invalid/lost ACKs remain unconfirmed and are not retried
automatically. No-op and invalid operations do not call append.

There is a prepared Supabase repository/transaction and native document binding,
but **no applied migration, active repository/HTTP entry, live history/UI or
snapshot/worker wiring**. Both compiler targets have an exact local consumer.
Repository tests simulate RPCs; they do not prove database atomicity,
locks/grants or operational authorization. Do not pass these overrides as
out-of-document render options or claim preview/render parity from the digest.

## Native V4 references and prepared persistence

`html-editing-reference.contract.ts` declares a small root-level `htmlEditing`
reference set under `courseforge-composition-v4`. Each pointer includes clip,
revision version/digest and immutable template/source/manifest identity. Native
document hashing covers these pointers; large source/overrides stay in the
experimental private subdocument store. V1–V3 cannot carry pointers. Native
TEXT/CAPTION remains supported in V4. Ordinary timeline edits preserve V4 and
removing a clip removes only its pointer. Generic save/restore cannot introduce,
retarget or drop a pointer while the clip survives, or replace its source.
Dedicated HTML restoration must own those changes. This deliberately blocks
generic history restoration of a deleted referenced clip until integrated safely.

`composition-html-editing-document.server.ts` verifies a complete revision, exact
original deck source and authoritative hashes, then prepares a V4 document with
the pointer. No input is changed. `composition-html-editing-repository.service.ts`
reads the prepared service-only RPC, validates source/content/native hashes,
tenant/clip and pointer lineage, and re-reads before append. The append sends one
native document plus one subdocument, expected native and HTML version/digests,
and the compiler's complete used-asset set (including CSS dependencies). All RPCs
have bounded signals and safe failures. Lost write ACK is unconfirmed, never retried.
Logical `conformance-media/<UUID>` aliases are NOT materialized files or MIME/byte
attestation; render still needs the existing independent materializer and pins.

Prepared migrations `20261005200000` / `20261005210000` add private immutable
template/history tables, reviewer/active-member checks without global fallback,
explicit registration/read, and draft-first CAS append delegating native append
and audit in the same transaction. Direct table/helper access is denied even to
service_role; public RPCs are service-only. Fresh linked tenant image grants are
checked and row-locked; source/manifest remain exact and immutable. The trusted
host verifies canonical hashes, schemas and complete used resources before RPC;
SQL does not independently reproduce JavaScript canonical hashes or sanitize HTML.
No table registration or migration was executed. Storage/locks/grants/durability
remain unverified in PostgreSQL. History intentionally prevents cascading deletion;
rollback must stop consumers/revoke RPCs and preserve private/history rows.

Both compiler targets now consume the same exact, host-authorized revision set
through `htmlEditingCompilation`. Native document hash, complete pointer fields,
immutable source, revision digest and current image grants must match. A newer
revision cannot replace a historical pointer. Fragments are compiled separately;
the original native source and document hash are never rewritten. Every used image
requires its exact `conformance-media/<UUID>` delivery binding. Missing context,
missing/extra revisions or remote delivery still reject before runtime loading.
No request route supplies this host context yet, so live V4 previews/snapshots
remain fail-closed; this does not activate a feature or register a template.

The local consumer validates assembled clips/global deck CSS after replacement,
rejecting active neighbouring decks, remote dependencies and CSS imports. It also
checks every ID across the final page, including unedited clips and generated
wrappers. It rejects collisions instead of renaming IDs and breaking CSS/SVG.
Resource admission is not a browser sandbox, dependency-byte attestation or visual
parity proof. Global CSS fonts requiring imports remain unsupported here.

The exact historical reader is now prepared as described below, but its database
authorization/locks remain unverified and it is not connected to a route.
Frozen snapshot bundles, ZIP/metadata pins, extraction, revised-text conformance
planning and controlled consumption are implemented below. Live image acquisition,
snapshot producer wiring, isolation and UI remain required before template
registration or rollout. Deploy prepared migrations with their worker/fence
dependencies and coordinated host code only after consumers are ready and
approved; do not enable between them.

## Exact historical compilation reader (prepared)

`composition-html-editing-reader.service.ts` calls `read_html_editing_compilation`
with authenticated host actor/tenant/draft and the selected native document hash.
Migration `20261005220000` selects that saved document (latest occurrence only
when the hash repeats), then every referenced HTML revision by exact version AND
digest. It never selects latest HTML rows. Actor membership, active draft,
current template revocation and linked image grants are checked under row locks;
the response includes the independently stored initial-template binding.
Native source, stored source, manifest and every pointer field must agree.
Public/anonymous/authenticated execution remains denied; service-only read only.

The host checks strict response shape/bytes, native document hash, scope,
independent anchor, revision digest, pointer coverage and current grants through
the same compilation verifier. Logical aliases are used only for integrity
verification, and that derived output is discarded. Returned context contains
current grants, but is NOT a durable permission receipt or a materialization proof.
The eventual compiler caller must independently bind actual delivered bytes, and
execution must recheck authority after this read. Provider failures are safe,
not retried; invalid/pre-cancelled inputs never issue a privileged RPC.

Ten directed reader tests include a valid revision-1 document with revision 2
already available, latest-substitution rejection, inconsistent hashes, foreign
anchors/grants, revoked images, missing/duplicate entries, size bounds and safe
failure/cancellation. These use RPC fakes, not PostgreSQL. No migration has been
applied; SQL syntax, lock behavior, permissions and revocation races are unproven.

## Frozen revision bundle (prepared archive bytes, not active snapshots)

`composition-html-editing-snapshot-bundle.server.ts` freezes exact revisions as
canonical, bounded V1 content at the fixed `html-editing-revisions.json` path.
The bundle identifies tenant/draft/native hash and preserves complete source,
manifest/state/version; revisions sort by clip ID. Its external SHA-256 pins
the exact UTF-8 bytes. It never stores grants, authority objects, signed delivery
URLs or materializer maps. It is not a permission receipt or a ZIP upload.

`readCompositionHtmlEditingSnapshot` prepares these bytes from one exact authorized
read. Both compiler targets accept `htmlEditingSnapshot` with independent current
scope/authority and actual local delivery bindings; supplying it together with a
live revision context is rejected. Bounded byte integrity/schema, selected native
hash, exact pointer/source/revision identity and current grants are all rechecked.
Recomputing a tampered bundle checksum cannot bypass native revision pointers.
Removing an image grant after freeze makes later compilation reject the old image.

Ten bundle tests cover deterministic content-only freeze, drift/revocation,
fresh authority, byte tampering, replacement revision even with recomputed SHA,
scope/anchor mismatch, strict size/path/schema, duplicate coverage and identical
fragment derivation in both targets. That is not browser pixel parity.

The real snapshot service rejects HTML references before its reuse query as well
as new snapshot generation until image/resource acquisition and controlled-worker
authority/materialization are connected. Frozen ZIP writer/reference pins and
edited-text plan integration are implemented below, but the active snapshot flow
does not yet supply an HTML bundle. A matching
native hash alone must not reuse an archive lacking those bindings. One directed
guard test covers this condition; no migration, active route or renderer is enabled.

## Reference ZIP and frozen edited-text plan

`composition-conformance-reference-archive.server.ts` verifies source/contract/font
and HTML bundle pins before writing any archive entry. The existing snapshot
service uses this shared writer for reference files. When an authorized producer
supplies an HTML bundle, it writes its exact bytes at the fixed root path and
records its schema/path/SHA pin in reference metadata. Legacy references remain
readable without an HTML pin. Coordinated readers are required before any rollout:
old strict readers do not understand the added optional metadata field.

The reference producer requires fresh authority for compilation. Offline reference
verification checks bundle bytes and native revision pointers, complete used-image
bindings/MIME and the edited-text contract. `verifyCompositionHtmlEditingSnapshotContent`
is explicitly CONTENT ONLY: template-declared images are used to derive expected
source/paths, never to issue execution authority. It returns fragments/dependencies,
not a grant context. Permission, revocation and actual bytes still need independent
checks at execution.

`buildDeckTextPlan` / `validateDeckTextPlan` accept the frozen bundle and derive
text paths/hashes from its selected compiled fragment, while retaining the saved
native document hash. Effective compiled HTML counts toward the existing text
plan budget. HTML references without a bundle reject; reference production also
requires the version-4 deck-text contract. An original-source plan is rejected
even if all serialized checksums are internally consistent.

Eight new directed tests cover an in-memory ZIP round trip, edited text versus
original native source, missing/stripped/altered bundle pins, original-text plan
forgery, fresh-grant failure, missing image bindings, verify-before-write and the
required text contract. No archive is uploaded, no renderer is started, and no
database migration is applied.

### Bounded materialization and current render authority

The reference materializer now extracts the fixed bundle path only with its
metadata pin, caps decompression at 16 MiB before JSON decoding, checks raw SHA-256
and exact UTF-8 round-trip bytes, rejects unpinned packages and cross-organization
scope, accounts for extracted bytes and removes its own partial files on failure.
Offline scope/content checks are not current grants or execution permission.

Controlled render materialization pins that extracted package and requires a
host-owned `readHtmlEditingAuthority` resolver for HTML references. The host must
authorize the actor and frozen revision independently, resolve its actual draft,
and return independently stored template bindings plus current image grants. It
must not echo archive claims as authority. The worker host now installs a
claim-bound RPC resolver as described below; it is prepared, not operationally
verified or enabled. Legacy revisions need no HTML resolver.

The render entry uses the selected frozen edit without rewriting the original
native source/hash. Resource admission checks the effective fragment, not a
default image replaced by an edit. Before entry delivery and again through the
supervisor's post-execution check, all file pins and fresh HTML authority are
revalidated. Revocation during a simulated execution withholds its result. This
does not provide OS/browser isolation or retroactively prevent an in-flight
renderer from accessing a file; executor isolation remains mandatory.

Twelve directed tests cover extraction, missing/altered/unpinned packages,
decompression, UTF-8, scope, cleanup, current grants, independent template drift,
bundle mutation and post-execution revocation with a fake callback. They use
synthetic media and scoped Storage responses, not actual image decode/render.
Snapshot creation remains fail-closed for HTML pointers until acquisition and
producer/host wiring are complete. UI/history/inspector/sandbox/catalog and formal
QA remain pending.

```powershell
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-materialization.test.js
```

### Claim-bound worker authority reader (prepared)

`composition-controlled-html-authority.service.ts` installs a resolver bound to
the validated queue claim in `createControlledRenderWorkerHost`. It accepts no
archive actor/draft, rejects foreign organization/revision/hash and RESUME render
requests, and issues one bounded/cancellable read without caching grants. The
common exact-response integrity verifier checks the returned native document,
historical HTML pointers, independent template anchors and current grants.

Prepared migration `20261005230000` fences the current queue lease and stored
request/job/revision/execution/issuer lineage. It resolves the actor from
`production_jobs.created_by` and the draft from the revision's newly recorded
`manifest.draft_document_id`, then verifies draft/composition ownership and calls
the exact HTML reader under the same transaction. There is no arbitrary actor,
draft fallback, latest revision substitution or re-render authority on RESUME.
Lease/execution/issuer time windows are checked again before returning. Older
revisions lacking this draft identity cannot use the new HTML path; legacy
non-HTML materialization never invokes this resolver.

Nine original directed reader tests use RPC fakes, not real authorization/SQL. The 35
lexical migration guards check only required source clauses, not PostgreSQL
syntax, lock order, RLS or concurrency. No migration, template, worker or backend
was activated. Acquisition and current image-identity checks are now prepared
below; the live snapshot producer still needs wiring and real transaction checks.

```powershell
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-controlled-html-authority.test.js
node scripts/test-controlled-html-authority-migration.mjs
```

### Used-image acquisition and current identity (prepared)

`prepareCompositionHtmlEditingSnapshotImages` prepares the exact authorized
historical bundle and acquires only images actually used by compiled HTML/CSS.
It checks current organization/draft links and QA status in scoped batched queries,
then validates PNG/JPEG/WebP, SHA-256, size up to 32 MiB, safe Storage path/bucket
and the shared 250-asset manifest budget. It never signs, downloads or uploads.
These separate reads are not atomic; permission/identity must be rechecked before
and after execution. The active snapshot route still rejects HTML until full
producer/assets/contract/render wiring is ready.

The claim-bound worker RPC now also returns independently stored image identities
under its link/asset locks. Reader requires exact coverage of the current granted
IDs. Controlled materialization compares every actually used image's checksum,
size, MIME, bucket and path with the frozen binding and local alias. Substitution
while an ID stays authorized rejects compilation or withholds a simulated result
after execution. Unused authorized template options need not match frozen bindings.
Legacy non-HTML paths remain unaffected; SQL/reader/host must deploy together.

Thirteen added directed tests cover acquisition scope/status/budgets/cancellation,
record coverage, identity drift and post-execution substitution. Metadata identity
is not image decode safety or pixel parity. Materializer streaming checks actual
downloaded bytes separately. No real DB/Storage/download/render was exercised.

```powershell
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-image-identity.test.js
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-snapshot-images.test.js
```

### Complete host archive preparation (not activated)

`prepareCompositionHtmlEditingSnapshotArchive` joins the exact producer/image
acquisition, original document/bundle, strict merged media manifest, byte-verified
packaged fonts, V4 edited-text/native-font contract, separate interactive preview
and local render compilation. It uses shared assembled-resource/ID admission and
puts restrictive CSP in the render entry. The expected animation-runtime SHA
is supplied independently by the host; this does not attest the executor itself.
Non-HTML media and packaged fonts must be independently authorized by the host.

After compilation, it repeats exact authority and image acquisition, rejects
revocation/identity drift and only then prepares an in-memory ZIP. It preserves
native source/hash, pins bundle/reference/contract/font bytes and returns archive
SHA/size through the bytes plus metadata/contract/manifests. Font input bytes are
copied before async compilation so caller mutation cannot replace packaged bytes.
Source/font/archive budgets and cancellation remain explicit. Media bytes are
not embedded: the worker must acquire/verify them into the exact local aliases.
No grant or temporary URL is persisted; freshness is never a durable permission.

Nine directed tests include prepared ZIP verification/materialization with
synthetic media, refresh revocation/substitution, conflicting and identical
asset records, runtime/font checks, copied fonts and cancellation. This is not
browser/render/decode or real database authorization evidence. The function does
not upload/register/activate a revision. Current snapshot routes remain fail-closed
until transaction-safe persistence/activation/reuse and UI/history/sandbox wiring
are complete and validated. No template/flag/migration/worker was enabled.

```powershell
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-snapshot-archive.test.js
```

## Authoritative backend still required

The basic parser/validator are **schema/preflight checks only**; the new server
wrapper checks manifest content integrity but does not authenticate provenance.
An asserted hash in a JSON binding is not evidence of authority. The future backend must authenticate
the actor, authorize document/organization ownership, fetch the authoritative
immutable manifest, invoke content verification against independently stored metadata,
independently verify its source digest and template
version, and provide that verified binding and freshly checked image grants.
Never accept `verifiedBinding`, `manifest`, or `grantedAssetIds` from the same
untrusted request as proof. The validator does not resolve image assets and does
not certify their MIME, bytes, hash, safety, or ownership itself.

Next integration blocks: authoritative digest/storage/issuance integration, assembled-template
instrumentation, shared gateway/OCC/undo persistence, restricted iframe protocol
and CSP/sanitization, inspector, identical compiler application for preview/render,
then adversarial and end-to-end QA. No free attributes, JS/CSS, raw HTML, charts,
reordering, or visibility operations are implemented in this V1 foundation.

For the binding/repository/reader/bundle/snapshot checks (52 directed tests):

```powershell
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.hyperframes-test.json
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-repository.test.js
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-reader.test.js
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-html-editing-snapshot-bundle.test.js
node apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__/composition-snapshot.service.test.js
```

These checks cover hash-bound V4 pointers, source drift, generic restore fencing,
legacy compatibility, exact preview/render fragment identity, historical pointer
selection, revocation, assembled IDs/resource admission, fail-closed behavior and
scoped RPC/ACK handling. RPCs are simulated; fragment identity is not pixel parity.
They do not connect to PostgreSQL, apply migrations or run a browser/renderer.

## Directed unit checks

### Prepared snapshot publication lifecycle

`../composition-html-editing-snapshot-publication.server.ts` runs the real archive
assembler before calling privileged host ports. It checks the immutable upload
ACK (bytes/hash/size/fixed bucket/content-addressed path) and the atomic commit
ACK (operation/scope/native+archive identity/active revision). Writes are single
attempt; failed or cancelled dispatched writes have an uncertain outcome and
must be reconciled, never blindly retried or compensated by deleting an archive.
Signals carry deadlines; host adapters must honor them. Storage/DB atomicity is
not possible: an orphan object can remain after a rejected transaction.

The Storage port now has a concrete implementation in
`../composition-html-editing-snapshot-storage.server.ts`: trusted HTTPS host/key,
create-only POST, no redirects, and bounded streaming full-byte readback on both
new upload and HTTP 409 conflict. It rejects unknown 400s rather than interpreting
provider messages. A writer policy is not bucket-wide immutable enforcement;
other privileged writers remain possible, so worker pins are still mandatory.
Eight Storage tests simulate HTTP with the actual prepared ZIP, no live service.
Neither port is installed in production. The concrete commit adapter in
`../composition-html-editing-snapshot-repository.server.ts` re-reads current exact
authority, validates frozen content, reconstructs the V4 contract and checks
pins/bindings before one bounded RPC. Prepared migrations `20261006000000` and
`20261006010000` supply private batched resource checks and transactional
register/reuse/link/activate/audit, with payload-bound operation receipts.
Replay reauthorizes, checks the stored revision and active state, and never
reactivates an older acknowledged revision. Seven repository tests simulate
RPCs; 29 lexical SQL guards are not SQL syntax/RLS/concurrency/atomicity proof.
No migration is applied. Read-only reconciliation now has a concrete adapter in
`../composition-html-editing-snapshot-reconciliation.server.ts` and prepared SQL
`20261006020000`: original actor/current role, exact scope/hashes, current grants,
resource identities and stored revision checks under root locks. It distinguishes
committed active/superseded/absent, preserves the historical ACK, and never writes
or permits an automatic retry. Publication errors retain immutable operation
identity so the host can explicitly query without regenerating a ZIP. NOT_FOUND
is not proof that Storage has no orphan; a registered result does not attest
current archive bytes or render. Nine new directed tests use simulated RPCs,
including lost commit ACK -> read-only recovery without a second compilation.
There are 45 lexical publication/reconciliation guards, not runtime SQL proof.
Durable identity is now recorded before any upload by the required
`recordPublicationIntent` port. Its concrete adapter is
`../composition-html-editing-snapshot-intent.server.ts`. The private intent table
is added to the still-unapplied `20261006010000` migration; commit requires an
exact matching intent. `20261006030000` prepares owner-scoped record/locator read
with current role/draft/composition/native-hash/active-revision CAS checks.
The locator holds identity/size/CAS only, not source/ZIP/grants/credentials, and
neither an intent nor absence is permission to retry. Retention must preserve
recovery/audit; purging actors/compositions/drafts needs a coordinated policy.

`../composition-html-editing-snapshot-host.server.ts` explicitly composes actual
intent/Storage/repository/reconciliation adapters. Recovery needs owner scope
and operation ID, reads saved hashes, then reconciles registration without
recompilation or upload. Trusted client/config must refer to the same Supabase
project; actor/org must come from authenticated host context. The opt-in POST
route below installs this host but remains disabled. Eight earlier tests include prepared ZIP ->
intent -> mock Storage -> lost commit ACK -> locator/reconciliation recovery.
There are 49 directed tests and 59 lexical guards in this selection; simulated
transport does not prove SQL runtime behavior. PostgreSQL validation and
real endpoint/operation-ID persistence validation and UI wiring remain required
before rollout; code-level transport is now connected below.

### Recovery HTTP route (disabled by default)

GET `/api/production/hyperframes/drafts/[draftId]/html-snapshots/[operationId]`
is installed behind server-only `COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED`.
Only literal `true` enables it; no environment value is set by this change.
It uses the separate read-only recovery composition, no Storage/write adapters.
The HTTP controller checks session/current tenant actor/reviewer without global
fallback, consumes shared org+actor quota (30/min), loads ACTIVE draft ownership,
then calls current-authority SQL recovery with server-derived composition ID.
Publication state is read-only; quota counters are an operational write.
Public output is a minimal registration/revision summary, never raw intent,
source/HTML/ZIP, Storage paths/URLs, grants or archive/native hashes. Responses
are private/no-store, correlated, and do not authorize automatic retries.
Eight controller tests mock auth/SQL; no actual authenticated HTTP or database
request is made. Migrations and real-session/RLS/concurrency validation are
required before enabling. A disabled-by-default recovery panel and local locator
are now connected; automatic operation-ID capture and publication HTTP transport
are implemented below, including the opt-in editor action. This route is not HTML
editorial feature completion.

### Editor registration/recovery action (disabled by default)

The delivery recovery panel now also offers explicit saved-HTML registration.
Both public publication/recovery flags must be literal `true`; neither is set.
NativeCompositionPreview supplies saved hash, active CAS/profile and known
snapshot history. Pure admission and click-time refs/save-queue checks block
unsaved/error/staged preview, other operation/render, unknown history/tracking,
invalid identities, missing Storage/Web Locks and existing pending locator.
These UI gates are not authority; the server independently checks it.

One keyed actor/org/draft request boundary separates account/tenant changes and
prevents simultaneous publish/consult. Registration or terminal recovery refresh
revision metadata only, preserving document/current profile. History becomes
unknown during that refresh and stays unknown on failure, blocking new writes;
failure after confirmation is not relabeled as failed publication or retried.
Later document edits are not overwritten or included in the previously sent
saved revision. Closing tracking requires terminal result for the exact local ID
and rechecks expected ID; a substituted locator cannot be cleared by an older ACK.

Eight new pure admission/close tests and the twelve-file selection pass 111 tests;
test TypeScript and final web type check pass after the latest changes.
React mounting/interaction/browser and real auth/HTTP/SQL/RLS/Storage/
render are NOT verified here. No flags/migrations/rollout are enabled. Snapshot
history refresh is not the remaining HTML editorial command/history/inspector/
sandbox/catalog/bootstrap workflow. HyperFrames/core preserve timing/document
and separation of snapshot registration from rendered/execution attestation.

### Publication HTTP and client transport (disabled by default)

POST `/api/production/hyperframes/drafts/[draftId]/html-snapshots` now installs
`publishAuthorized`. It requires literal `true` for BOTH server publication and
recovery flags; neither is configured/enabled. Strict input is operation ID,
saved document hash, expected active revision and registered profile ID only.
The controller checks exact Origin, JSON, method/IDs/URL, current authenticated
tenant actor and explicit reviewer role, plus shared org10/min and actor3/min
quotas. Body parsing is streaming-bounded to 4 KiB with deadline/cancellation.
Composition, latest document hash and active revision come from tenant-scoped
server reads. Stale state or an existing intent returns conflict without another
archive/upload. SQL commit still reauthorizes/revalidates/CAS under locks.

`COMPOSITION_HTML_SNAPSHOT_EXECUTION_CONTRACT_JSON` is operator-owned expected
execution configuration, strictly parsed and limited to 16 KiB. No default or
request-supplied pins; the GSAP runtime hash is computed from the local runtime.
Expected pins do not prove matched files/browser, execution, isolation or render.
After a valid commit ACK the controller independently recovers current state;
historical active-at-commit is not relabeled as today's active revision. Public
output is minimal, correlated/private/no-store, with no raw intent/hash/Storage
URLs/source/credentials. Failure never authorizes automatic retry or rollback.

`../composition-html-snapshot-publication-http.client.ts` connects the tracked
client lifecycle to a single same-origin POST after persisting its locator. It
shares the 16 KiB strict summary decoder with recovery. UI action is now connected
as described above. Fourteen earlier tests include in-memory client -> controller
transport; the eleven-file selection passes 103 tests and both TypeScript builds
pass. Auth/RPC/Storage are mocked: real session/HTTP/browser/PostgreSQL/RLS/locks/
concurrency/Storage/render and formal QA remain unverified. No migrations/flags/
rollout are activated, and the legacy snapshot route remains fail-closed for HTML.
Large synchronous ZIP preparation has memory/CPU/hosting-SLA risk: quotas and
deadlines are not capacity evidence or a 100000-user scalability guarantee.
Operational capacity/backpressure/queue gates must precede rollout.

### Authorized native-resource acquisition (host only)

`createHtmlEditingSnapshotHost.publishAuthorized` obtains the exact historical
document under actor/tenant authority, acquires native media/fonts independently,
then calls the concrete publication lifecycle. Caller-supplied extra manifests,
font bytes or URL maps cannot override these acquired resources. Trusted runtime
settings and authenticated actor/org are still the host caller's responsibility.

`../composition-html-editing-snapshot-media.server.ts` uses bounded batched reads
with org/draft links, exact UUID coverage and current production status;
branding must be APPROVED (not ARCHIVED), SFX READY and draft-linked. Deck
dependency candidate lists are bounded too; only used aliases enter the manifest,
and ambiguous URL ownership/cross-origin UUID collisions reject acquisition.
Public URLs are substitution keys, never network destinations or permissions.

`../composition-html-editing-snapshot-fonts.server.ts` acquires only native text/
caption font references owned by the tenant, READY and uploaded. It checks family,
fixed font bucket, safe path and manifest limits before sequential bounded HTTPS
authenticated GETs, no redirects/retries/signed URLs. A shared deadline and
stream cancellation apply; MIME, size and SHA-256 must exactly match. Bytes are
synthetic in tests: identity is not decode/font safety or render attestation.

These multiple reads are not a transaction. Commit and worker resource identity
revalidation remain mandatory. Eleven new tests include concrete host acquisition
through real ZIP assembly with simulated Storage/RPC and revoked native resource
rejection before intent/upload. The ten-file selected suite passes 89 tests and
the test TypeScript build and web type check pass after revalidation.
No authenticated publication endpoint/UI/flags/migrations/rollout are enabled.
The separate legacy route still rejects editable HTML; the new route is opt-in.

### Client recovery tracking (disabled by default)

`CompositionHtmlSnapshotRecoveryPanel` is mounted in video delivery behind
`NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED` literal `true` (not set).
The server flag is independent and also remains disabled. A user explicitly
enters an operation ID or consults an existing locator; no polling/publication
retry occurs. The shared public summary contract rejects mismatched identities,
impossible active states and automatic-retry proposals. Client GET uses a 15s
deadline, cancellation and a bounded 16 KiB JSON stream.

The V1 localStorage locator contains only actor/org/draft/operation ID and creation
time. Scope changes remount the panel and cancel requests; stale responses cannot
enter the new context. Another pending operation or corrupt stored slot is never
silently overwritten. Uncertain results retain tracking; explicit terminal close
checks the expected operation ID before removal. Storage denial/quota failure does
not claim durability. localStorage operations are not atomic CAS across tabs.
No HTML, hashes, grants, signed URLs or credentials are persisted in the locator.
The connected HTTP publication transport saves the operation ID before dispatch;
manual recovery entry alone does not implement that publication workflow.

`../composition-html-snapshot-publication.client.ts` now prepares that lifecycle:
generate a UUID, require newly saved locator before one host dispatch, validate a
terminal operation-matching summary and keep tracking on success or uncertainty.
`../composition-html-snapshot-publication-lock.client.ts` provides immediate
exclusive Web Locks per owner/org/draft. No Web Locks/storage, an existing locator
(including the same ID) or corrupt slot means no dispatch; there is no unsafe
fallback. Locks coordinate cooperative same-origin callers only, not server
authorization/idempotency or noncooperative localStorage writers. Waiting is
bounded to 120s with cancellation; it cannot undo an in-flight server commit.
Late transport rejection is observed, never retried. A superseded confirmation
is historical, not permission to activate it.

This coordinator is wired into authenticated publication HTTP and the opt-in
editor UI action. The old snapshot route remains fail-closed for
editable HTML; the separate new route installs authorized acquisition and host.
Nine new unit tests include the mocked Web Lock adapter and concurrency port,
before-dispatch persistence, pending/corrupt/denied storage, lost/invalid ACK,
noncooperative cancellation and superseded result. The current nine-file selected
suite passes 78 tests; web and test TypeScript pass. This is not a real browser,
cross-tab, HTTP, SQL or Storage validation and does not authorize rollout.

Twelve new pure client tests and the selected eight-file suite (69 tests) pass,
as do web/test TypeScript checks. Browser rendering, real auth/HTTP/SQL/RLS/locks,
Storage and render are not tested here; formal QA and migration rollout remain
deferred. Recovery state does not alter the document, preview or render contract.

The implemented transaction is intended to
reauthorize the actor/draft/composition, revalidate current templates/grants and
all image/media/font identities under locks, check native/active revision CAS,
bind operationId to the full payload, and insert/reuse+link+audit+activate in one
transaction. An existing object path is not evidence of matching bytes. Eight
directed lifecycle tests use simulated ports with the real in-memory assembler;
they do not prove these repository obligations or authorize rollout.

From the workspace root (no browser, media process, or external service):

```powershell
node node_modules/typescript/bin/tsc -p apps/web/src/domains/production/composition-editor/html-editing/tsconfig.unit.json
node apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit/html-editing-validation.test.js
node apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit/html-editing-manifest-digest.test.js
node apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit/html-editing-override-reducer.test.js
node apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit/html-editing-compiler.test.js
node apps/web/src/domains/production/composition-editor/html-editing/.tmp/unit/html-editing-revision.test.js
```

The isolated config emits only this module into its ignored `.tmp/unit` directory,
so it cannot overwrite the shared HyperFrames test build. This does not replace
formal QA, authorization tests, source attestation, or preview/render parity.
There are 55 isolated directed tests: 10 preflight, 8 digest/verified-wrapper, 10
atomic reducer tests, 12 static-fragment compiler tests and 15 revision/gateway tests
(repository simulated). This includes an explicit fixed preimage and independently
calculated SHA-256 vector, immutable snapshots, reset/no-op, invalid late writes,
stale identity, revoked grants, and prior/resulting state budgets.
# Preparación inicial de plantilla (sin activación)

`prepareInitialHtmlEditingRevision` recibe ancla del documento guardado y una declaración
de plantilla confiable independiente (`courseforge-html-editable-template-v1` con
templateId/templateVersion/sourceSha256/elements). Comprueba source exacto, deriva
bindings/digests y compila la revisión 1 con overrides vacíos mediante las políticas
existentes. No instrumenta HTML arbitrario, no cambia timing/source/hash nativo y
no registra en base de datos. No debe exponerse como permiso para declarar targets
desde el cliente: el host debe resolver catálogo, source/ancla y grants actuales
independientemente y revalidarlos con CAS al registrar. Catálogo/wiring de registro,
inspector/historia editorial UI y sandbox siguen pendientes. Seis tests nuevos;
61/61 pruebas aisladas HTML aprobadas; no QA formal ni DB/browser/render reales.

# Registro inicial host (preparado, no activo)

`SupabaseHtmlEditingRevisionRepository.registerInitial` conecta preparación con
`register_html_editing_template_v2` y una lectura autorizada exacta de versión 1,
SHA y hash nativo esperado. Verifica permisos actuales en readback; requiere ACK
booleano incluso en reuse. Un resultado perdido o distinto queda sin confirmar,
sin retry/rollback. La migración 20261006050000 prepara recheck de grants usados
en la misma transacción; no se ha aplicado. El host debe resolver independientemente
catálogo/source/ancla/grants: ningún endpoint puede reenviar declaraciones del cliente.
No hay catálogo/adquisición/wiring de endpoint ni pointer inicial automático.
Seis tests nuevos; 93/93 HTML+repositorio aprobados, RPC simuladas; guards SQL solo
léxicos, sin prueba PostgreSQL/RLS/concurrencia/QA/browser/render reales.

# Catálogo instalado (host-only)

`HtmlEditingTemplateCatalog` valida configuración V1 independiente del operador,
tenant explícito, máximo 4 MiB/32 templates, límites por declaración y unicidad
template/version. Lookup exige organización/version/sourceSHA exactos; no fallback
global ni fetch remoto. `registerInstalled` deriva SHA del source host acotado y
obtiene template del catálogo, nunca JSON declarado por cliente. Lectura autorizada
de source/ancla/grants sigue pendiente de wiring. Parser/digest no prueban confianza;
configuración nueva no revoca automáticamente templates registrados previamente.
Cinco tests nuevos; 98/98 HTML+repositorio pasan, RPC simuladas y sin QA real.

# Bootstrap con lectura autorizada (preparado)

`CompositionHtmlEditingBootstrapHost.register` acepta scope actor/org/draft/clip,
selección template/version y hash guardado esperado. Actor/org requieren derivación
auth/tenant del host; no source/grants/ancla del request. Reader RPC preparado
`read_html_editing_bootstrap_context` obtiene documento guardado/ancla de snapshot
activo y recursos actuales del draft. Host verifica schema/hash/scope/DECK sin pointer
previo, resuelve template exacto, filtra permisos por allowlist y conecta registro
con CAS/grants/readback. Ancla snapshot es issuance, no igualdad con el draft posterior.
Lectura no otorga permiso durable; registro revalida en otra transacción. SQL
20261006060000 no aplicada; sin endpoint/catálogo real/flags/browser/render/QA formal.
Diez tests nuevos, 108/108 HTML+repositorio+host pasan; RPC simuladas, no DB/RLS real.

# Endpoint de inicialización (opt-in, deshabilitado)

POST `/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/initialize`
requiere `COMPOSITION_HTML_EDITING_INITIALIZATION_ENABLED` literal `true` y
`COMPOSITION_HTML_EDITING_CATALOG_JSON` privado del operador, tenant-scoped.
No se han configurado. Body strict `{templateId,templateVersion,expectedDocumentHash}`
máximo 4 KiB; jamás HTML/grants/actor/org/ancla. Controller deriva auth/tenant,
exige reviewer y Origin exacto, cuotas compartidas org 10/min y actor-org 3/min,
deadline 60 s y streaming body 15 s. Host revalida documento/recursos/CAS.
201 creación/200 reuse solo tras confirmación exacta; 409 conflicto y 503
incertidumbre con retryable=false. No auto retry ni render/pointer nativo.
Falta endpoint de lectura/edición editorial e inspector/history/sandbox/gates.
Nueve tests nuevos; 117/117 selección HTML+repo+host+controller aprobados,
dependencias simuladas, sin sesión/HTTP Next/SQL/QA formal/render reales.

# Lectura editorial del inspector (opt-in, deshabilitada)

GET `/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]` requiere
`COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED` literal true, no configurado. Auth/tenant/
reviewer preceden cliente privilegiado; cuotas shared org 120/min y actor-org 30/min,
deadline 20 s, view 2 MiB, same-origin, no-store y correlación. Repositorio autorizado
verifica identidad/hash native y template. Proyección expone manifiesto/overrides,
defaults texto/UUID/choice y digests/versiones, nunca source/HTML/URLs/paths.
Defaults de texto son valores literales: usar React/textContent, nunca innerHTML.
Grants actuales van separados: recurso revocado es inspectable/removible, no autorizado.
`usedResourcesGranted` verifica solo pertenencia a grants; no bytes/decoding/render/paridad.
No inicialización/modificación/render implícitos; cuotas sí escriben counters. Resta
comandos/restore autenticados e inspector/history UI/sandbox/gates operativos/reales.
Once tests nuevos, 128/128 selección aprobada y TypeScript web/build pruebas pasa,
dependencias simuladas; no QA formal/SQL/sesión/HTTP Next/browser/render reales.

# Comandos/restauración autenticados (opt-in, deshabilitados)

POST de la ruta editorial requiere gates `COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED`
e `COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED` literal true, no configurados. Contrato:
COMMAND `{action,expected:{version,sha256},expectedCompositionDocumentHash,overrides}`;
RESTORE reemplaza overrides por `restore:{version,sha256}`. No binding/source/HTML/
grants/actor/org del cliente. Host resuelve binding actual/historia exacta antes del
gateway/CAS; reader histórico RPC preparado `read_html_editing_restore_revision`
revalida autoridad actual y source/manifiesto idénticos. SQL 20261006070000 no aplicada.
Restore aumenta versión y valida permisos actuales; no-op no escribe. Cuotas org
30/min + actor-org 12/min, body 64 KiB/15 s, request 60 s, same-origin/no-store.
ACK before/next locators es histórico, no latest/render: refrescar GET/hash nativo.
Incertidumbre sin retry/rollback; CAS evita replay cambiado, GET no atribuye autor
causal de una escritura incierta. Falta inspector/history UI/reconciliación client/
sandbox/gates reales. Nueve tests nuevos; 137/137 selección y TypeScript pasan,
RPC simuladas y guards SQL léxicos, no DB/QA formal/sesión/HTTP Next/render reales.

# Inspector de lectura y client (sin activación)

`CompositionHtmlEditorialInspector` aparece para clip DECK solo con flag público
`NEXT_PUBLIC_COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED` literal true (no configurado).
Consulta única explícita, keyed actor/org/draft/clip/hash; cancela cambios de contexto
y rechaza view de hash distinto. Muestra solo React texto/UUID/choices, no HTML/URLs.
No escribe/poll/render/rebase automático. Transporte client GET/POST único relativo
valida scope/contrato/correlación/CAS, bytes/UTF-8 y cancelación mediante decoder
compartido con snapshots; fallo postdispatch incierto, sin retry.
`HtmlEditingEditorialHistory` es local a sesión, máximo 100 locators undo/redo,
requiere refresh tras ACK y pierde historia en drift/incertidumbre; consultar no
atribuye autor causal. Callers deben owner-key instancia y desecharla en logout.
POST e historial aún no están conectados a botones UI: requieren fence cola nativa,
tracking durable antes de dispatch y rebase autorizado de payload. También falta
inicialización UI/sandbox/gates reales. Siete tests nuevos; 165/165 selección con
regresión snapshots y TypeScript aprobados; no montaje/QA formal/browser/DB/render.

