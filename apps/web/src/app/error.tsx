"use client";

import { useEffect } from "react";
import { ErrorShell } from "./_components/ErrorShell";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <ErrorShell
      code="500"
      title="Algo falló al cargar"
      description="El sistema encontró un error inesperado. Puedes intentar de nuevo o regresar al menú principal de tu empresa."
      reset={reset}
    />
  );
}
