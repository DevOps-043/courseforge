# Packaged HTML-editing preview runtime

This is CAP-029's private transport adapter, not a new player or renderer. It
delegates commands to the existing trusted compiler controller. The shared
compiler, legacy preview and render target are unchanged.

From `apps/web`:

```powershell
node tools/html-preview/build-runtime.mjs
npx tsc -p tsconfig.hyperframes-test.json --outDir .tmp/cap029-tests
node --test --test-isolation=none .tmp/cap029-tests/domains/production/composition-editor/__tests__/composition-html-editing-preview-runtime.test.js .tmp/cap029-tests/domains/production/composition-editor/__tests__/composition-html-editing-preview-resources.test.js
```

Build uses the currently installed esbuild, emits a standalone IIFE and pins all
source inputs plus the bundle. It performs no request-time compilation. Outputs
are `.tmp/html-preview-runtime/runtime.js` and `manifest.json`; rebuild after any
pinned input changes. Missing/stale/oversized packages fail closed. Tests require
the build first and do not download dependencies or start a browser/renderer.

`prepareCompositionHtmlEditingSecurePreview` accepts **operator-configured**
`runtimeWebRoot` and canonical `parentOrigin`, plus an authorized exact document
request. Neither operator setting may be taken from a request payload. It loads
the package before acquisition, reuses portfolio authorization/budgets and final
recheck, then mounts the transport and computes CSP. Mount failure disposes the
private spool. The caller must dispose a successful result on all exit paths.

Mounting checks the known compiler controller transport ABI and the document
hash/generation. ABI drift rejects rather than falling back to window messaging.
Only the parent handshake uses window messaging; commands/events use one private
MessagePort. ACK means the handler completed, not that media rendered, persistence
committed or permission was granted. Opaque origin alone is never authority.

## Deployment and validation requirements

- The low-level secure-preparation result uses local aliases. The page issuer
  binds them to authenticated capabilities, mounts initial resource metadata and
  computes the final CSP; do not serve the low-level unbound result directly.
- Saved HTML previews and their comparison baseline now adopt the private
  transport and automatic resource renewal in code. No flags, API activation,
  catalog registration or deployment are performed by the build tool.
- `.tmp` is ignored and this artifact is not automatically part of deployment.
  Packaging must include the generated runtime/manifest and all pinned inputs.
  Source pins detect stale packages, not signed execution or OS isolation.
- Tests cover Node MessagePorts, bundle execution in VM and compiled HTML/CSP
  structure; they do not establish browser CSP enforcement, visual parity, actual
  media/font decoding, authenticated HTTP, DB/RLS or manual QA acceptance.

Do not broaden CSP to signed remote assets, add `allow-same-origin`, buffer the
whole media portfolio, or add an automatic legacy fallback to finish delivery.

## Binary resource route prepared (2026-10-08)

`GET /api/production/hyperframes/drafts/{draftId}/html-preview/resources?cap=...`
is a Node route backed by `deliverCompositionHtmlEditingPreviewResource`. It does
not issue capabilities or accept caller-supplied actor, tenant, resource path,
Storage metadata or grants. A dedicated HMAC key verifies exact authorized issuer
claims. The exact HTML RPC checks CURRENT membership/reviewer role/templates and
grants, with native/font identity rechecks before acquisition and before response.
The capability additionally pins the frozen bundle and entire inventory fingerprint.

Operator prerequisites (not configured or activated by development):

- Existing `COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED=true` must be approved.
- `COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY`: dedicated random32-byte key,
  encoded as64lowercase hex chars, managed as a secret and shared across instances.
  Never reuse Supabase/Auth/service-role keys. Rotation invalidates old capabilities.
- `COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN`: trusted canonical app origin,
  HTTPS or local HTTP. Not request Host/Origin-derived configuration.
- `NEXT_PUBLIC_SUPABASE_URL` and the existing exact-reader SQL prerequisites.
- Gateway/CDN/access logs must redact the `cap` query completely. Tokens are bearer
  credentials: never place them in telemetry, referrers, localStorage or persistent
  documents. Responses are private/no-store/no-referrer. App logging uses only
  safe event codes and request IDs.

