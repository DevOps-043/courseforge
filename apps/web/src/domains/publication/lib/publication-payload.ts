import type { PublicationDataResult, PublicationPayload, PublicationPayloadLesson, PublicationPayloadModule, PublicationPreviewModule, PublicationRequestRecord } from "@/domains/publication/types/publication.types";
import {
  buildPreviewLesson,
  buildPublicationLesson,
  getArtifactDescription,
  groupLessonsByModule,
} from "./publication-payload-builders";

type PublicationInput = Pick<
  PublicationDataResult,
  "artifact" | "lessons" | "materialsPackage"
> & {
  artifactId: string;
  request: PublicationRequestRecord;
};

export { getArtifactDescription };

export function buildPublicationPayload({
  artifactId,
  artifact,
  lessons,
  materialsPackage,
  request,
}: PublicationInput): PublicationPayload {
  const modules: PublicationPayloadModule[] = [];
  const groupedLessons = groupLessonsByModule(lessons);
  const files = materialsPackage?.files || [];
  let moduleOrder = 1;

  for (const [moduleTitle, moduleLessons] of groupedLessons.entries()) {
    const payloadLessons: PublicationPayloadLesson[] = [];
    let lessonOrder = 1;

    for (const lesson of moduleLessons) {
      const payloadLesson = buildPublicationLesson({
        lesson,
        request,
        orderIndex: lessonOrder,
        files,
      });

      if (!payloadLesson) {
        continue;
      }

      payloadLessons.push(payloadLesson);
      lessonOrder += 1;
    }

    if (payloadLessons.length === 0) {
      continue;
    }

    modules.push({
      title: moduleTitle,
      order_index: moduleOrder,
      lessons: payloadLessons,
    });
    moduleOrder += 1;
  }

  return {
    source: {
      platform: "courseengine",
      version: "1.0",
      artifact_id: artifactId,
    },
    course: {
      title: artifact.title,
      description: getArtifactDescription(artifact),
      slug: request.slug,
      category: request.category,
      level: request.level,
      instructor_email: request.instructor_email,
      price: request.price || 0,
      thumbnail_url: request.thumbnail_url || "",
      is_published: false,
    },
    modules,
  };
}

export function buildPublicationPreview(
  lessons: PublicationDataResult["lessons"],
  request: PublicationRequestRecord,
): PublicationPreviewModule[] {
  const previewModules: PublicationPreviewModule[] = [];
  const groupedLessons = groupLessonsByModule(lessons);
  let moduleOrder = 1;

  for (const [moduleTitle, moduleLessons] of groupedLessons.entries()) {
    const previewModule: PublicationPreviewModule = {
      title: moduleTitle,
      order_index: moduleOrder,
      lessons: [],
    };
    let lessonOrder = 1;

    for (const lesson of moduleLessons) {
      const previewLesson = buildPreviewLesson({
        lesson,
        request,
        orderIndex: lessonOrder,
      });

      if (!previewLesson) {
        continue;
      }

      previewModule.lessons.push(previewLesson);
      lessonOrder += 1;
    }

    if (previewModule.lessons.length === 0) {
      continue;
    }

    previewModules.push(previewModule);
    moduleOrder += 1;
  }

  return previewModules;
}
