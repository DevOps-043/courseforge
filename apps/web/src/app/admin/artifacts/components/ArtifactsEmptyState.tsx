import Link from "next/link";
import { FileText } from "lucide-react";

export function ArtifactsEmptyState({ basePath }: { basePath: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#151A21]/50 border border-dashed border-gray-200 dark:border-[#6C757D]/20 rounded-2xl shadow-sm dark:shadow-none transition-colors">
      <div className="w-16 h-16 bg-[#1F5AF6]/10 rounded-full flex items-center justify-center text-[#1F5AF6] mb-4">
        <FileText size={32} />
      </div>
      <h3 className="text-gray-900 dark:text-white font-medium text-lg mb-1">
        No hay artefactos
      </h3>
      <p className="text-gray-500 dark:text-[#94A3B8] text-sm mb-6">
        Genera tu primer artefacto para comenzar
      </p>
      <Link
        href={`${basePath}/artifacts/new`}
        className="bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-colors"
      >
        Generar Artefacto
      </Link>
    </div>
  );
}
