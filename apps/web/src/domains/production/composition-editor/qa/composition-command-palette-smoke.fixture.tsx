import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionCommandPalette } from "@/domains/materials/components/composition-editor/CompositionCommandPalette";
import type { CompositionCommandPaletteItem } from "../composition-editor-command-actions";
import type { CompositionEditorCommandId } from "../composition-editor-command-palette";

const fixtureItems: readonly CompositionCommandPaletteItem[] = [
  {
    disabledReason: "Selecciona al menos un clip en el timeline o canvas.",
    enabled: false,
    id: "edit.copy",
  },
  { active: true, enabled: true, id: "view.grid" },
  { enabled: true, id: "view.safe-areas" },
];

function CompositionCommandPaletteSmokeFixture() {
  const [open, setOpen] = useState(false);
  const [lastCommand, setLastCommand] = useState("none");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <main>
    <button id="command-palette-opener" type="button" onClick={() => setOpen(true)}>Abrir comandos</button>
    <output id="last-command">{lastCommand}</output>
    {open && <CompositionCommandPalette
      items={fixtureItems}
      onClose={() => setOpen(false)}
      onRun={(commandId: CompositionEditorCommandId) => setLastCommand(commandId)}
    />}
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el root del smoke de paleta.");
createRoot(root).render(<CompositionCommandPaletteSmokeFixture />);
