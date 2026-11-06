import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compiled = path.resolve('apps/web/.tmp/hyperframes-tests/domains/production/composition-editor');
const load = (file) => require(path.join(compiled, file));
const schemas = load('composition-document.types.js');
const fonts = load('composition-font-references.js');
const { buildCaptionEffectPlan } = load('composition-caption-effects-plan.js');
const { hashCompositionDocument } = load('composition-document-hash.js');
const { createCaptionEffectsFixture } = load('__tests__/composition-caption-effects.fixtures.js');
const { createTransitionDocument } = load('__tests__/composition-transition-test-fixtures.js');
const label = process.argv[2];
if (!['before', 'after'].includes(label)) throw new Error('Indicar before o after.');
const caption = createCaptionEffectsFixture();
caption.clips[0].source.style.fontAssetId = '10000000-0000-4000-8000-000000000001';
const documents = [caption, createTransitionDocument()];
const snapshot = { documents: [], invalid: [], defaults: null, fonts: null };
for (const document of documents) {
  const parsed = schemas.compositionEditorDocumentSchema.parse(document);
  snapshot.documents.push({ document: parsed, hash: hashCompositionDocument(parsed),
    plan: buildCaptionEffectPlan(parsed), fonts: [...fonts.compositionFontReferenceDetails(parsed)] });
  for (const mutate of [
    (candidate) => { candidate.clips[0].id = '../invalid'; },
    (candidate) => { candidate.clips[0].layout.opacity = 2; },
    (candidate) => { candidate.clips[0].sourceOffsetSeconds = -1; },
    (candidate) => { candidate.clips[0].kind = 'DECK_SLIDE'; },
    (candidate) => { candidate.clips[0].freezeTailSeconds = 100; },
  ]) {
    const invalid = structuredClone(document);
    mutate(invalid);
    const result = schemas.compositionEditorDocumentSchema.safeParse(invalid);
    assert.equal(result.success, false);
    snapshot.invalid.push(result.error.issues);
  }
}
const clip = structuredClone(documents[0].clips[0]);
delete clip.hidden;
delete clip.layout.opacity;
delete clip.layout.rotation;
delete clip.layout.zIndex;
snapshot.defaults = schemas.compositionClipSchema.parse(clip);
const reference = { fontAssetId: '10000000-0000-4000-8000-000000000001', fontFamily: 'Arial' };
snapshot.fonts = { parsed: fonts.compositionDeckFontReferencesSchema.parse([reference]), invalid: [] };
for (const input of [[], [reference, reference], [{ ...reference, url: 'https://example.invalid/font' }],
  [{ ...reference, fontFamily: '</style>' }]]) {
  const result = fonts.compositionDeckFontReferencesSchema.safeParse(input);
  assert.equal(result.success, false);
  snapshot.fonts.invalid.push(result.error.issues);
}
const file = `.tmp/module-graph/contracts-${label}.json`;
fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
if (label === 'after') {
  assert.deepEqual(snapshot, JSON.parse(fs.readFileSync('.tmp/module-graph/contracts-before.json', 'utf8')));
}
console.log(`Contratos ${label}: ${snapshot.documents.length} documentos, ${snapshot.invalid.length} casos inválidos, defaults y fuentes${label === 'after' ? '; equivalencia exacta aprobada' : ''}.`);
