# Slide copy repair (pipeline v9)

v9 rejects numbered draft headings (Idea/Escena N), the observed template
instructions, and content explanations shorter than 60 normalized characters
excluding the title. Covers, transitions and charts are exempt from that minimum.
This is a minimum completeness heuristic, not a guarantee of pedagogical quality
or factual grounding. It also applies to manually supplied content at final QA.
The synthesis prompt requests 2-3 evidence-backed points and explains the repair
requirements. Empty model bullets no longer silently inherit draft bullets.

Narration leakage now measures copied consecutive eight-word phrases rather
than shared topic vocabulary, retaining direct-copy detection while allowing
grounded paraphrases. Closing layouts now render generated bullets (previously
only paragraph/callout text or subtitles were shown). No typography limits or
duration requirements were increased. Missing evidence remains a blocking issue.

v8 fixes duplicate slide identities when expanded script sections repeat their
editorial section_number (observed sequence: 1, 2, 3, 3, 3, 3, 4). Both planning
and materialization derive IDs from array position plus visual part; storyboard
IDs likewise use position rather than take_number. Duplicate IDs are blocked
before provider calls and flagged by final QA. Regenerate v7 decks to apply this.

Normal and standalone generation share the slide generation worker. Copy is
processed sequentially in batches of four, with two attempts per available
provider. A seven-minute copy budget reserves worker time for rendering and
asset persistence; individual provider calls retain their 60-second timeout.

Each response is checked using the same visible-copy rules as final QA. Valid
slides are retained. Missing or invalid slides are requested again; malformed
JSON and transport failures are recoverable within the attempt limit. Unknown
or repeated IDs reject that response. Approved copy is supplied as context to
later requests, allowing duplicate detection and repair across batch boundaries.

Evidence retrieval ranks all available insights for each pending slide using
lexical overlap and planned source references, selecting up to three per slide.
This is a retrieval heuristic, not a factual-entailment validator. Planned source
references are explicitly labeled PLANNED in the audit and must not be interpreted
as model-confirmed citations.

If attempts are exhausted, only unfinished slides return to their original
draft. The fallback is validated and audited; an invalid deck is still returned
to the orchestrator to preserve diagnostics, but final QA blocks asset upload
and DECK_READY. The audit distinguishes GENERATED, VALIDATED_FALLBACK and REJECTED
with finding codes. Missing evidence is not repaired by inventing more content.

Storyboard planning supports 23 content slides plus cover (24 total), and may
add distinct evidence slides to meet the duration contract. Chart slides share
that total budget. Insufficient coverage remains a blocking error.

## Diagnosis

HTTP 202 only acknowledges queue submission. Inspect the failed production job:
output_snapshot.qa_report.findings identifies the affected slide and rule;
output_snapshot.stages contains visible_copy_synthesis.output.batches with
attempts, planned references and per-slide outcomes. These fields now survive a
QA failure as well as success. Failures before generation have empty stages.
The polling endpoint still returns job status/provider_error, not this full audit.

Pipeline v9 participates in both queued-job identity and prepared-deck signatures
so new requests do not reuse a v8 result. Historical assets remain unchanged until
regeneration. No migration is needed.

## Verification

Run npm run test:remotion from apps/web. Regression coverage includes accent and
punctuation equivalence, partial responses, truncated JSON, selective repair,
cross-batch duplication, late evidence retrieval and long storyboards. Provider
calls are mocked: validate a real long deck in the local UI before rollout.
v9 regressions reproduce both reported screenshots, selective sparse-copy repair,
missing bullets, rejected fallback, grounded paraphrases and closing bullet HTML.
Restart a production-mode local server after rebuilding; in development, ensure
the new job reports copy_pipeline_version=visible-copy-synthesis-v9. Restarting
alone never repairs an already persisted deck: it must be regenerated.
