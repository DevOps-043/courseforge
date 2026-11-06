import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mergeDeliveryCurationPlan } from "../course-delivery/services/delivery-curation";
import { getLessonSourceRequirement } from "../curation/lib/lesson-source-requirement";
import {
  CourseSourceError,
  sourcePersistenceError,
} from "./course-source-error";
import {
  COURSE_SOURCE_LIMITS,
  type CourseSourcePolicy,
} from "./course-source-policy";
import {
  proposeSourceAssociations,
  sourceCoverage,
  type SourceAssociation,
  type SourceEvidence,
  type SourceLesson,
} from "./course-source-coverage";
import {
  sourceAssociationSchema,
  sourceReviewCommandSchema,
} from "./course-source-review.schema";

import { readCourseSourcePolicy } from "./course-source-settings";
export { readCourseSourcePolicy } from "./course-source-settings";

type CurriculumLesson = {
  id?: string;
  title: string;
  objective_specific?: string;
  topics?: string[];
};
export async function readSourcePolicySnapshot(
  admin: SupabaseClient,
  artifactId: string,
) {
  const [settings, context] = await Promise.all([
    readCourseSourcePolicy(admin, artifactId),
    admin.rpc("course_source_curriculum", { p_artifact: artifactId }),
  ]);
  if (context.error) sourcePersistenceError(context.error);
  return {
    policy: settings?.policy || null,
    configured: Boolean(settings),
    revision: settings?.revision || 0,
    curriculumHash: context.data.hash,
    approved: false,
    planReady: false,
    lessons: [],
    evidence: [],
    associations: [],
  };
}
export async function readSourceReview(
  admin: SupabaseClient,
  artifactId: string,
) {
  const [settings, curriculum] = await Promise.all([
    readCourseSourcePolicy(admin, artifactId),
    admin.rpc("course_source_curriculum", { p_artifact: artifactId }),
  ]);
  if (curriculum.error) sourcePersistenceError(curriculum.error);
  const context = curriculum.data as {
    hash: string;
    planState: string | null;
    plans: unknown[];
    modules: { lessons: CurriculumLesson[] }[];
  };
  if (!settings || settings.policy === "WEB_ONLY")
    return {
      policy: settings?.policy || null,
      organizationId: settings?.organization_id || null,
      configured: Boolean(settings),
      revision: settings?.revision || 0,
      approved: false,
      curriculumHash: context.hash,
      planReady: false,
      lessons: [] as SourceLesson[],
      evidence: [] as SourceEvidence[],
      associations: [] as SourceAssociation[],
      coverage: [],
    };
  const plan = await mergeDeliveryCurationPlan(
    admin,
    artifactId,
    context.plans,
  );
  const syllabusLessons = context.modules.flatMap((module, mi) =>
    module.lessons.map((lesson, li) => ({
      ...lesson,
      id: lesson.id || `lesson-${mi + 1}-${li + 1}`,
    })),
  );
  const lessons: SourceLesson[] = (
    plan.length
      ? plan
      : syllabusLessons.map((lesson) => ({
          lesson_id: lesson.id,
          lesson_title: lesson.title,
          oa_text: lesson.objective_specific,
          components: [],
        }))
  ).map((item) => {
    if (!item.lesson_id || !item.lesson_title)
      throw new CourseSourceError(
        409,
        "El plan necesita identidades de lección vigentes antes de asociar documentos.",
      );
    const lesson = syllabusLessons.find(
      (candidate) => candidate.id === item.lesson_id,
    );
    return {
      id: item.lesson_id,
      title: item.lesson_title,
      requirements: [
        {
          id: "objective",
          label:
            item.oa_text || lesson?.objective_specific || item.lesson_title,
        },
        ...(lesson?.topics || []).map((topic, index) => ({
          id: `topic:${index}`,
          label: topic,
        })),
      ],
      webRequired: getLessonSourceRequirement(item).requiredSources,
    };
  });
  if (
    lessons.reduce((total, lesson) => total + lesson.requirements.length, 0) >
    1000
  )
    throw new CourseSourceError(
      413,
      "El curso excede el límite de 1000 requisitos revisables. Divide su alcance.",
    );
  const [fragments, curation, review] = await Promise.all([
    admin
      .from("course_source_fragments")
      .select("id,text_content,course_source_documents!inner(status,filename)")
      .eq("artifact_id", artifactId)
      .eq("course_source_documents.status", "READY")
      .limit(1001),
    admin
      .from("curation_rows")
      .select(
        "id,lesson_id,source_title,source_ref,source_kind,apta,validation_report,curation!inner(artifact_id)",
      )
      .eq("curation.artifact_id", artifactId)
      .eq("apta", true)
      .limit(1001),
    admin
      .from("course_source_review_versions")
      .select("associations,curriculum_hash")
      .eq("artifact_id", artifactId)
      .eq("revision", settings?.revision || 0)
      .maybeSingle(),
  ]);
  for (const result of [fragments, curation, review])
    if (result.error) sourcePersistenceError(result.error);
  if (
    (fragments.data?.length || 0) > 1000 ||
    (curation.data?.length || 0) > 1000
  )
    throw new CourseSourceError(
      413,
      "El curso excede el límite de evidencia revisable (1000 fragmentos o fuentes). Divide su alcance.",
    );
  const evidence: SourceEvidence[] = (fragments.data || []).map((fragment) => {
    const document = Array.isArray(fragment.course_source_documents)
      ? fragment.course_source_documents[0]
      : fragment.course_source_documents;
    return {
      id: fragment.id,
      type: "DOCUMENT",
      title: document.filename,
      text: fragment.text_content,
    };
  });
  for (const row of curation.data || []) {
    if (row.source_kind === "pdf") continue;
    if (!row.lesson_id) continue;
    if (
      row.validation_report?.status &&
      row.validation_report.status !== "valid"
    )
      continue;
    evidence.push({
      id: row.id,
      type: "WEB",
      lessonId: row.lesson_id,
      title: row.source_title || row.source_ref,
      sourceRef: row.source_ref,
      text: row.validation_report?.content_excerpt || row.source_title || "",
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(evidence)).byteLength >
    COURSE_SOURCE_LIMITS.reviewEvidenceBytes
  ) {
    throw new CourseSourceError(
      413,
      "La evidencia supera el presupuesto de revisión. Retira documentos sin uso o divide el alcance del curso.",
    );
  }
  const associations = review.data
    ? z.array(sourceAssociationSchema).parse(review.data.associations)
    : [];
  return {
    policy: settings?.policy || null,
    organizationId: settings?.organization_id || null,
    configured: Boolean(settings),
    revision: settings?.revision || 0,
    approved: Boolean(
      settings &&
      settings.approved_revision === settings.revision &&
      review.data?.curriculum_hash === context.hash,
    ),
    curriculumHash: context.hash,
    planReady:
      context.planState === "STEP_APPROVED" ||
      (plan.length > 0 && context.plans.length === 0),
    lessons,
    evidence,
    associations,
    coverage: settings?.policy
      ? sourceCoverage(settings.policy, lessons, associations, evidence)
      : [],
  };
}

export async function changeSourceReview(
  admin: SupabaseClient,
  artifactId: string,
  organizationId: string,
  actorId: string,
  reviewer: boolean,
  command: z.infer<typeof sourceReviewCommandSchema>,
) {
  const snapshot =
    command.action === "policy"
      ? await readSourcePolicySnapshot(admin, artifactId)
      : await readSourceReview(admin, artifactId);
  if (command.action === "propose")
    return {
      associations: proposeSourceAssociations(
        snapshot.lessons,
        snapshot.evidence.filter(
          (item) =>
            snapshot.policy !== "DOCUMENTS_ONLY" || item.type === "DOCUMENT",
        ),
      ),
    };
  if (
    snapshot.revision !== command.expectedRevision ||
    snapshot.curriculumHash !== command.curriculumHash
  )
    throw new CourseSourceError(
      409,
      "La configuración o el plan cambiaron. Actualiza antes de guardar.",
    );
  const associations: SourceAssociation[] =
    command.action === "save" ? command.associations : snapshot.associations;
  if (command.action !== "policy") {
    for (const association of associations) {
      const lesson = snapshot.lessons.find(
        (item) => item.id === association.lessonId,
      );
      const item = snapshot.evidence.find(
        (item) =>
          item.id === association.evidenceId &&
          item.type === association.evidenceType,
      );
      if (
        !lesson ||
        !item ||
        (item.type === "WEB" && item.lessonId !== lesson.id) ||
        association.requirementIds.some(
          (ref) =>
            !lesson.requirements.some((requirement) => requirement.id === ref),
        ) ||
        (snapshot.policy === "DOCUMENTS_ONLY" && item.type === "WEB")
      )
        throw new CourseSourceError(
          400,
          "La asociación no pertenece a la lección, política o evidencia vigente.",
        );
    }
  }
  if (command.action === "approve") {
    if (!reviewer)
      throw new CourseSourceError(
        403,
        "Solo un revisor puede aprobar la cobertura.",
      );
    if (
      !snapshot.policy ||
      !snapshot.planReady ||
      !snapshot.lessons.length ||
      sourceCoverage(
        snapshot.policy as CourseSourcePolicy,
        snapshot.lessons,
        associations,
        snapshot.evidence,
      ).some((item) => !item.complete)
    )
      throw new CourseSourceError(
        409,
        "Revisa y confirma evidencia para cada objetivo/tema y resuelve los conflictos antes de aprobar.",
      );
  }
  const result = await admin.rpc("change_course_source_review", {
    p_artifact: artifactId,
    p_organization: organizationId,
    p_actor: actorId,
    p_revision: command.expectedRevision,
    p_curriculum: command.curriculumHash,
    p_action: command.action,
    p_payload:
      command.action === "policy"
        ? { policy: command.policy }
        : { associations },
  });
  if (result.error) sourcePersistenceError(result.error);
  return { revision: result.data };
}
