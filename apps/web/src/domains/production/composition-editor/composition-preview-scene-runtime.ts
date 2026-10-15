import type { CompositionPreviewScenePatch } from "./composition-preview-scene-patch";

/** Self-contained so the compiler can embed the same implementation in its sandbox. */
export function prepareCompositionPreviewScenePatch(root: HTMLElement, scene: CompositionPreviewScenePatch) {
  const assetUrls = new Map(Object.entries(scene.assetUrls));
  // Keep the exact signed URLs in use: replacing them restarts decoded media.
  root.querySelectorAll<HTMLMediaElement | HTMLImageElement>("[data-preview-asset-id]").forEach((media) => {
    if (media.dataset.previewAssetId) assetUrls.set(media.dataset.previewAssetId, media.getAttribute("src") || "");
  });
  const nextNodes: HTMLElement[] = [];
  for (const node of scene.nodes) {
    const template = document.createElement("template");
    template.innerHTML = node.html;
    if (template.content.querySelector("script, iframe, object, embed, link, meta, base, style")) throw new Error("UNSAFE_SCENE_MARKUP");
    for (const element of template.content.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name)) throw new Error("UNSAFE_SCENE_ATTRIBUTE");
      }
    }
    if (node.deckSourceHfId) {
      const source = root.querySelector('[data-hf-id="' + CSS.escape(node.deckSourceHfId) + '"] .deck-scope');
      const destination = template.content.querySelector(".deck-scope");
      if (!source || !destination) throw new Error("DECK_SOURCE_NOT_FOUND");
      // Deck HTML and scoped URLs have already passed the server compiler.
      destination.replaceChildren(...[...source.childNodes].map((child) => child.cloneNode(true)));
    }
    for (const media of template.content.querySelectorAll<HTMLMediaElement | HTMLImageElement>("[data-preview-asset-id]")) {
      const assetId = media.dataset.previewAssetId!;
      const url = assetUrls.get(assetId);
      if (!url) throw new Error("ASSET_URL_NOT_FOUND");
      media.setAttribute("src", url);
    }
    nextNodes.push(...[...template.content.children] as HTMLElement[]);
  }
  const ids = nextNodes.map((node) => node.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error("INVALID_SCENE_IDS");

  function pauseRemovedMedia(node: Element) {
    if (node instanceof HTMLMediaElement) node.pause();
    node.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => media.pause());
  }

  function reconcileElement(current: Element, next: Element): Element {
    if (current.tagName !== next.tagName || current.id !== next.id) {
      pauseRemovedMedia(current);
      current.replaceWith(next);
      return next;
    }
    // Avoid touching deck internals; their CSS/WAAPI state belongs to the deck runtime.
    const preserveDeckChildren = current.classList.contains("deck-scope");
    for (const attribute of [...current.attributes]) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes]) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    if (preserveDeckChildren) return current;
    if (current instanceof HTMLMediaElement || current instanceof HTMLImageElement) return current;
    const oldChildren = [...current.childNodes];
    const keyedChildren = new Map(oldChildren.filter((child): child is Element => child instanceof Element && Boolean(child.id)).map((child) => [child.id, child]));
    let cursor = current.firstChild;
    for (const nextChild of [...next.childNodes]) {
      const candidate = nextChild instanceof Element && nextChild.id ? keyedChildren.get(nextChild.id) : cursor;
      const atCursor = candidate === cursor;
      let child = nextChild;
      if (candidate instanceof Element && nextChild instanceof Element) child = reconcileElement(candidate, nextChild);
      else if (candidate?.nodeType === Node.TEXT_NODE && nextChild.nodeType === Node.TEXT_NODE) {
        if (candidate.textContent !== nextChild.textContent) candidate.textContent = nextChild.textContent;
        child = candidate;
      }
      if (!atCursor && child !== cursor) current.insertBefore(child, cursor);
      cursor = child.nextSibling;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      if (cursor instanceof Element) pauseRemovedMedia(cursor);
      cursor.remove();
      cursor = next;
    }
    return current;
  }

  // Preflight completes before the caller reverts its current GSAP timeline.
  return () => {
    const currentNodes = new Map([...root.children]
      .filter((node) => node.matches(".clip, .composition-audio, .composition-transition-overlay"))
      .map((node) => [node.id, node]));
    const anchor = root.querySelector(".composition-editor-grid");
    const nextIds = new Set(nextNodes.map((node) => node.id));
    for (const [id, node] of currentNodes) {
      if (nextIds.has(id)) continue;
      pauseRemovedMedia(node);
      node.remove();
      currentNodes.delete(id);
    }
    let cursor = root.querySelector(":scope > .clip, :scope > .composition-audio, :scope > .composition-transition-overlay") || anchor;
    for (const node of nextNodes) {
      const current = currentNodes.get(node.id);
      const resolved = current ? reconcileElement(current, node) : node;
      currentNodes.delete(node.id);
      // Touch sibling order only when the canonical stacking order changes.
      if (resolved !== cursor) root.insertBefore(resolved, cursor);
      cursor = resolved.nextElementSibling || anchor;
    }
    root.style.width = scene.canvas.width + "px";
    root.style.height = scene.canvas.height + "px";
  };
}
