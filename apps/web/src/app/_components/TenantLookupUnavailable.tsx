"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function TenantLookupUnavailable() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-gray-900 dark:bg-slate-950 dark:text-white">
      <section className="max-w-lg space-y-4" aria-live="polite">
        <h1 className="text-2xl font-semibold">No pudimos verificar los permisos de tu empresa</h1>
        <p>El servicio de permisos no está disponible temporalmente. El contenido se mostrará cuando podamos verificar tu acceso.</p>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => router.refresh())}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Verificando permisos…" : "Reintentar"}
        </button>
      </section>
    </main>
  );
}
