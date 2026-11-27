import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixture from '../../publication/contracts/fixtures/hybrid-package-v2.json';
import { hybridPublicationPackageSchema } from '../../publication/contracts/hybrid-publication-package';

test('conserva el paquete completo sin destino de impartición y con datos privados', () => {
  const publication = hybridPublicationPackageSchema.parse(fixture);
  const { template } = publication.session_preparations[0];
  assert.equal(template.preparation.documents?.length, 14);
  assert.ok(template.preparation.speaker_notes[0].content);
  assert.equal(template.quizzes[0].correct, 0);
  assert.equal(template.materials[0].asset_id, publication.assets[0].id);
  assert.equal(publication.lessons.length, publication.delivery.academy_lesson_ids.length);
});

test('rechaza una preparación incompleta, ajena o de otra revisión o duración', () => {
  for (const change of [
    { revision: 8 },
    { session_id: fixture.source.artifact_id },
    { template: { ...fixture.session_preparations[0].template, course_id: fixture.source.artifact_id } },
  ]) {
    assert.equal(hybridPublicationPackageSchema.safeParse({
      ...fixture, session_preparations: [{ ...fixture.session_preparations[0], ...change }],
    }).success, false);
  }
  const withoutDocuments = structuredClone(fixture);
  withoutDocuments.session_preparations[0].template.preparation.documents = [];
  assert.equal(hybridPublicationPackageSchema.safeParse(withoutDocuments).success, false);
  const changedDuration = structuredClone(fixture);
  changedDuration.delivery.sessions[0].minutes += 15;
  assert.equal(hybridPublicationPackageSchema.safeParse(changedDuration).success, false);
});

test('rechaza contenido fuera del recorrido y referencias a archivos sin declarar', () => {
  assert.equal(hybridPublicationPackageSchema.safeParse({ ...fixture, assets: [] }).success, false);
  assert.equal(hybridPublicationPackageSchema.safeParse({
    ...fixture, lessons: [{ ...fixture.lessons[0], lesson_id: 'lesson-hub' }, fixture.lessons[1]],
  }).success, false);
  assert.equal(hybridPublicationPackageSchema.safeParse({
    ...fixture, assets: [{ ...fixture.assets[0], url: 'https://example.test/file' }],
  }).success, false);
});

test('mide la cuota de preparación en bytes UTF-8', () => {
  const publication = structuredClone(fixture);
  publication.session_preparations[0].template.preparation.documents[0].facilitator_sections[0].body =
    'á'.repeat(140_000);
  const result = hybridPublicationPackageSchema.safeParse(publication);
  assert.equal(result.success, false);
  assert.ok(result.error?.issues.some(issue =>
    issue.path.join('.') === 'session_preparations.0' && issue.message.includes('supera el límite'),
  ));
});
