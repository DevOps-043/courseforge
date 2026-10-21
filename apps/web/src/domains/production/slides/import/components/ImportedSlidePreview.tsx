"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportedSlideAsset } from "../imported-slide-assets.contract";
import { hydrateImportedPreview } from "../imported-slide-asset-renderer";

export function ImportedSlidePreview({ html = "", url, title, assets }: { html?: string; url?: string; title: string; assets?: ImportedSlideAsset[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const source = useMemo(() => hydrateImportedPreview(html, assets), [html, assets]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / 1920));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className="relative aspect-video w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
    <iframe title={title} src={url} srcDoc={url ? undefined : source} loading="lazy" sandbox="" referrerPolicy="no-referrer" className="absolute left-0 top-0 border-0"
      style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
  </div>;
}
