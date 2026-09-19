"use client";

import { useState } from "react";
import { COMPOSITION_SHORTCUTS } from "@/domains/production/composition-editor/composition-shortcuts";
import styles from "./CompositionStudio.module.css";

export function CompositionShortcutsPanel() {
  const [query, setQuery] = useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const entries = COMPOSITION_SHORTCUTS.filter((entry) => normalize(`${entry.label} ${entry.keys} ${entry.context} ${entry.group}`).includes(normalize(query.trim())));
  const groups = [...new Set(entries.map((entry) => entry.group))];
  return <div className={styles.shortcutsPanel}>
    <h3>Atajos de teclado</h3>
    <p>Funcionan cuando el área indicada tiene el foco. Mientras escribes, se conservan los controles del campo.</p>
    <label>Buscar acción o tecla<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Espacio, fotograma, snap…" /></label>
    {groups.map((group) => <section key={group} aria-label={group}>
      <h4>{group}</h4>
      <dl>{entries.filter((entry) => entry.group === group).map((entry) => <div key={entry.id} className={styles.shortcutRow}>
        <dt>{entry.label}<kbd>{entry.keys}</kbd></dt><dd>{entry.context}</dd>
      </div>)}</dl>
    </section>)}
    {!entries.length && <p role="status">No hay atajos que coincidan con la búsqueda.</p>}
  </div>;
}
