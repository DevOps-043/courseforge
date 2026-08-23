import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function QuickCreateCard({ href }: { href: string }) {
  return (
    <Link href={href} className="block">
      <div className="bg-[var(--engine-primary)] border border-[var(--engine-info)]/30 rounded-2xl p-5 relative overflow-hidden group hover:border-[var(--engine-info)] transition-all cursor-pointer shadow-lg">
        <div className="absolute top-[-30%] right-[-15%] w-[120px] h-[120px] bg-[var(--engine-info)]/20 rounded-full blur-[40px]" />
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-1">Nuevo artefacto</h3>
            <p className="text-xs text-[var(--engine-text-muted)]">Crear un curso para esta empresa</p>
          </div>
          <div className="w-9 h-9 bg-[var(--engine-info)] rounded-full flex items-center justify-center text-white shrink-0 group-hover:scale-110 transition-transform">
            <ArrowUpRight size={18} />
          </div>
        </div>
      </div>
    </Link>
  );
}
