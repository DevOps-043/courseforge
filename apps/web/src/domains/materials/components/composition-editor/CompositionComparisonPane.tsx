import type { CSSProperties, RefObject } from "react";
import { Loader2 } from "lucide-react";
import styles from "./CompositionStudio.module.css";

interface CompositionComparisonPaneProps {
  canvasHeight: number;
  canvasWidth: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  label: string;
  description: string;
  previewUrl: string;
  loading?: boolean;
  interactive?: boolean;
}

export function CompositionComparisonPane({ canvasHeight, canvasWidth, frameRef, label, description, previewUrl, loading = false, interactive = false }: CompositionComparisonPaneProps) {
  const frameStyle = {
    "--composition-aspect-ratio": canvasWidth / canvasHeight,
    aspectRatio: `${canvasWidth} / ${canvasHeight}`,
  } as CSSProperties;

  return <section className={styles.comparisonPane} aria-label={label}>
    <div className={styles.comparisonHeader}>
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
    </div>
    <div className={styles.previewStage}>
      <div className={styles.previewFrame} style={frameStyle}>
        <iframe
          ref={frameRef}
          title={label}
          src={previewUrl}
          sandbox="allow-scripts"
          allow="autoplay"
          className={styles.comparisonFrame}
          style={{ pointerEvents: interactive ? "auto" : "none" }}
        />
        {loading && <div className={styles.mediaPreparing}><div className={styles.mediaStatus}><Loader2 className="animate-spin" size={15} /> Preparando comparación…</div></div>}
      </div>
    </div>
  </section>;
}
