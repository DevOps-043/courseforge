"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { useAuthStore } from "@/core/stores/authStore";
import { useOrganizationStore } from "@/core/stores/organizationStore";
import { htmlSnapshotLocatorScopeSchema,readHtmlSnapshotLocator,rememberHtmlSnapshotLocator,
  clearConfirmedHtmlSnapshotLocator,resolveHtmlSnapshotLocatorStorage,type HtmlSnapshotLocator,type HtmlSnapshotLocatorScope } from "@/domains/production/composition-editor/composition-html-snapshot-locator.client";
import { consultHtmlSnapshotRecovery } from "@/domains/production/composition-editor/composition-html-snapshot-recovery.client";
import {canCloseHtmlSnapshotTracking,type HtmlSnapshotRecoverySummary} from "@/domains/production/composition-editor/composition-html-snapshot-recovery.contract";
import {sendTrackedHtmlSnapshotPublication} from "@/domains/production/composition-editor/composition-html-snapshot-publication-http.client";
import {resolveHtmlSnapshotPublicationLock} from "@/domains/production/composition-editor/composition-html-snapshot-publication-lock.client";
import {resolveHtmlSnapshotPublicationAdmission,type HtmlSnapshotEditorPublicationContext} from "@/domains/production/composition-editor/composition-html-snapshot-publication-admission";
import {HtmlSnapshotClientPublicationError} from "@/domains/production/composition-editor/composition-html-snapshot-publication.client";
import styles from "./CompositionStudio.module.css";

const enabled = process.env.NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED === "true";
const publicationEnabled=process.env.NEXT_PUBLIC_COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED === "true";
type Publication={context:HtmlSnapshotEditorPublicationContext;getContext:()=>HtmlSnapshotEditorPublicationContext;
  onRegistered:(signal:AbortSignal)=>Promise<void>};
/** Explicit opt-in registration and recovery, no automatic polling/render. */
export function CompositionHtmlSnapshotRecoveryPanel({draftId,publication}:{draftId:string;publication?:Publication}) {
  const actorId = useAuthStore(state => state.user?.id ?? null);
  const organizationId = useOrganizationStore(state => state.activeOrganizationId);
  const scope = useMemo(() => {
    const parsed = htmlSnapshotLocatorScopeSchema.safeParse({actorId,organizationId,draftId});
    return parsed.success ? parsed.data : null;
  },[actorId,organizationId,draftId]);
  if (!enabled || !scope) return null;
  return <ScopedRecoveryPanel key={`${scope.actorId}:${scope.organizationId}:${scope.draftId}`} scope={scope} publication={publication} />;
}

