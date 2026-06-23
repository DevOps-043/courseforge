"use client";

import { useEffect } from "react";
import { ErrorShell } from "./_components/ErrorShell";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <ErrorShell
          code="500"
          title="SofLIA - Engine se detuvo"
          description="Ocurrió un error crítico al renderizar la aplicación. Intenta recargar la vista o vuelve al menú principal."
          reset={reset}
        />
      </body>
    </html>
  );
}
