"use client";

import { AlertCircle, CheckCircle2, Clock3, Loader2, PauseCircle, XCircle } from "lucide-react";
import type { DeliveryRunUnit } from "../services/delivery-commands";
import styles from "./delivery-ui.module.css";

const STATES = {
  RUNNING: { title: "Generando materiales síncronos", description: "La ejecución sigue activa. Los errores de una sesión se muestran por separado mientras las demás continúan.", icon: Loader2 },
  QUEUED: { title: "Generación síncrona en cola", description: "La solicitud espera a que el worker comience. Todavía no está generando contenido.", icon: Clock3 },
  FAILED: { title: "Generación síncrona finalizada con errores", description: "Esta ejecución ya no está generando. Revisa las sesiones con error; el contenido confirmado se conserva.", icon: AlertCircle },
  COMPLETED: { title: "Generación síncrona completada", description: "La generación terminó. Revisa los materiales antes de aprobarlos; generar no equivale a aprobar.", icon: CheckCircle2 },
  PAUSED: { title: "Generación síncrona en pausa", description: "Esta ejecución no está generando. Conserva el progreso y permite reanudar los pendientes cuando se resuelva el bloqueo.", icon: PauseCircle },
  CANCELLED: { title: "Generación síncrona cancelada", description: "Esta ejecución no continuará guardando nuevas unidades. El trabajo confirmado se conserva.", icon: XCircle },
} as const;

export function DeliveryMaterialRunStatus({ status, units }: { status: string; units: DeliveryRunUnit[] }) {
  const state = Object.hasOwn(STATES,status) ? STATES[status as keyof typeof STATES] : null;
  if (!state) return <div role="status" className={styles.runStatus}>Estado de generación no reconocido. Actualiza para consultar el estado vigente.</div>;
  const Icon = state.icon;
  const saved = units.filter(unit=>unit.ready).length;
  const failures = units.filter(unit=>!unit.ready && unit.error).length;
  return <div role={status === "FAILED" ? "alert" : "status"} className={styles.runStatus} data-run-state={status}>
    <Icon aria-hidden="true" size={22} className={status === "RUNNING" ? "animate-spin" : ""} />
    <div className="space-y-2">
      <h3>{state.title}</h3>
      <p>{state.description}</p>
      <p><strong>{saved} de {units.length} sesiones guardadas</strong>{failures > 0 ? ` · ${failures} con error` : ""}.</p>
    </div>
  </div>;
}
