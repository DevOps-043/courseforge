"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Home, LogIn, RefreshCw } from "lucide-react";

type ErrorShellProps = {
  code: "400" | "404" | "500";
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
  primaryMode?: "home" | "login";
  reset?: () => void;
};

const LEGACY_ROOTS = new Set([
  "admin",
  "architect",
  "builder",
  "dashboard",
  "login",
  "register",
  "privacy",
  "400",
]);

function getMainMenuHref(pathname: string | null) {
  const firstSegment = pathname?.split("/").filter(Boolean)[0];

  if (firstSegment && !LEGACY_ROOTS.has(firstSegment)) {
    return `/${firstSegment}/admin`;
  }

  return "/admin";
}

export function ErrorShell({
  code,
  description,
  primaryHref,
  primaryLabel,
  primaryMode = "home",
  reset,
  title,
}: ErrorShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const mainMenuHref = primaryHref ?? getMainMenuHref(pathname);
  const isServerError = code === "500";
  const PrimaryIcon = primaryMode === "login" ? LogIn : Home;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-[#050B14] dark:text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">
            <AlertTriangle size={22} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">SofLIA - Engine</p>
            <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">Centro de operaciones</p>
          </div>
        </div>

        <section className="max-w-2xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.28em] text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">
            Error {code}
          </p>
          <h1 className="text-4xl font-bold leading-tight text-gray-950 dark:text-white md:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-gray-600 dark:text-[var(--engine-text-muted)] md:text-lg">
            {description}
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={mainMenuHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--engine-info)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--engine-info)]/20 transition hover:bg-[var(--engine-info)]"
          >
            <PrimaryIcon size={18} />
            {primaryLabel ?? "Ir al menu principal"}
          </Link>

          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          >
            <ArrowLeft size={18} />
            Regresar
          </button>

          {isServerError && reset ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 px-5 py-3 text-sm font-semibold text-[#008B76] transition hover:bg-[var(--engine-accent)]/15 dark:text-[var(--engine-accent)]"
            >
              <RefreshCw size={18} />
              Intentar de nuevo
            </button>
          ) : null}
        </div>

        <div className="mt-12 grid max-w-3xl gap-4 border-t border-gray-200 pt-6 text-sm text-gray-600 dark:border-white/10 dark:text-[var(--engine-text-muted)] md:grid-cols-3">
          <div>
            <p className="font-semibold text-gray-950 dark:text-white">Ruta actual</p>
            <p className="mt-1 break-all">{pathname || "No disponible"}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-950 dark:text-white">Siguiente paso</p>
            <p className="mt-1">Vuelve al menu de tu empresa y retoma el flujo.</p>
          </div>
          <div>
            <p className="font-semibold text-gray-950 dark:text-white">Soporte</p>
            <p className="mt-1">Si el problema continua, comparte esta pantalla con el equipo tecnico.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
