"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Apple,
  ArrowLeft,
  CheckCircle2,
  Download,
  Laptop,
  Monitor,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface WorkerDownloadOption {
  description: string;
  href: string;
  id: "windows" | "macos" | "linux";
  label: string;
  meta: string;
}

interface WorkerDownloadPanelProps {
  fallbackDownloadUrl: string;
  options: WorkerDownloadOption[];
  version: string;
}

const platformIcon = {
  windows: Monitor,
  macos: Apple,
  linux: Terminal,
};

function detectPlatform(userAgent: string): WorkerDownloadOption["id"] | null {
  const normalized = userAgent.toLowerCase();
  if (normalized.includes("windows")) return "windows";
  if (normalized.includes("mac os") || normalized.includes("macintosh")) return "macos";
  if (normalized.includes("linux")) return "linux";
  return null;
}

export function WorkerDownloadPanel({
  fallbackDownloadUrl,
  options,
  version,
}: WorkerDownloadPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [suggestedPlatform, setSuggestedPlatform] = useState<WorkerDownloadOption["id"] | null>(null);

  useEffect(() => {
    setSuggestedPlatform(detectPlatform(window.navigator.userAgent));
  }, []);

  const resolvedOptions = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        href: option.href || fallbackDownloadUrl,
      })),
    [fallbackDownloadUrl, options],
  );

  const hasAnyDownload = resolvedOptions.some((option) => option.href);
  const returnTo = useMemo(() => {
    const candidate = searchParams.get("returnTo");
    if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return null;
    return candidate;
  }, [searchParams]);

  const handleGoBack = () => {
    if (returnTo) {
      router.push(returnTo);
      return;
    }

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950 selection:bg-[#00D4B3]/30 dark:bg-[#0F1419] dark:text-white">
      <header className="border-b border-gray-200 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-[#151A21]/90">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00D4B3]/10 text-[#00A98F] ring-1 ring-[#00D4B3]/20">
              <Laptop className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400">
                SofLIA - Engine
              </p>
              <p className="text-lg font-bold">Render Worker</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={handleGoBack}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-[#00D4B3]/50 hover:text-[#008B78] dark:border-white/10 dark:text-slate-200 dark:hover:text-[#00D4B3]"
          >
            <span className="inline-flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Regresar
            </span>
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-16">
        <section className="space-y-8">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#00D4B3]/25 bg-[#00D4B3]/10 px-3 py-1 text-sm font-semibold text-[#008B78] dark:text-[#67E8D5]">
              <CheckCircle2 className="h-4 w-4" />
              Version {version}
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-5xl">
              Descarga el worker local para ensamblar videos desde tu equipo
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-gray-600 dark:text-slate-300">
              SofLIA - Engine Render Worker conecta tu computadora con SofLIA - Engine para ejecutar renders Remotion
              autorizados, subir el MP4 final y mantener el estado sincronizado con la plataforma.
            </p>
          </div>

          {!hasAnyDownload ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Descargas pendientes de configurar</p>
                <p className="mt-1">
                  Define las URLs publicas con las variables `NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_WINDOWS_URL`,
                  `NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_MACOS_URL` y `NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_LINUX_URL`.
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            {resolvedOptions.map((option) => {
              const Icon = platformIcon[option.id];
              const isSuggested = suggestedPlatform === option.id;
              const disabled = !option.href;

              return (
                <article
                  key={option.id}
                  className="flex min-h-[260px] flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151A21]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    {isSuggested ? (
                      <span className="rounded-full bg-[#00D4B3]/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#008B78] dark:text-[#67E8D5]">
                        Sugerido
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-5 text-xl font-bold">{option.label}</h2>
                  <p className="mt-2 flex-1 text-sm leading-6 text-gray-600 dark:text-slate-300">
                    {option.description}
                  </p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                    {option.meta}
                  </p>
                  {disabled ? (
                    <button
                      type="button"
                      disabled
                      className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 text-sm font-bold text-gray-400 dark:bg-white/10 dark:text-slate-500"
                    >
                      No disponible
                    </button>
                  ) : (
                    <a
                      href={option.href}
                      className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0A2540] px-4 text-sm font-bold text-white transition hover:bg-[#123B63] dark:bg-[#00D4B3] dark:text-[#06131F] dark:hover:bg-[#67E8D5]"
                    >
                      <Download className="h-4 w-4" />
                      Descargar
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151A21]">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <ShieldCheck className="h-5 w-5 text-[#00A98F]" />
              Flujo seguro
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-slate-300">
              <li>Usa un codigo temporal generado desde SofLIA - Engine.</li>
              <li>No requiere `SUPABASE_SERVICE_ROLE_KEY` ni credenciales globales.</li>
              <li>Solo reclama jobs autorizados para la organizacion vinculada.</li>
              <li>Sube resultados mediante URLs firmadas de corta duracion.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151A21]">
            <h2 className="text-lg font-bold">Pasos de vinculacion</h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-gray-600 dark:text-slate-300">
              <li>1. Instala y abre el worker en tu computadora.</li>
              <li>2. En Produccion Visual, genera un codigo temporal.</li>
              <li>3. Pega el codigo en la app de escritorio.</li>
              <li>4. Pulsa Iniciar y deja el worker abierto durante el render.</li>
            </ol>
          </section>

        </aside>
      </main>
    </div>
  );
}
