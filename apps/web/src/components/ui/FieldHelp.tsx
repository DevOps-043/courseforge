import { HelpTooltip } from "./HelpTooltip";

export type FieldHelpSelection = { label: string; description: string };

/** Mantiene el patrón de ayuda de prompts y refleja la selección vigente. */
export function FieldHelp({ label, description, selection }: {
  label: string;
  description: string;
  selection?: FieldHelpSelection;
}) {
  return <span data-field-help className="inline-flex shrink-0"><HelpTooltip ariaLabel={`Ayuda: ${label}`} align="end" stopPropagation>
    <span className="block font-semibold text-[var(--engine-text)]">{label}</span>
    <span className="mt-1 block">{description}</span>
    {selection && <span className="mt-3 block border-t border-[var(--engine-border)] pt-2">
      <span className="block font-semibold text-[var(--engine-text)]">Selección actual: {selection.label}</span>
      <span className="mt-1 block">{selection.description}</span>
    </span>}
  </HelpTooltip></span>;
}
