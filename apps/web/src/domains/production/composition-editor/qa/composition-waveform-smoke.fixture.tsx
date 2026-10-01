import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CompositionClipWaveform } from "@/domains/materials/components/composition-editor/CompositionClipWaveform";

const waveform = {
  bucketSizeSamples: 1,
  durationSeconds: 4,
  max: [0.1, 0.2, 1, 0.4],
  min: [-0.1, -0.2, -1, -0.4],
  sampleRateHz: 1,
};

function Fixture() {
  const [offset, setOffset] = useState(0);
  const [width, setWidth] = useState(320);
  return <main>
    <button id="trim" type="button" onClick={() => setOffset(1)}>Recortar</button>
    <button id="zoom" type="button" onClick={() => setWidth(640)}>Zoom</button>
    <div id="audio-clip" style={{ position: "relative", width, height: 40 }}>
      <CompositionClipWaveform clipDurationSeconds={2} sourceOffsetSeconds={offset} waveform={waveform} />
    </div>
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el root del smoke de waveform.");
createRoot(root).render(<Fixture />);
