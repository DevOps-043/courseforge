import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveLibraryFileName,
  libraryItemMatchesQuery,
  normalizeLibraryAssets,
  normalizeLibraryComponent,
} from "../library-normalizer";
import { groupLibraryItemsByWorkshop } from "../library-grouping";
import type { LibraryComponentSource } from "../library-normalizer";

function source(overrides: Partial<LibraryComponentSource> = {}): LibraryComponentSource {
  return {
    assets: {},
    componentId: "component-1",
    componentType: "VIDEO_DEMO",
    courseCode: "TALLER-1",
    generatedAt: "2026-06-26T10:00:00.000Z",
    lessonId: "lesson-1",
    lessonTitle: "Leccion 1",
    organizationId: "org-1",
    organizationName: "empresa-demo",
    workshopId: "artifact-1",
    workshopName: "Taller de IA",
    ...overrides,
  };
}

describe("deriveLibraryFileName", () => {
  it("prefers explicit file_name and falls back to storage path or URL", () => {
    assert.equal(
      deriveLibraryFileName({
        fallbackName: "voz",
        fileName: "narracion-final.mp3",
        publicUrl: "https://cdn.example.com/voice.mp3",
        storagePath: "production-assets/voices/generated.mp3",
      }),
      "narracion-final.mp3",
    );

    assert.equal(
      deriveLibraryFileName({
        fallbackName: "voz",
        publicUrl: "https://cdn.example.com/voice.mp3",
        storagePath: "production-assets/voices/generated.mp3",
      }),
      "generated.mp3",
    );

    assert.equal(
      deriveLibraryFileName({
        fallbackName: "voz",
        publicUrl: "https://cdn.example.com/uploads/audio%20final.mp3",
      }),
      "audio final.mp3",
    );
  });
});

describe("normalizeLibraryAssets", () => {
  it("detects voice, music, avatar, b-roll, slides, final video and screencast", () => {
    const items = normalizeLibraryAssets(
      source({
        assets: {
          voice_audio: {
            file_name: "voice.mp3",
            public_url: "https://cdn.example.com/voice.mp3",
            storage_path: "production-assets/voices/voice.mp3",
          },
          background_music: {
            file_name: "music.mp3",
            public_url: "https://cdn.example.com/music.mp3",
            storage_path: "production-assets/music/music.mp3",
          },
          avatar_video: {
            file_name: "avatar.mp4",
            public_url: "https://cdn.example.com/avatar.mp4",
            storage_path: "production-assets/avatars/avatar.mp4",
          },
          b_roll_clips: [
            {
              file_name: "clip.mp4",
              id: "clip-1",
              order: 1,
              public_url: "https://cdn.example.com/clip.mp4",
              storage_path: "production-assets/broll/clip.mp4",
            },
          ],
          slides: {
            html_public_url: "https://cdn.example.com/slides.html",
            html_content_path: "production-assets/slides/slides.html",
            images: [
              {
                file_name: "slide-1.png",
                public_url: "https://cdn.example.com/slide-1.png",
                slide_index: 1,
                storage_path: "production-assets/slides/slide-1.png",
              },
            ],
          },
          final_video_url: "https://cdn.example.com/final.mp4",
          screencast_url: "https://cdn.example.com/screencast.mp4",
        },
      }),
    );

    assert.deepEqual(
      items.map((item) => item.assetType),
      ["voice", "music", "broll", "avatar", "slides", "slides", "video_final", "screencast"],
    );
    assert.equal(items.every((item) => item.id.includes("gamma") === false), true);
  });

  it("supports incomplete assets without emitting empty asset items", () => {
    const items = normalizeLibraryAssets(
      source({
        assets: {
          voice_audio: {
            public_url: "",
            storage_path: "",
          },
          b_roll_clips: [],
        },
      }),
    );

    assert.equal(items.length, 0);
  });
});

describe("normalizeLibraryComponent", () => {
  it("creates a searchable material item and asset items under the virtual folder path", () => {
    const items = normalizeLibraryComponent(
      source({
        assets: {
          voice_audio: {
            public_url: "https://cdn.example.com/voice.mp3",
            storage_path: "production-assets/voices/voice.mp3",
          },
        },
      }),
    );

    assert.equal(items[0].kind, "material");
    assert.equal(items[1].kind, "asset");
    assert.deepEqual(items[1].folderPath, {
      company: "empresa-demo",
      workshop: "Taller de IA",
      lesson: "Leccion 1",
      section: "Voz",
    });
    assert.equal(libraryItemMatchesQuery(items[1], "voice.mp3"), true);
    assert.equal(libraryItemMatchesQuery(items[1], "Taller de IA"), true);
  });
});

describe("groupLibraryItemsByWorkshop", () => {
  it("groups library items into workshop and lesson folders", () => {
    const firstWorkshopItems = normalizeLibraryComponent(
      source({
        assets: {
          voice_audio: {
            public_url: "https://cdn.example.com/voice.mp3",
            storage_path: "production-assets/voices/voice.mp3",
          },
        },
      }),
    );
    const secondWorkshopItems = normalizeLibraryComponent(
      source({
        componentId: "component-2",
        lessonId: "lesson-2",
        lessonTitle: "Leccion 2",
        workshopId: "artifact-2",
        workshopName: "Taller de Ventas",
      }),
    );

    const groups = groupLibraryItemsByWorkshop([...firstWorkshopItems, ...secondWorkshopItems]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].workshopName, "Taller de IA");
    assert.equal(groups[0].lessons.length, 1);
    assert.equal(groups[0].lessons[0].lessonTitle, "Leccion 1");
    assert.equal(groups[0].itemCount, 2);
    assert.equal(groups[1].workshopName, "Taller de Ventas");
  });
});
