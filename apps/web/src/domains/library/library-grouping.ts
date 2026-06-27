import type { LibrarySearchResult } from "./types";

export interface LibraryLessonGroup {
  id: string;
  items: LibrarySearchResult[];
  lessonTitle: string;
}

export interface LibraryWorkshopGroup {
  courseCode: string;
  id: string;
  itemCount: number;
  lessons: LibraryLessonGroup[];
  workshopName: string;
}

export function groupLibraryItemsByWorkshop(items: LibrarySearchResult[]): LibraryWorkshopGroup[] {
  const workshops = new Map<string, LibraryWorkshopGroup>();

  for (const item of items) {
    const workshopId = item.workshopId || "workshop-sin-id";
    const lessonId = item.lessonId || "lesson-sin-id";
    let workshop = workshops.get(workshopId);

    if (!workshop) {
      workshop = {
        courseCode: item.courseCode,
        id: workshopId,
        itemCount: 0,
        lessons: [],
        workshopName: item.workshopName || "Taller sin nombre",
      };
      workshops.set(workshopId, workshop);
    }

    let lesson = workshop.lessons.find((candidate) => candidate.id === lessonId);
    if (!lesson) {
      lesson = {
        id: lessonId,
        items: [],
        lessonTitle: item.lessonTitle || "Leccion sin nombre",
      };
      workshop.lessons.push(lesson);
    }

    lesson.items.push(item);
    workshop.itemCount += 1;
  }

  return Array.from(workshops.values());
}

