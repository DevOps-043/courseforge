"use client";

import { useEffect, useState } from "react";
import { readCompositionReferenceGuides, writeCompositionReferenceGuides, type CompositionReferenceGuides } from "@/domains/production/composition-editor/composition-reference-guides";

export function useCompositionReferenceGuides(draftId: string) {
  const [state, setState] = useState<CompositionReferenceGuides>({ visible: true, guides: [] });
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    try { setState(readCompositionReferenceGuides(window.localStorage, draftId)); }
    catch { setStorageError("No se pudieron recuperar las guías locales. Puedes crear nuevas en esta sesión."); }
    setLoaded(true);
  }, [draftId]);
  useEffect(() => {
    if (!loaded) return;
    try { writeCompositionReferenceGuides(window.localStorage, draftId, state); }
    catch { setStorageError("No se pudieron guardar las guías en este navegador. Se conservarán durante esta sesión."); }
  }, [draftId, loaded, state]);
  return { state, setState, storageError };
}
