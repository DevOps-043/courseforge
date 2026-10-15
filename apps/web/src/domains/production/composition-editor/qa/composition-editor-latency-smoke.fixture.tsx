import { createRoot } from "react-dom/client";
import { NativeCompositionPreview } from "@/domains/materials/components/composition-editor/NativeCompositionPreview";

const root = document.getElementById("root");
if (!root) throw new Error("LATENCY_FIXTURE_ROOT_MISSING");
window.addEventListener("message", (event) => {
  if (event.source !== document.querySelector("iframe")?.contentWindow || event.data?.type !== "qa-scene-state") return;
  const output = document.getElementById("scene-state");
  if (output) output.textContent = JSON.stringify(event.data);
});

createRoot(root).render(<NativeCompositionPreview
  assets={[]}
  componentId="11111111-1111-4111-8111-111111111111"
  compositionId="22222222-2222-4222-8222-222222222222"
  draftId="33333333-3333-4333-8333-333333333333"
  lessons={[]}
  onSelectLesson={() => undefined}
  selectedLessonId={null}
/>);
