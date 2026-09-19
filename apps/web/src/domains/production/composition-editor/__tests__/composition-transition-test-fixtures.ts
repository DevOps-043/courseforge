import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import type { CompositionTransition } from "../composition-transition.types";

export function createTransitionDocument() {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [0, 1].map((index) => ({
      checksum: String(index + 1).repeat(64),
      durationSeconds: 10,
      fileSizeBytes: 1024,
      hasAudio: true,
      mimeType: "video/mp4",
      productionAssetId: `40000000-0000-4000-8000-00000000000${index + 1}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `broll/transition-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Persistencia de transiciones" },
  });
  document.canvas.durationSeconds = 8;
  const [fromClip, toClip] = document.clips;
  if (!fromClip || !toClip) throw new Error("Expected two transition clips.");
  fromClip.startSeconds = 0;
  fromClip.durationSeconds = 4;
  fromClip.sourceDurationSeconds = 10;
  fromClip.sourceOffsetSeconds = 1;
  fromClip.volume = 0.8;
  fromClip.timingSource = "USER_EDITED";
  toClip.startSeconds = 4;
  toClip.durationSeconds = 4;
  toClip.sourceDurationSeconds = 10;
  toClip.sourceOffsetSeconds = 1;
  toClip.volume = 0.6;
  toClip.timingSource = "USER_EDITED";
  return compositionEditorDocumentSchema.parse(document);
}

export function createTransition(document: ReturnType<typeof createTransitionDocument>): CompositionTransition {
  return {
    alignment: "CENTER_AT_CUT",
    audioMode: "CROSSFADE",
    durationSeconds: 0.4,
    easing: "sine.inOut",
    fromClipId: document.clips[0]!.id,
    id: "transition-persisted",
    origin: "USER",
    toClipId: document.clips[1]!.id,
    type: "CROSS_DISSOLVE",
  };
}
