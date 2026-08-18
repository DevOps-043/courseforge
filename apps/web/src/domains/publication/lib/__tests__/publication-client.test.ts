import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LessonVideoData, PublicationVideoLesson } from "../../types/publication.types";
import {
  reconcileSelectedLessonIds,
  shouldRestoreDraftVideoMapping,
} from "../publication-video-reconciliation";

const lesson: PublicationVideoLesson = {
  auto_duration: 0,
  auto_video_url: "",
  id: "lesson-1",
  module_title: "Module",
  title: "Lesson",
};

describe("publication video reconciliation", () => {
  it("removes an internal draft mapping when Production no longer has a video", () => {
    assert.equal(shouldRestoreDraftVideoMapping({
      duration: 10,
      lesson_id: lesson.id,
      lesson_title: lesson.title,
      module_title: lesson.module_title,
      video_id: "https://storage.example/deleted.mp4",
      video_provider: "direct",
    }), false);
  });

  it("preserves external user mappings and drops invalid selections", () => {
    const externalMapping: LessonVideoData = {
      duration: 30,
      lesson_id: lesson.id,
      lesson_title: lesson.title,
      module_title: lesson.module_title,
      video_id: "external-id",
      video_provider: "youtube",
    };
    const mappings = { [lesson.id]: externalMapping };
    const selected = reconcileSelectedLessonIds({
      lessons: [lesson],
      mappings,
      selectedLessonIds: [lesson.id, "deleted-lesson"],
    });

    assert.equal(shouldRestoreDraftVideoMapping(externalMapping), true);
    assert.deepEqual(selected, [lesson.id]);
  });
});
