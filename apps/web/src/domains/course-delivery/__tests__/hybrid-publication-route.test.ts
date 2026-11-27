import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { assertLegacyCourseImportCompatible, hybridPublicationRouteSchema } from '../../publication/contracts/hybrid-publication-route';
import { publicationOutboxPayloadSchema } from '../../publication/publication-outbox';

const fixture = () => JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/domains/publication/contracts/fixtures/hybrid-route-v2.json'), 'utf8'));

test('el contrato conserva solo Hub, solo Academy y compartidas sin inventar videos ni fechas', () => {
  const packet = fixture();
  assert.deepEqual(hybridPublicationRouteSchema.parse(packet), packet);
  packet.delivery.curriculum[0].lessons.reverse();
  assert.equal(hybridPublicationRouteSchema.safeParse(packet).success, true);
  assert.deepEqual(packet.delivery.academy_lesson_ids, ['lesson-academy', 'lesson-shared']);
});

test('rechaza referencias ajenas, identidades repetidas, cobertura incompleta y campos desconocidos', () => {
  const changes = [
    (packet: ReturnType<typeof fixture>) => packet.delivery.curriculum[0].lessons.push(packet.delivery.curriculum[0].lessons[0]),
    (packet: ReturnType<typeof fixture>) => packet.delivery.academy_lesson_ids.push('foreign'),
    (packet: ReturnType<typeof fixture>) => packet.delivery.route[0].lesson_ids.push('lesson-hub'),
    (packet: ReturnType<typeof fixture>) => packet.delivery.route[0].lesson_ids.pop(),
    (packet: ReturnType<typeof fixture>) => packet.delivery.route.push(packet.delivery.route[1]),
    (packet: ReturnType<typeof fixture>) => packet.delivery.sessions[0].coverage.shift(),
    (packet: ReturnType<typeof fixture>) => packet.delivery.sessions[0].coverage.push({ lesson_id: 'foreign', review: false }),
    (packet: ReturnType<typeof fixture>) => packet.delivery.sessions[0].starts_at = '2026-12-01T12:00:00Z',
    (packet: ReturnType<typeof fixture>) => packet.source.organization_id = 'invalid',
    (packet: ReturnType<typeof fixture>) => packet.source.revision = Number.MAX_SAFE_INTEGER + 1,
  ];
  for (const change of changes) {
    const packet = fixture(); change(packet);
    assert.equal(hybridPublicationRouteSchema.safeParse(packet).success, false);
  }
});

test('no degrada v2 al importador v1 y conserva compatibilidad de paquetes antiguos', () => {
  assert.doesNotThrow(() => assertLegacyCourseImportCompatible({ source: { version: '1.0' }, course: {}, modules: [] }));
  assert.doesNotThrow(() => assertLegacyCourseImportCompatible({ course: {}, modules: [] }));
  assert.throws(() => assertLegacyCourseImportCompatible(fixture()), /V2_REQUIRES_ATOMIC_APPROVAL/);
  assert.throws(() => assertLegacyCourseImportCompatible({ source: { version: '3.0' } }), /UNSUPPORTED_VERSION/);
  for (const key of ['delivery', 'hybridRoute', 'hybrid_route', 'sessions', 'mode', 'modality', 'delivery_mode']) {
    assert.throws(() => assertLegacyCourseImportCompatible({ source: { version: '1.0' }, [key]: {} }), /LEGACY_DELIVERY_NOT_SUPPORTED/);
  }
});

test('el outbox existente rechaza el recorrido antes de transportarlo como publicación v1', () => {
  const legacy = { source: { platform: 'courseengine', version: '1.0', artifact_id: fixture().source.artifact_id }, course: { slug: 'curso-prueba' }, modules: [] };
  assert.equal(publicationOutboxPayloadSchema.safeParse(legacy).success, true);
  assert.equal(publicationOutboxPayloadSchema.safeParse({ ...legacy, delivery: fixture().delivery }).success, false);
  assert.equal(publicationOutboxPayloadSchema.safeParse({ ...legacy, ...fixture() }).success, false);
});