Capabilities expire180seconds after issuance and are rechecked after spool
verification/reauthorization. Origin:null is permitted for font/media CORS ONLY
after capability verification, with no credential allowance. External caller
origins and document/script/navigation destinations are rejected. This route does
not use iframe cookies to establish identity or trust opaque origin as authority.

Full-file size/SHA verification on the same descriptor precedes even a small byte
range. Bounded64KiB pulls support200/206, single open/suffix ranges and backpressure;
invalid ranges return416. EOF, cancel, abort and failures dispose the owned file.
Request/stream timeouts are bounded; shared actor/org quota counters fail closed.
Per-delivery-pool admission allows at most4reads/2GiB of private disk per instance,
held until successful cleanup. Failed acquisition cleanup retains uncertain disk
reservation. This is not fleet-wide admission or a quota over OTHER preparers.

Residual work: parent host MessagePort wiring, capability expiry/renewal,
key/packaging approval, proxy log redaction,
crash retention/reclamation and actual-browser/manual checks. A private range
request currently acquires/verifies the complete resource again; no shared cache
or new job engine is introduced. Measure seek latency and production load before
acceptance; do not claim100000-user scalability from these bounded local tests.

Focused build/tests (includes the actual new route and shared ambient declaration):

```powershell
npx tsc -p tsconfig.html-preview-test.json
$previewTests = @(rg --files .tmp/html-preview-tests/domains/production/composition-editor/__tests__ | Where-Object { $_ -match 'composition-html-editing-preview.*\.test\.js$' })
node --test --test-isolation=none @previewTests
```

