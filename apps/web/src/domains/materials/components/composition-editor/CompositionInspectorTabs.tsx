import { ArrowRightLeft, MousePointer2, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";

import styles from "./CompositionStudio.module.css";

export type CompositionInspectorTab = "assistant" | "properties" | "selection" | "transitions";

interface CompositionInspectorTabsProps {
  activeTab: CompositionInspectorTab;
  selectedClipCount: number;
  transitionCount: number;
  onSelect: (tab: CompositionInspectorTab) => void;
}

interface InspectorTabDefinition {
  icon: LucideIcon;
  id: CompositionInspectorTab;
  label: string;
}

const INSPECTOR_TABS: InspectorTabDefinition[] = [
  { icon: SlidersHorizontal, id: "properties", label: "Propiedades" },
  { icon: MousePointer2, id: "selection", label: "Selección" },
  { icon: ArrowRightLeft, id: "transitions", label: "Transiciones" },
  { icon: Sparkles, id: "assistant", label: "SofLIA" },
];

export function CompositionInspectorTabs({
  activeTab,
  onSelect,
  selectedClipCount,
  transitionCount,
}: CompositionInspectorTabsProps) {
  const counts: Partial<Record<CompositionInspectorTab, number>> = {
    selection: selectedClipCount,
    transitions: transitionCount,
  };

  return (
    <div aria-label="Secciones del inspector" className={styles.inspectorTabs} role="group">
      {INSPECTOR_TABS.map(({ icon: Icon, id, label }) => {
        const count = counts[id] || 0;
        const accessibleLabel = count > 0 ? `${label}: ${count}` : label;

        return (
          <button
            aria-label={accessibleLabel}
            aria-pressed={activeTab === id}
            className={`${styles.inspectorTab} ${activeTab === id ? styles.inspectorTabActive : ""}`}
            key={id}
            onClick={() => onSelect(id)}
            title={accessibleLabel}
            type="button"
          >
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
            {count > 0 ? <span aria-hidden="true" className={styles.inspectorTabBadge}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
