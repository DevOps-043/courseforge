export interface ProductionCourseContext {
  artifactId: string;
  componentId: string;
  componentType: string;
  lessonTitle: string;
  workshopTitle: string;
}

interface ProductionCourseContextArtifactRelation {
  idea_central?: string | null;
  organization_id?: string | null;
}

interface ProductionCourseContextMaterialRelation {
  artifact_id?: string | null;
  artifacts?:
    | ProductionCourseContextArtifactRelation
    | ProductionCourseContextArtifactRelation[]
    | null;
}

interface ProductionCourseContextLessonRelation {
  lesson_title?: string | null;
  materials?:
    | ProductionCourseContextMaterialRelation
    | ProductionCourseContextMaterialRelation[]
    | null;
}

export interface ProductionCourseContextRow {
  id: string;
  material_lessons?:
    | ProductionCourseContextLessonRelation
    | ProductionCourseContextLessonRelation[]
    | null;
  type?: string | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function mapProductionCourseContext(
  row: ProductionCourseContextRow,
  expectedOrganizationId: string,
): ProductionCourseContext | null {
  const lesson = firstRelation(row.material_lessons);
  const material = firstRelation(lesson?.materials);
  const artifact = firstRelation(material?.artifacts);

  if (
    !material?.artifact_id ||
    !artifact ||
    artifact.organization_id !== expectedOrganizationId
  ) {
    return null;
  }

  return {
    artifactId: material.artifact_id,
    componentId: row.id,
    componentType: row.type || "VIDEO",
    lessonTitle: lesson?.lesson_title?.trim() || "Lección sin título",
    workshopTitle: artifact.idea_central?.trim() || "Taller sin título",
  };
}
