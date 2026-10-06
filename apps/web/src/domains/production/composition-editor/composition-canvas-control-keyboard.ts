export const COMPOSITION_CANVAS_KEYBOARD_STEP = { normal: 1, accelerated: 10 } as const;

/** Preview-only transaction: autorepeat never persists intermediate geometry. */
export function renderCompositionCanvasControlKeyboard(): string {
  return `
      const keyboardCanvasStep = ${JSON.stringify(COMPOSITION_CANVAS_KEYBOARD_STEP)};
      let keyboardTransform = null;
      const restoreKeyboardGeometry = (transaction) => {
        const { target, layout, crop } = transaction;
        target.style.left = layout.x + "px";
        target.style.top = layout.y + "px";
        target.style.width = layout.width + "px";
        target.style.height = layout.height + "px";
        applyCrop(target, crop);
      };
      const cancelKeyboardTransform = () => {
        const transaction = keyboardTransform;
        keyboardTransform = null;
        if (transaction) restoreKeyboardGeometry(transaction);
      };
      root?.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && keyboardTransform) {
          event.preventDefault(); event.stopPropagation(); cancelKeyboardTransform(); return;
        }
        if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey
          || activeTransform || activeMarquee || playbackActive || !editingEnabled) return;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        const control = event.target instanceof HTMLElement ? event.target.closest(".composition-editor-control") : null;
        const target = control?.closest("[data-hf-id]");
        if (!control || !target || !canvasClipIsVisible(target) || target.dataset.hfId !== selectedHfId) return;
        const mode = control.matches(".composition-crop-handle") ? "crop"
          : control.matches(".composition-resize-handle") ? "resize" : "move";
        if (mode === "crop" && !cropEnabled) return;
        event.preventDefault(); event.stopPropagation();
        if (keyboardTransform && (keyboardTransform.target !== target || keyboardTransform.control !== control)) cancelKeyboardTransform();
        if (!keyboardTransform) keyboardTransform = { target, control, mode, layout: readLayoutBox(target), crop: readCrop(target), keys: new Set() };
        keyboardTransform.keys.add(event.key);
        const step = event.shiftKey ? keyboardCanvasStep.accelerated : keyboardCanvasStep.normal;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const layout = readLayoutBox(target);
        const crop = readCrop(target);
        if (mode === "crop") {
          applyCrop(target, adjustCropFromHandle(crop, layout, control.dataset.cropEdge || "", dx, dy));
        } else if (mode === "move") {
          target.style.left = Math.max(-crop.left, Math.min(canvasWidth - layout.width + crop.right, layout.x + dx)) + "px";
          target.style.top = Math.max(-crop.top, Math.min(canvasHeight - layout.height + crop.bottom, layout.y + dy)) + "px";
          applyCrop(target, crop, false);
        } else {
          const ratio = layout.width / layout.height;
          const size = boundCanvasResize({ width: layout.width + (event.altKey ? dx : dx || dy * ratio), height: layout.height + dy,
            maxWidth: canvasWidth - layout.x, maxHeight: canvasHeight - layout.y,
            aspectRatio: event.altKey ? null : ratio, minimumSize: canvasSnapGeometry.minimumSizePixels });
          if (!size) return;
          target.style.width = size.width + "px"; target.style.height = size.height + "px";
          applyCrop(target, scaleCropForLayout(crop, layout, size), false);
        }
      });
      root?.addEventListener("keyup", (event) => {
        const transaction = keyboardTransform;
        if (!transaction || !transaction.keys.has(event.key)) return;
        event.preventDefault(); event.stopPropagation(); transaction.keys.delete(event.key);
        if (transaction.keys.size) return;
        keyboardTransform = null;
        const layout = readLayoutBox(transaction.target);
        const crop = readCrop(transaction.target);
        if (transaction.mode === "crop") {
          if (JSON.stringify(crop) !== JSON.stringify(transaction.crop)) commitCrop(transaction.target);
        } else if (["x", "y", "width", "height"].some((key) => layout[key] !== transaction.layout[key])) {
          postParentMessage({ type: "courseforge-composition-layout-commit", hfId: transaction.target.dataset.hfId,
            layout: { x: layout.x, y: layout.y, width: layout.width, height: layout.height } });
        }
      });
      root?.addEventListener("focusout", cancelKeyboardTransform);
      root?.addEventListener("pointerdown", cancelKeyboardTransform, true);
      window.addEventListener("blur", cancelKeyboardTransform);
  `;
}
