"use client";

import { useEffect, useRef, useState } from "react";

export function ImportedSlidePreview({ html, title }: { html: string; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setScale(entries[0].contentRect.width / 1920));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className="relative aspect-video w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
    <iframe title={title} srcDoc={html} sandbox="" referrerPolicy="no-referrer" className="absolute left-0 top-0 border-0"
      style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
  </div>;
}
