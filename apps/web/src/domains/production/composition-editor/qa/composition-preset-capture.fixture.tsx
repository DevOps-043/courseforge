import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionPresetPanel } from "@/domains/materials/components/composition-editor/CompositionPresetPanel";
import { useCompositionPresetController } from "@/domains/materials/components/composition-editor/useCompositionPresetController";
import type { CompositionDocumentPayload } from "@/domains/materials/components/composition-editor/composition-studio.types";

const qa = { fail: true, calls: [] as Array<{ body: unknown; hash: string | null }> };
(window as unknown as { presetQa: typeof qa }).presetQa = qa;
window.fetch = async (input, options) => {
  const path = String(input);
  if (path.endsWith("/composition-presets") && options?.method === "POST") {
    qa.calls.push({ body: JSON.parse(String(options.body)), hash: new Headers(options.headers).get("If-Match") });
    return Response.json(qa.fail ? { error: "Fallo simulado al guardar el preset" } : {
      data: { id: "preset-guardado", diagnostics: [{ message: "Se conservan los recortes de fuente del destino." }] },
    }, { status: qa.fail ? 500 : 201 });
  }
  return Response.json({ data: [] });
};

function Fixture() {
  const payload = useRef({ documentHash: "b".repeat(64) } as CompositionDocumentPayload);
  const [error, setError] = useState<string | null>(null);
  const controller = useCompositionPresetController({
    agentProposalActive: false, draftId: "00000000-0000-4000-8000-000000000001",
    getCurrentPayload: useCallback(() => payload.current, []),
    isSaveInFlight: useCallback(() => false, []),
    onDocumentApplied: () => {}, onError: setError, onPreviewDismissed: () => {},
    onSavingChange: () => {}, saving: false,
  });
  return <>
    <output id="error">{error}</output>
    <CompositionPresetPanel activePreview={null} busy={controller.presetBusy}
      creationDiagnostics={controller.presetCreationDiagnostics} entries={controller.presetEntries}
      lastApplied={null} loading={false} onApply={async () => {}} onClose={() => {}}
      onCreate={controller.createCompositionPreset} onDismiss={async () => {}}
      onPreview={async () => {}} onReload={controller.loadCompositionPresets}
      onUndo={async () => {}} open />
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
