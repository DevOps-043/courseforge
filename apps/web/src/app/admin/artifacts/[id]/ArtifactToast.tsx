"use client";

import { AlertCircle, CheckCircle2, RotateCw, X } from "lucide-react";

interface ArtifactToastProps {
  toast: {
    show: boolean;
    message: string;
    type: "success" | "error" | "info";
  };
  onClose: () => void;
}

export function ArtifactToast({ toast, onClose }: ArtifactToastProps) {
  if (!toast.show) return null;

  return (
    <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md ${
          toast.type === "success"
            ? "bg-[#00D4B3]/10 border-[#00D4B3]/20 text-[#00D4B3]"
            : toast.type === "error"
              ? "bg-[#EF4444]/10 border-[#EF4444]/20 text-[#EF4444]"
              : "bg-[#151A21] border-[#6C757D]/20 text-white"
        }`}
      >
        {toast.type === "success" && <CheckCircle2 size={18} />}
        {toast.type === "error" && <AlertCircle size={18} />}
        {toast.type === "info" && <RotateCw size={18} className="animate-spin" />}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={onClose} className="ml-2 opacity-50">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
