"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Command, Search, X } from "lucide-react";
import {
  COMPOSITION_EDITOR_COMMANDS,
  filterCompositionEditorCommands,
  type CompositionEditorCommandId,
} from "@/domains/production/composition-editor/composition-editor-command-palette";
import type { CompositionCommandPaletteItem } from "@/domains/production/composition-editor/composition-editor-command-actions";

export function CompositionCommandPalette({ items, onClose, onRun }: {
  items: readonly CompositionCommandPaletteItem[];
  onClose: () => void;
  onRun: (commandId: CompositionEditorCommandId) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const commands = useMemo(
    () => filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, query)
      .filter((command) => itemsById.has(command.id)),
    [itemsById, query],
  );
  const boundedActiveIndex = Math.min(activeIndex, Math.max(0, commands.length - 1));
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  function runCommand(commandId: CompositionEditorCommandId) {
    const item = itemsById.get(commandId);
    if (!item?.enabled) return;
    onClose();
    onRun(commandId);
  }

  function moveActive(delta: number) {
    if (commands.length === 0) return;
    setActiveIndex((current) => (Math.min(current, commands.length - 1) + delta + commands.length) % commands.length);
  }

  function keepFocusInsideDialog(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) || [])];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div
    className="fixed inset-0 z-[120] flex items-start justify-center bg-slate-950/55 px-4 pt-[12vh] backdrop-blur-sm"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    role="presentation"
  >
    <section
      ref={dialogRef}
      aria-labelledby="composition-command-palette-title"
      aria-modal="true"
      className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-white/15 dark:bg-slate-950"
      onKeyDown={(event) => {
        keepFocusInsideDialog(event);
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); onClose(); }
        else if (event.key === "ArrowDown") { event.preventDefault(); moveActive(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); }
        else if (event.key === "Enter" && commands[boundedActiveIndex]) {
          event.preventDefault();
          runCommand(commands[boundedActiveIndex].id);
        }
      }}
      role="dialog"
    >
      <h2 id="composition-command-palette-title" className="sr-only">Comandos del editor</h2>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 dark:border-white/10">
        <Search aria-hidden="true" className="shrink-0 text-slate-400" size={18} />
        <input
          ref={inputRef}
          aria-label="Buscar comandos del editor"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-4 text-sm text-slate-950 outline-none placeholder:text-slate-400 dark:text-white"
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          placeholder="Buscar una acción…"
          value={query}
        />
        <button type="button" aria-label="Cerrar paleta de comandos" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="max-h-[55vh] overflow-y-auto p-2" role="listbox" aria-label="Comandos disponibles">
        {commands.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-500">No hay comandos que coincidan.</p>}
        {commands.map((commandDefinition, index) => {
          const item = itemsById.get(commandDefinition.id)!;
          const selected = index === boundedActiveIndex;
          return <button
            key={commandDefinition.id}
            type="button"
            aria-disabled={!item.enabled}
            aria-selected={selected}
            data-command-id={commandDefinition.id}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${selected ? "bg-cyan-50 dark:bg-cyan-400/10" : "hover:bg-slate-50 dark:hover:bg-white/5"} ${item.enabled ? "" : "opacity-45"}`}
            onClick={() => runCommand(commandDefinition.id)}
            onMouseEnter={() => setActiveIndex(index)}
            role="option"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-gray-200"><Command size={14} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">{commandDefinition.label}{item.active && <Check aria-label="Activo" className="text-emerald-600" size={13} />}</span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-gray-400">{item.enabled ? commandDefinition.description : item.disabledReason || "No disponible en el contexto actual."}</span>
            </span>
            <span className="shrink-0 text-right"><small className="block text-[9px] font-bold uppercase tracking-wide text-slate-400">{commandDefinition.category}</small>{commandDefinition.shortcut && <kbd className="mt-1 block rounded border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-500 dark:border-white/15">{commandDefinition.shortcut}</kbd>}</span>
          </button>;
        })}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[10px] text-slate-500 dark:border-white/10 dark:text-gray-400"><span>↑↓ navegar · Enter ejecutar · Esc cerrar</span><span>Ctrl/Cmd+K</span></div>
    </section>
  </div>;
}
