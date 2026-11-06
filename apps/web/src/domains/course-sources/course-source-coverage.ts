import type { CourseSourcePolicy } from "./course-source-policy";

export interface SourceRequirement {
  id: string;
  label: string;
}
export interface SourceLesson {
  id: string;
  title: string;
  requirements: SourceRequirement[];
  webRequired: number;
}
export interface SourceAssociation {
  lessonId: string;
  evidenceType: "DOCUMENT" | "WEB";
  evidenceId: string;
  requirementIds: string[];
  verified: boolean;
  conflict: boolean;
  resolution: string;
}
export interface SourceEvidence {
  id: string;
  lessonId?: string;
  title: string;
  text: string;
  type: "DOCUMENT" | "WEB";
  sourceRef?: string;
}

/** Una cita no acredita suficiencia: solo cuentan asociaciones confirmadas por el revisor. */
export function sourceCoverage(
  policy: CourseSourcePolicy,
  lessons: SourceLesson[],
  associations: SourceAssociation[],
  evidence: SourceEvidence[],
) {
  return lessons.map((lesson) => {
    const valid = associations.filter(
      (association) =>
        association.lessonId === lesson.id &&
        association.verified &&
        (!association.conflict || Boolean(association.resolution.trim())) &&
        evidence.some(
          (item) =>
            item.id === association.evidenceId &&
            item.type === association.evidenceType &&
            (item.type === "DOCUMENT" || item.lessonId === lesson.id),
        ) &&
        (policy !== "DOCUMENTS_ONLY" ||
          association.evidenceType === "DOCUMENT"),
    );
    const covered = new Set(valid.flatMap((item) => item.requirementIds));
    const documentary = new Set(
      valid
        .filter((item) => item.evidenceType === "DOCUMENT")
        .flatMap((item) => item.requirementIds),
    );
    const missing = lesson.requirements.filter(
      (requirement) => !covered.has(requirement.id),
    );
    const conflicts = associations.filter(
      (item) =>
        item.lessonId === lesson.id && item.conflict && !item.resolution.trim(),
    ).length;
    return {
      lessonId: lesson.id,
      missing,
      conflicts,
      complete: !missing.length && !conflicts,
      documentCovered: documentary.size,
      webCovered: valid.filter((item) => item.evidenceType === "WEB").length,
      webNeeded:
        policy === "DOCUMENTS_ONLY"
          ? 0
          : Math.max(
              0,
              Math.ceil(
                (lesson.webRequired *
                  (lesson.requirements.length - documentary.size)) /
                  Math.max(1, lesson.requirements.length),
              ),
            ),
    };
  });
}

function terms(text: string) {
  return new Set(
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 3),
  );
}
/** Sugerencia determinista, sin IA ni aprobación implícita; cero coincidencia deja vacío visible. */
export function proposeSourceAssociations(
  lessons: SourceLesson[],
  evidence: SourceEvidence[],
): SourceAssociation[] {
  const indexed = evidence.map((item) => ({ item, words: terms(item.text) }));
  return lessons.flatMap((lesson) =>
    lesson.requirements.flatMap((requirement) => {
      const words = terms(`${lesson.title} ${requirement.label}`);
      const ranked = indexed
        .filter(({ item }) => item.type === "DOCUMENT" || item.lessonId === lesson.id)
        .map(({ item, words: contentTerms }) => ({
          item,
          score: [...words].filter((word) => contentTerms.has(word)).length,
        }))
        .sort(
          (a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id),
        );
      if (!ranked[0]?.score) return [];
      return [
        {
          lessonId: lesson.id,
          evidenceType: ranked[0].item.type,
          evidenceId: ranked[0].item.id,
          requirementIds: [requirement.id],
          verified: false,
          conflict: false,
          resolution: "",
        },
      ];
    }),
  );
}
