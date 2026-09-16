import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { CompositionAgentProposal } from "./composition-studio.types";
import styles from "./CompositionStudio.module.css";

interface CompositionAgentConversationProps {
  lastAppliedProposal: CompositionAgentProposal | null;
  onApprove: () => void;
  onDismiss: () => void;
  onPropose: (instruction: string) => Promise<void>;
  onUndo: () => void;
  proposal: CompositionAgentProposal | null;
  proposing: boolean;
  saving: boolean;
}

export function CompositionAgentConversation({ lastAppliedProposal, onApprove, onDismiss, onPropose, onUndo, proposal, proposing, saving }: CompositionAgentConversationProps) {
  type Message = { id: string; role: "assistant" | "user"; text: string };
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", text: "Cuéntame qué deseas modificar. Primero revisaré la composición y te explicaré el plan. Sólo aplicaré cambios cuando los confirmes." },
  ]);
  const proposalId = useRef<string | null>(null);

  useEffect(() => {
    if (!proposal || proposalId.current === proposal.proposalId) return;
    proposalId.current = proposal.proposalId;
    const recoveryMessage = proposal.recovery.usedFallback
      ? ` El modelo principal no pudo completar el contrato; usé el respaldo ${proposal.model}.`
      : proposal.recovery.repaired
        ? " El primer intento no cumplió el contrato y lo corregí automáticamente."
        : "";
    setMessages((current) => [...current, {
      id: `proposal-${proposal.proposalId}`,
      role: "assistant",
      text: `Así lo haré: ${proposal.summary} Esto implica ${proposal.operations.length} cambio(s).${recoveryMessage} ¿Confirmas que los aplique?`,
    }]);
  }, [proposal]);

  const send = async () => {
    const text = instruction.trim();
    if (text.length < 3 || proposing || proposal) return;
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: "user", text }]);
    setInstruction("");
    await onPropose(text);
  };

  const reject = () => {
    proposalId.current = null;
    setMessages((current) => [...current, { id: `reject-${Date.now()}`, role: "assistant", text: "Propuesta descartada. Dime cómo prefieres modificar la composición." }]);
    onDismiss();
  };

  return <section className={styles.agentPanel}>
    <div className="flex items-center gap-2.5 border-b border-[var(--engine-accent)]/25 bg-gradient-to-r from-[var(--engine-accent)]/15 to-white px-3 py-3 dark:to-[var(--engine-surface-hover)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-xs font-black text-[var(--engine-primary)] shadow-sm shadow-[var(--engine-accent)]/30 dark:shadow-none">S</span>
      <div className="min-w-0"><p className="truncate text-xs font-bold text-slate-900 dark:text-white">SofLIA</p><p className="flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Asistente de edición</p></div>
    </div>
    <div className="min-h-40 flex-1 space-y-3 overflow-y-auto px-3 py-4">
      {messages.map((message) => <div key={message.id} className={`flex items-end gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        {message.role === "assistant" && <span className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-[10px] font-black text-[var(--engine-primary)]">S</span>}
        <div className={`max-w-[84%] rounded-2xl px-3 py-2.5 text-xs leading-5 shadow-sm ${message.role === "user" ? "rounded-br-md bg-[var(--engine-primary)] text-white" : "rounded-bl-md border border-slate-100 bg-white text-slate-700 dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-100"}`}>{message.text}</div>
      </div>)}
      {proposing && <div className="flex items-end gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--engine-accent)] text-[10px] font-black text-[var(--engine-primary)]">S</span><div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-100 bg-white px-3 py-2.5 text-xs text-slate-600 shadow-sm dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-300"><Loader2 className="animate-spin text-[var(--engine-accent)]" size={13} /> Revisando la composición...</div></div>}
      {proposal && <div className="ml-8 rounded-xl border border-[var(--engine-accent)]/40 bg-[var(--engine-accent)]/10 p-3 text-xs text-[var(--engine-primary)] shadow-sm dark:text-[#E9ECEF]"><div className="flex items-center justify-between gap-2"><p className="font-bold">Esperando tu confirmación</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${proposal.risk.level === "HIGH" ? "bg-red-100 text-red-700" : proposal.risk.level === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>Riesgo {proposal.risk.level.toLowerCase()}</span></div><p className="mt-1 text-[11px] leading-4 opacity-80">No se guardará nada hasta que confirmes.</p><ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[10px] opacity-80">{proposal.diff.slice(0, 8).map((change, index) => <li key={`${change.entityType}-${change.entityId}-${change.path}-${index}`}>• {change.entityType.toLowerCase()} {change.entityId}: {change.path}</li>)}</ul>{proposal.validation.issues.length > 0 && <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">{proposal.validation.issues.map((issue) => issue.message).join(" ")}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={onApprove} className="rounded-lg bg-[var(--engine-primary)] px-3 py-1.5 font-bold text-white transition hover:bg-[#0d2f4d] disabled:opacity-50">Confirmar y aplicar</button><button type="button" disabled={saving} onClick={reject} className="rounded-lg border border-[var(--engine-accent)] bg-white px-3 py-1.5 font-bold text-[var(--engine-primary)] transition hover:bg-[var(--engine-accent)]/10 disabled:opacity-50 dark:bg-transparent dark:text-[var(--engine-accent)]">Rechazar</button></div></div>}
      {!proposal && lastAppliedProposal && <div className="ml-8 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm dark:border-white/10 dark:bg-[var(--engine-surface-hover)] dark:text-gray-200"><p className="font-bold">Edición aplicada</p><p className="mt-1 text-[10px] opacity-75">Puedes deshacerla mientras no se guarden cambios posteriores.</p><button type="button" disabled={saving} onClick={onUndo} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 font-bold hover:bg-slate-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5">Deshacer edición</button></div>}
    </div>
    <div className="border-t border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#101720]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-1.5 transition focus-within:border-[var(--engine-accent)] focus-within:ring-2 focus-within:ring-[var(--engine-accent)]/15 dark:border-white/15 dark:bg-slate-950">
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={1500} rows={2} placeholder="Pide un cambio para la composición..." className="w-full resize-none bg-transparent px-1 py-0 text-xs leading-4 text-slate-900 outline-none placeholder:text-slate-400 dark:text-white" />
        <div className="mt-0.5 flex items-center justify-between gap-2"><span className="text-[9px] text-slate-400">Enter para enviar · Shift + Enter para salto</span><button type="button" aria-label="Enviar mensaje" disabled={proposing || Boolean(proposal) || instruction.trim().length < 3} onClick={() => void send()} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--engine-primary)] text-white transition hover:bg-[#0d2f4d] disabled:cursor-not-allowed disabled:opacity-40"><Send size={12} /></button></div>
      </div>
    </div>
  </section>;
}