Platform rationale: [MDN Blob URL storage partitioning](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob#storage_partitioning)
does not permit assuming parent-created Blob URLs are fetchable in an opaque
frame. [CSP3](https://www.w3.org/TR/CSP/) and browser enforcement still require real
integration validation; the endpoint tests do not substitute that evidence.

## Authenticated page issuer and bindings (2026-10-08)

`GET /api/production/hyperframes/drafts/{draftId}/html-preview?documentHash={sha256}&r={generation}&nonce={nonce}`
now provides the compiled CSP-bound page. The query accepts ONLY the exact document
hash, canonical generation integer and64lowercase-hex handshake nonce. The nonce
is created by the parent with `createHtmlEditingPreviewSession`; it correlates the
frame's private channel, not permissions. Role/actor/tenant come from authenticated
server context, followed by the exact reader's current authorization checks.

The page issuer reuses the pinned runtime and authorized portfolio preparation.
Only after the final recheck does it issue resource capabilities from verified
snapshot/inventory identities. DOM resource attributes and CSS URL sinks get
these endpoint URLs; scripts, text, quoted CSS content, fragment references and
native hashes do not get global string replacement. Unknown/variable/remote
references and malformed URL syntax fail closed. PostCSS is already used by the
project; no transitive CSS parser or new dependency was added.

CSP allows img/media/font loads ONLY from this draft's exact binary endpoint,
without embedding capabilities in the CSP header or broadening to Storage hosts.
Script/style hashes are rebuilt over the actual serialized page; sandbox,
connect/worker/frame/object restrictions remain. Preparation spools are disposed
before returning the page. Each binary GET still reauthorizes independently.

Joint portfolio preparation and binary delivery now share the same4-operation/
2GiB admission per instance; static pages reserve a zero-byte operation slot.
The older standalone image/font/media preparers are not covered by this shared
admission. Failed/uncertain cleanup keeps its reservation; crash reclamation and
fleet admission remain explicit deployment work, not guarantees from this guard.

Parent host adoption is now wired in code for saved documents containing editable
HTML, including the captured comparison baseline. Non-HTML, preset and agent
previews retain their existing routes. The host transfers one private port and
reuses the existing player/event handler/visual-patch coordinator; queue admission
is not a persistence or visual-result ACK. Commands remain ordered, with only
adjacent idempotent commands coalesced. The queue, cadence and handshake timeout
are bounded; port/bootstrap/owner failures close without retry. Auth/tenant changes
close even idle hosts and blank their iframe. Owner identity is pinned before
navigation, so a delayed load cannot adopt a newly selected owner. Frame teardown
pauses the existing controller; no additional playback clock is introduced.

Outstanding work includes capability renewal/expiry behavior and the full
R19–R22 audit/manual-QA handoff. Wiring is not evidence of mounted browser behavior.
No
secrets/flags/SQL/template registration/deployment were activated. Browser cookie
and opaque-frame CSP/CORS behavior, real fonts/media and visual parity still need
the planned integration checks. A capability expires180seconds after issuance;
do not call long-play/seek readiness complete without renewal behavior.

Renewal issuer preparation (not yet an automatic browser renewal loop):
`GET .../html-preview/renew?documentHash=...&r=...&nonce=...` uses the same
authenticated exact-snapshot issuer, role checks and shared page quotas. It returns
strict bounded JSON with session, bundle/inventory fingerprints, issuance/expiry
and resource capability URLs only. It does not return private Storage locations
or accept actor/grants/signing-key claims. Each renewal currently reacquires and
verifies the portfolio before issuing; this is intentionally not a cheap lease
extension and needs production load measurements. Resources still reauthorize at
delivery. Cleanup finishing after expiry or clock rollback cannot return tokens.

The client helper makes one credentialed no-store read, rejects redirects and
bounds streaming response bytes; it validates exact session/fingerprints/endpoint
and at least30seconds remaining. It owns no schedule, document writes or retries.
Applying renewed URLs inside the opaque frame, preserving media state, scheduling,
expiry teardown and end-to-end long-play/seek tests are STILL outstanding. Do not
interpret the new endpoint as evidence that visible playback already renews.

The separate lifetime controller is implemented and tested with controlled clocks:
it starts from the issuer's pinned manifest, consults once60seconds before expiry,
checks session/bundle/inventory/resource-set continuity, and commits the next
lifetime only after its injected frame-application acknowledgment resolves.
A separate hard-expiry timer aborts stalled reads/applications; wall-clock rollback,
monotonic regression, owner drift, read/apply failure or replay closes once without
retry. Disposal aborts work and suppresses late callbacks. The owning host must
connect its cancellation signal and an actual private-port application adapter;
that integration and state-preserving DOM/media updates remain outstanding.

Private resource transport is now available as an explicit channel opt-in:
RESOURCE_STATE flows frame→parent, RESOURCE_UPDATE parent→frame. Default legacy
channels reject both. BEGIN pins metadata/count, BATCH carries at most4resources,
COMMIT waits for the receiver's application callback before its ACK. Max512entries,
2MiB total and48KiB wire bodies stay below the64KiB envelope limit. Sender uses
stop-and-wait/50ms cadence and abort closes its exclusively owned channel. Receiver
stages only, rejects gaps/duplicates/replay/drift, expires incomplete assembly
after15s and suppresses late completion. It does not mutate DOM or media itself.
The integration described below now opts in and owns send serialization; these
low-level helpers must not be called concurrently with another channel sender.

## Automatic renewal wired in the saved HTML preview

This section supersedes the earlier historical renewal integration TODOs above.
The issuer inserts a CSP-hashed initial-resource bootstrap before the existing
controller. Frame sends that manifest over its resource queue; host validates it
and starts the lifetime controller. Updates use the same exclusive send slot as
editor commands (commands remain ordered/bounded while transfer runs). Frame stages
batches and applies only on COMMIT. A validated resource signal establishes runtime
liveness, not READY, so initial manifest transfer does not trip the legacy5s
handshake timer. Assembly/ready/expiry limits remain independent.

The updater preflights URL sinks and CSSOM with explicit node/rule/property limits.
It rewrites neither innerHTML, script/text nor style-element text; source/document
hashes and overrides remain unchanged. Inline CSS uses setProperty, SVG attributes
retain namespaces, and changed media reload once. Runtime pauses, reapplies the
current composition position and preserves playing/paused/buffering intention via
the original controller, with no second playback clock. Metadata arrival resyncs
the CURRENT intention, never a stale captured user seek. Old listeners are aborted
on a new update/disposal. ACK means URLs applied, not decoded frames/fonts ready.

Runtime has its own hard expiry even when parent is unavailable. Host owns renewal
timeouts/cancellation; secure failure blanks the corresponding iframe. No legacy
fallback, reload/adoption of another revision or automatic editorial retry.
Tests use real Node ports and controlled clocks for two successive cycles and
expiry/revocation, but DOM/CSSOM/media/controller are fixtures. Browser CSP/CSSOM,
real range requests/codecs/fonts, playback continuity and visual parity remain QA
and integration evidence to obtain; no product acceptance follows from mocks.
