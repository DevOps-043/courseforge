import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { resolveCompositionTimelineCursorKey } from "../composition-timeline-focus-keyboard";
import { stepCompositionFrame } from "../composition-timecode";

test("actual timeline capture handler leaves animation sliders to local editing and routes only playhead keys", () => {
  const source = readFileSync(join(process.cwd(), "apps/web/src/domains/materials/components/composition-editor/CompositionTimeline.tsx"), "utf8");
  const handlerSource = source.match(/onKeyDownCapture=\{\(event\) => \{([\s\S]*?)\n  \}\}>/);
  assert.ok(handlerSource, "Capture handler must be extracted; do not silently skip routing test");
  const seeks: number[] = [];
  class Element {
    constructor(readonly animation: boolean) {}
    closest(selector: string) {
      // This fixture has exactly two sliders: playhead and the animation band.
      return this.animation && selector.includes(":not([data-animation-id])") ? null : this;
    }
  }
  const handler = runInNewContext(`(event) => {${handlerSource[1]}\n}`, {
    HTMLElement: Element, resolveCompositionTimelineCursorKey, stepCompositionFrame,
    currentTime: 2, maxDuration: 10, fps: 30, onSeek: (value: number) => seeks.push(value),
  }) as (event: unknown) => void;
  const send = (animation: boolean, key: string, extra = {}) => {
    let prevented = false;
    let stopped = false;
    handler({ target: new Element(animation), key, nativeEvent: { isComposing: false },
      preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }, ...extra });
    return { prevented, stopped };
  };
  assert.deepEqual(send(true, "ArrowRight"), { prevented: false, stopped: false });
  assert.deepEqual(send(true, "ArrowLeft", { shiftKey: true }), { prevented: false, stopped: false });
  assert.equal(seeks.length, 0);
  assert.deepEqual(send(false, "ArrowRight"), { prevented: true, stopped: true });
  assert.equal(seeks[0], 61 / 30);
  send(false, "End"); assert.equal(seeks.at(-1), 10);
  assert.deepEqual(send(false, "ArrowLeft", { altKey: true }), { prevented: false, stopped: true });
  assert.equal(seeks.length, 2);
  assert.deepEqual(send(false, "ArrowRight", { nativeEvent: { isComposing: true } }), { prevented: false, stopped: false });
});
