import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CompositionAudioMix } from "../composition-document.types";
import { CompositionAutosaveCoordinator } from "../composition-interaction-autosave";
import { AudioMixControls, type CompositionAudioMixUpdate } from "../../../materials/components/composition-editor/AudioMixControls";
import { CompositionAutosaveContext } from "../../../materials/components/composition-editor/CompositionAutosaveBoundary";

const calls: CompositionAudioMixUpdate[] = [];
const coordinator = new CompositionAutosaveCoordinator();
const controls: { calls: CompositionAudioMixUpdate[]; failNext: boolean; saved: number; disable: (disabled: boolean) => void } = {
  calls, failNext: false, saved: 1, disable: () => { throw new Error("El fixture no está montado."); },
};
Object.assign(window, { masterVolumeFixture: controls });

function Fixture() {
  const [disabled, setDisabled] = useState(false);
  const [audioMix, setAudioMix] = useState<CompositionAudioMix>({ ducking: { enabled: true,
    attackSeconds: 0.2, releaseSeconds: 0.35, duckedVolumeRatio: 0.35, targetRole: "MUSIC", triggerRoles: ["VOICE", "AVATAR"] } });
  useEffect(() => { controls.disable = setDisabled; }, [setDisabled]);
  return <CompositionAutosaveContext.Provider value={coordinator}><AudioMixControls audioMix={audioMix} disabled={disabled}
    onUpdate={async settings => {
      calls.push(settings);
      if (controls.failNext) { controls.failNext = false; return false; }
      const { masterVolume, ...ducking } = settings;
      if (masterVolume !== undefined) controls.saved = masterVolume;
      setAudioMix(current => ({ ...current, ...(masterVolume !== undefined ? { masterVolume } : {}), ducking: { ...current.ducking, ...ducking } }));
      return true;
    }} /></CompositionAutosaveContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
