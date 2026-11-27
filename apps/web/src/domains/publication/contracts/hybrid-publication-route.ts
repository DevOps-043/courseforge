import { z } from 'zod';

// Fuente portable del contrato de recorrido; Academy consume una copia verificada.
export const HYBRID_PUBLICATION_VERSION = '2.0' as const;
export const HYBRID_PUBLICATION_LIMITS = { lessons: 300, modules: 300, sessions: 24, segments: 324 } as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const id = text(200);
const uuid = z.string().uuid();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const lessonIds = z.array(id).max(HYBRID_PUBLICATION_LIMITS.lessons);
const canonicalUuid = uuid.transform(value => value.toLowerCase());
export const hybridPublicationSourceSchema = z.object({
  platform: z.literal('courseengine'), version: z.literal(HYBRID_PUBLICATION_VERSION),
  organization_id: canonicalUuid, organization_slug: text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  artifact_id: canonicalUuid, publication_id: canonicalUuid, revision,
}).strict();
const session = z.object({
  session_id: uuid, title: text(500), minutes: z.number().int().min(15).max(480),
  preparation_revision: revision,
  coverage: z.array(z.object({ lesson_id: id, review: z.boolean() }).strict()).min(1).max(HYBRID_PUBLICATION_LIMITS.lessons),
}).strict();
const segment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SYNCHRONOUS'), session_id: uuid }).strict(),
  z.object({ kind: z.literal('ASYNCHRONOUS'), segment_id: uuid, title: text(500),
    minutes: z.number().int().min(1).max(4800), lesson_ids: lessonIds.min(1) }).strict(),
]);

export const hybridPublicationRouteFields = z.object({
  source: hybridPublicationSourceSchema,
  delivery: z.object({
    mode: z.literal('HYBRID'), approach: z.enum(['COMPLEMENTARY', 'CLASS_VERSION']),
    curriculum: z.array(z.object({ module_id: id, title: text(500),
      lessons: z.array(z.object({ lesson_id: id, title: text(500) }).strict()).min(1).max(HYBRID_PUBLICATION_LIMITS.lessons),
    }).strict()).min(1).max(HYBRID_PUBLICATION_LIMITS.modules),
    academy_lesson_ids: lessonIds.min(1),
    sessions: z.array(session).min(1).max(HYBRID_PUBLICATION_LIMITS.sessions),
    route: z.array(segment).min(2).max(HYBRID_PUBLICATION_LIMITS.segments),
  }).strict(),
}).strict();

export function validateHybridPublicationRoute(
  { delivery }: z.infer<typeof hybridPublicationRouteFields>,
  context: z.RefinementCtx,
) {
  const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: ['delivery', field], message });
  const unique = (values: string[]) => new Set(values).size === values.length;
  const lessons = delivery.curriculum.flatMap(module => module.lessons.map(lesson => lesson.lesson_id));
  const curriculum = new Set(lessons);
  if (lessons.length > HYBRID_PUBLICATION_LIMITS.lessons || !unique(lessons) || !unique(delivery.curriculum.map(module => module.module_id))) {
    issue('curriculum', 'El currículo excede el límite o repite identidades.');
  }
  const academy = new Set(delivery.academy_lesson_ids);
  if (!unique(delivery.academy_lesson_ids) || [...academy].some(key => !curriculum.has(key))) {
    issue('academy_lesson_ids', 'Academy debe referir lecciones únicas del currículo.');
  }
  const sessions = new Map(delivery.sessions.map(item => [item.session_id, item]));
  if (sessions.size !== delivery.sessions.length) issue('sessions', 'La preparación repite identidades de sesión.');
  for (const item of delivery.sessions) {
    const coverage = item.coverage.map(entry => entry.lesson_id);
    if (!unique(coverage) || coverage.some(key => !curriculum.has(key))) issue('sessions', 'La cobertura repite lecciones o refiere contenido ajeno.');
  }
  const asynchronous = delivery.route.filter(item => item.kind === 'ASYNCHRONOUS');
  const routedLessons = asynchronous.flatMap(item => item.lesson_ids);
  if (!unique(asynchronous.map(item => item.segment_id)) || !unique(routedLessons) ||
    routedLessons.length !== academy.size || routedLessons.some(key => !academy.has(key))) {
    issue('route', 'El recorrido asíncrono debe cubrir exactamente Academy, sin duplicados.');
  }
  const synchronous = delivery.route.filter(item => item.kind === 'SYNCHRONOUS');
  if (!unique(synchronous.map(item => item.session_id)) || synchronous.length !== sessions.size ||
    synchronous.some(item => !sessions.has(item.session_id))) issue('route', 'El recorrido debe incluir cada sesión una sola vez.');
  const liveCoverage = new Set<string>();
  for (const entry of synchronous) {
    for (const coverage of sessions.get(entry.session_id)?.coverage ?? []) {
      if (liveCoverage.has(coverage.lesson_id) && !coverage.review) issue('sessions', 'La cobertura repetida debe declarar repaso.');
      liveCoverage.add(coverage.lesson_id);
    }
  }
  if (lessons.some(key => !academy.has(key) && !liveCoverage.has(key))) issue('route', 'Cada lección necesita un destino explícito.');
}

export const hybridPublicationRouteSchema = hybridPublicationRouteFields.superRefine(validateHybridPublicationRoute);

export type HybridPublicationRoute = z.infer<typeof hybridPublicationRouteSchema>;

/** Se ejecuta ANTES del importador v1: nunca descartar metadatos de modalidad. */
export function assertLegacyCourseImportCompatible(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('COURSE_IMPORT_INVALID_PAYLOAD');
  const envelope = payload as Record<string, unknown>;
  const origin = envelope.source && typeof envelope.source === 'object' ? envelope.source as Record<string, unknown> : {};
  if (origin.version === HYBRID_PUBLICATION_VERSION) {
    if (!hybridPublicationRouteSchema.safeParse({ source: origin, delivery: envelope.delivery }).success) {
      throw new Error('COURSE_IMPORT_INVALID_HYBRID_ROUTE');
    }
    throw new Error('COURSE_IMPORT_V2_REQUIRES_ATOMIC_APPROVAL');
  }
  if (origin.version !== undefined && origin.version !== '1.0') throw new Error('COURSE_IMPORT_UNSUPPORTED_VERSION');
  const course = envelope.course && typeof envelope.course === 'object' ? envelope.course as Record<string, unknown> : {};
  if (['delivery', 'hybridRoute', 'hybrid_route', 'sessions', 'session_preparations', 'mode', 'modality', 'delivery_mode'].some(key => Object.hasOwn(envelope, key)) ||
    ['mode', 'modality', 'delivery_mode', 'hybridRoute', 'hybrid_route'].some(key => Object.hasOwn(course, key))) {
    throw new Error('COURSE_IMPORT_LEGACY_DELIVERY_NOT_SUPPORTED');
  }
}
