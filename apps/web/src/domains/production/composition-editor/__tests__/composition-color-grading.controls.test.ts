import assert from "node:assert/strict";
import test from "node:test";
import {
  fromCompositionColorGradingControlValues,
  toCompositionColorGradingControlValues,
} from "../composition-color-grading.controls";

test("convierte la escala editorial a los rangos canónicos de HyperFrames", () => {
  assert.deepEqual(fromCompositionColorGradingControlValues({
    brightness: 50,
    contrast: -25,
    saturation: 80,
  }), {
    adjust: { contrast: -0.25, exposure: 1, saturation: 0.8 },
  });
  assert.deepEqual(toCompositionColorGradingControlValues({
    adjust: { contrast: -0.25, exposure: 1, saturation: 0.8 },
  }), {
    brightness: 50,
    contrast: -25,
    saturation: 80,
  });
});

test("normaliza valores de UI y elimina el ajuste neutro", () => {
  assert.equal(fromCompositionColorGradingControlValues({
    brightness: 0,
    contrast: 0,
    saturation: 0,
  }), undefined);
  assert.deepEqual(fromCompositionColorGradingControlValues({
    brightness: 200,
    contrast: -200,
    saturation: 12.6,
  }), {
    adjust: { contrast: -1, exposure: 2, saturation: 0.13 },
  });
});
