"use client";

import { useEffect, useRef } from "react";
import { compositionLayoutSchema } from "@/domains/production/composition-editor/composition-document.types";
import type { CompositionPositionPreview } from "@/domains/production/composition-editor/composition-position-preview-runtime";

export type CompositionPositionPreviewHandler = (hfId: string, position: CompositionPositionPreview | null) => void;

export function useCompositionPositionPreview(hfId: string | undefined, disabled: boolean, onPreview: CompositionPositionPreviewHandler) {
  const callback = useRef(onPreview);
  useEffect(() => { callback.current = onPreview; }, [onPreview]);
  useEffect(() => () => { if (hfId) callback.current(hfId, null); }, [hfId]);
  useEffect(() => { if (disabled && hfId) callback.current(hfId, null); }, [disabled, hfId]);

  return (axis: "x" | "y", value: string) => {
    if (!hfId || disabled || !value.trim()) return;
    const parsed = compositionLayoutSchema.shape[axis].safeParse(Number(value));
    if (parsed.success) callback.current(hfId, { [axis]: parsed.data });
  };
}
