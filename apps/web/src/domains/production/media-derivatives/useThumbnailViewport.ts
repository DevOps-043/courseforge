"use client";

import { useEffect, useMemo, useState } from "react";
import { type ThumbnailPlanInput } from "./thumbnail-plan.service";
import { loadThumbnailViewport, type ThumbnailLoader, type ThumbnailViewport } from "./thumbnail-viewport.client";

export type ThumbnailViewportState =
  | { status: "loading"; viewport: null }
  | { status: "ready"; viewport: ThumbnailViewport }
  | { status: "error"; viewport: null; code: string };

/** The host must recreate load/accessKey when actor, tenant, component, asset or grant epoch changes. */
export function useThumbnailViewport(input: ThumbnailPlanInput, load: ThumbnailLoader, accessKey: string): ThumbnailViewportState {
  const requestKey = JSON.stringify([accessKey, input]);
  const request = useMemo(() => ({ key: requestKey, load }), [requestKey, load]);
  const [state, setState] = useState<{ request: typeof request; value: ThumbnailViewportState }>({
    request, value: { status: "loading", viewport: null },
  });
  useEffect(() => {
    const controller = new AbortController();
    let viewport: ThumbnailViewport | undefined;
    let active = true;
    // Capture this effect's immutable input rather than depending on caller object identity.
    const capturedInput = JSON.parse(request.key)[1] as ThumbnailPlanInput;
    void loadThumbnailViewport({ input: capturedInput, load: request.load, signal: controller.signal }).then((result) => {
      if (!active) { result.dispose(); return; }
      viewport = result;
      setState({ request, value: { status: "ready", viewport: result } });
    }).catch((error: unknown) => {
      if (!active) return;
      const code = error instanceof Error && /^THUMBNAIL_[A-Z_]+$/.test(error.message) ? error.message : "THUMBNAIL_READ_FAILED";
      setState({ request, value: { status: "error", viewport: null, code } });
    });
    return () => { active = false; controller.abort(); viewport?.dispose(); };
  }, [request]);
  // Never expose the previous tenant/viewport's images during a new request's first render.
  return state.request === request ? state.value : { status: "loading", viewport: null };
}
