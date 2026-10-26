"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeliverySnapshot } from "../services/delivery-api";
import type { z } from "zod";
import type { deliveryCommandSchema } from "../services/delivery-api";
import { usePolling } from "../../../shared/hooks/usePolling";
import { DELIVERY_LIMITS } from "../config/delivery.config";

type CommandInput = z.infer<typeof deliveryCommandSchema> extends infer Command ? Command extends { revision: number } ? Omit<Command, "revision"> : never : never;
export function useCourseDelivery(artifactId: string) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<DeliverySnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeArtifact = useRef(artifactId);
  const refresh = useCallback(async (progress = false) => {
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/delivery${progress ? "?progress=1" : ""}`, { cache: "no-store", signal: AbortSignal.timeout(DELIVERY_LIMITS.snapshotTimeoutMs) });
      const result = await response.json();
      if (activeArtifact.current !== artifactId) return;
      if (!response.ok) throw new Error(result.message || "No se pudo leer la impartición.");
      setSnapshot(previous => progress ? { ...result, settings: previous?.settings || [] } : result); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo actualizar."); }
  }, [artifactId]);
  useEffect(() => {
    activeArtifact.current = artifactId;
    setSnapshot(null); setError("");
    void refresh();
    return () => { activeArtifact.current = ""; };
  }, [artifactId, refresh]);
  const running = snapshot?.run && ["QUEUED", "RUNNING"].includes(snapshot.run.status);
  usePolling(() => refresh(true), Boolean(running), { intervalMs: DELIVERY_LIMITS.pollIntervalMs });
  const command = async (input: CommandInput) => {
    if (!snapshot || snapshot.workspace.artifact_id !== artifactId) throw new Error("Espera a que cargue el curso.");
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/delivery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, revision: snapshot.workspace.revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "No se pudo completar la operación.");
      await refresh(); router.refresh();
      return result;
    } catch (failure) { const message = failure instanceof Error ? failure.message : "No se pudo completar la operación."; setError(message); throw new Error(message); }
    finally { setBusy(false); }
  };
  return { snapshot, busy, error, refresh, command, artifactId };
}
export type CourseDeliveryController = ReturnType<typeof useCourseDelivery>;
