"use client";
import { useState } from "react";
import { sourceJsonRequest } from "./course-source.client";
type LegacySource = {
  id: string;
  kind: string;
  title: string;
  diagnostic: string;
};
export function CourseSourceLegacyImport({
  root,
  onImported,
}: {
  root: string;
  onImported: () => Promise<void>;
}) {
  const [sources, setSources] = useState<LegacySource[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function importSource(source: LegacySource) {
    if (
      !window.confirm(
        `${source.diagnostic} ¿Importar a la biblioteca privada? La fuente histórica se conservará y deberás procesar y revisar la nueva copia.`,
      )
    )
      return;
    setBusy(true);
    try {
      const key = `source-legacy:${root}:${source.kind}:${source.id}`;
      const idempotencyKey = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, idempotencyKey);
      const result = await sourceJsonRequest(`${root}/legacy`, {
        kind: source.kind,
        sourceId: source.id,
        idempotencyKey,
      });
      setMessage(
        result.originalAvailable
          ? "Original copiado. Procesa y revisa el documento de la biblioteca."
          : "TXT derivado importado; el binario original histórico no está disponible. Procesa y revisa el documento.",
      );
      await onImported();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo importar la fuente histórica.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Fuentes históricas" className="mt-4 border-t pt-3">
      <button
        disabled={busy}
        onClick={() =>
          void sourceJsonRequest(`${root}/legacy`)
            .then((result) => {
              setSources(result.sources);
              setMessage(
                result.sources.length
                  ? "Elige qué fuente importar."
                  : "No hay fuentes históricas para este curso.",
              );
            })
            .catch((error) => setMessage(error.message))
        }
      >
        Consultar fuentes históricas
      </button>
      <p role="status">{message}</p>
      <ul>
        {sources.map((source) => (
          <li key={`${source.kind}:${source.id}`} className="my-3 break-words">
            <p>
              {source.title}: {source.diagnostic}
            </p>
            <button disabled={busy} onClick={() => void importSource(source)}>
              Importar a la biblioteca
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