/** Keyed ownership boundary unmounts old requests/state on account or tenant change. */
function ScopedRecoveryPanel({scope,publication}:{scope:HtmlSnapshotLocatorScope;publication?:Publication}) {
  const [locator,setLocator] = useState<HtmlSnapshotLocator | null>(null);
  const [operationId,setOperationId] = useState("");
  const [result,setResult] = useState<HtmlSnapshotRecoverySummary | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [busy,setBusy] = useState(false);
  const [trackingReady,setTrackingReady]=useState(false);
  const [browserAvailable,setBrowserAvailable]=useState(false);
  const [notice,setNotice]=useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    requestRef.current?.abort();setBusy(false);setResult(null);setError(null);setOperationId("");
    const storage=resolveHtmlSnapshotLocatorStorage();
    setLocator(readHtmlSnapshotLocator(storage,scope));
    setBrowserAvailable(Boolean(storage && resolveHtmlSnapshotPublicationLock()));setTrackingReady(true);
    return () => {requestRef.current?.abort();};
  },[scope]);
  async function consult() {
    if (busy || requestRef.current) return;
    const storage = resolveHtmlSnapshotLocatorStorage();
    const requested = locator?.operationId ?? operationId.trim();
    try {
      const remembered = rememberHtmlSnapshotLocator(storage,scope,requested);
      if (remembered === "STORAGE_UNAVAILABLE") throw new Error("No se pudo guardar el seguimiento en este navegador.");
      if (remembered === "DIFFERENT_PENDING") throw new Error("Ya hay otra operación pendiente de confirmar en este borrador.");
      setLocator(readHtmlSnapshotLocator(storage,scope));
    } catch {setError("No se pudo guardar el seguimiento. Revisa el identificador y el almacenamiento del navegador.");return;}
    const controller = new AbortController();requestRef.current = controller;setBusy(true);setError(null);setResult(null);setNotice(null);
    try {
      const confirmed = await consultHtmlSnapshotRecovery({draftId:scope.draftId,operationId:requested,signal:controller.signal});
      if (!controller.signal.aborted && requestRef.current === controller) {
        setResult(confirmed);
        if (publication && (confirmed.status === "COMMITTED_ACTIVE" || confirmed.status === "COMMITTED_SUPERSEDED")) {
          try {await publication.onRegistered(controller.signal);}
          catch {if (!controller.signal.aborted) setNotice("El registro quedó confirmado; no se pudo actualizar el historial. No repitas la publicación.");}
        }
      }
    } catch {
      if (!controller.signal.aborted && requestRef.current === controller) setError("No se pudo confirmar el estado. La operación no se ha repetido.");
    } finally {if (requestRef.current === controller) {requestRef.current=null;if (!controller.signal.aborted) setBusy(false);}}
  }
  const admission=publication ? resolveHtmlSnapshotPublicationAdmission({enabled:publicationEnabled,context:publication.context,
    trackingReady,trackingPending:Boolean(locator),storageAvailable:browserAvailable,lockAvailable:browserAvailable}) : "DISABLED";
  async function publish() {
    if (!publication || busy || requestRef.current) return;
    const storage=resolveHtmlSnapshotLocatorStorage(),lock=resolveHtmlSnapshotPublicationLock();
    const context=publication.getContext();
    const currentLocator=readHtmlSnapshotLocator(storage,scope);
    const currentAdmission=resolveHtmlSnapshotPublicationAdmission({enabled:publicationEnabled,context,trackingReady,
      trackingPending:Boolean(currentLocator),storageAvailable:Boolean(storage),lockAvailable:Boolean(lock)});
    if (currentAdmission !== "READY") {setError("No se puede registrar todavía. Revisa el guardado y el seguimiento pendiente.");setLocator(currentLocator);return;}
    const controller=new AbortController();requestRef.current=controller;setBusy(true);setError(null);setResult(null);setNotice(null);
    try {
      const confirmed=await sendTrackedHtmlSnapshotPublication({scope,storage,lock,documentHash:context.documentHash!,
        expectedActiveRevisionId:context.expectedActiveRevisionId,renderProfileId:context.renderProfileId,signal:controller.signal});
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setResult(confirmed);setLocator(readHtmlSnapshotLocator(storage,scope));
      // Registration already succeeded. A history-refresh failure is not a
      // publication failure and must never invite a second POST.
      try {
        // The callback refreshes revision metadata only, preserving the editor's
        // document and current profile, including changes made during dispatch.
        await publication.onRegistered(controller.signal);
        if (!controller.signal.aborted && publication.getContext().documentHash !== context.documentHash)
          setNotice("Se registró la versión guardada enviada. Tus cambios posteriores no se han incluido.");
      } catch {if (!controller.signal.aborted) setNotice("La revisión se registró; no se pudo actualizar el historial. Consulta su estado sin repetir el envío.");}
    } catch (caught) {
      if (!controller.signal.aborted && requestRef.current === controller) {
        setLocator(readHtmlSnapshotLocator(storage,scope));
        setError(caught instanceof HtmlSnapshotClientPublicationError && caught.code !== "OUTCOME_UNKNOWN"
          ? "El envío no se inició. Revisa el seguimiento pendiente y la disponibilidad del navegador."
          : "No se pudo confirmar el registro. Consulta el seguimiento; no vuelvas a enviarlo automáticamente.");
      }
    } finally {
      if (requestRef.current === controller) {requestRef.current=null;if (!controller.signal.aborted) setBusy(false);}
    }
  }
  const terminal = canCloseHtmlSnapshotTracking(locator?.operationId ?? null,result);
  return <section className={styles.deliveryBody} aria-label="Recuperar publicación HTML">
    <strong>Seguimiento de publicación HTML</strong>
    <p>Consultar no vuelve a publicar ni cambia la revisión activa.</p>
    {publicationEnabled && publication?.context.hasHtmlEditing && <>
      <p>Registrar crea o reutiliza una revisión guardada y puede cambiar la revisión activa. No genera un video ni certifica el render.</p>
      <button type="button" className={styles.deliveryActionSecondary} disabled={busy || admission !== "READY"} onClick={() => void publish()}>
        {busy ? "Procesando seguimiento…" : "Registrar revisión HTML guardada"}
      </button>
      {admission === "SAVE_OR_PREVIEW_PENDING" && <p>Guarda o resuelve los cambios y previews pendientes antes de registrar.</p>}
      {admission === "NOT_READY" && <p>Espera a que se cargue el documento y su historial.</p>}
      {admission === "BROWSER_UNAVAILABLE" && <p>Este navegador no permite el seguimiento y la coordinación necesarios para publicar.</p>}
    </>}
    {locator ? <p>Hay una operación guardada pendiente de confirmación.</p> : <label className={styles.outputProfile}>
      Identificador de operación
      <input aria-label="Identificador de operación HTML" value={operationId} maxLength={36} autoComplete="off"
        onChange={event => setOperationId(event.target.value)} />
    </label>}
    <button type="button" className={styles.deliveryActionSecondary} disabled={busy || (!locator && !operationId)} onClick={() => void consult()}>
      {busy ? "Consultando…" : "Consultar estado"}
    </button>
    <div role="status" aria-live="polite">
      {result?.status === "COMMITTED_ACTIVE" && <p>La publicación quedó registrada y esa revisión sigue activa.</p>}
      {result?.status === "COMMITTED_SUPERSEDED" && <p>La publicación quedó registrada, pero ya no es la revisión activa. No se ha reactivado.</p>}
      {result?.status === "INTENT_ONLY" && <p>Se guardó el seguimiento, pero no se ha confirmado la publicación. No vuelvas a enviarla automáticamente.</p>}
      {result?.status === "NO_INTENT" && <p>No se encontró el seguimiento en el servidor. Esto no confirma que la carga haya fallado.</p>}
      {error && <p>{error}</p>}
      {notice && <p>{notice}</p>}
    </div>
    {terminal && locator && <button type="button" className={styles.deliveryActionGhost} disabled={busy} onClick={() => {
      if (clearConfirmedHtmlSnapshotLocator(resolveHtmlSnapshotLocatorStorage(),scope,result!.operationId,result!.status)) {
        setLocator(null);setResult(null);setOperationId("");setNotice(null);
      } else setError("El seguimiento cambió o no se pudo cerrar. Consulta nuevamente.");
    }}>Cerrar seguimiento confirmado</button>}
  </section>;
}
