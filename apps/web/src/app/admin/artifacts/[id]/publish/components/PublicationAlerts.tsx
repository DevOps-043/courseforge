'use client';

import { AlertTriangle, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import styles from '../PublicationWorkspace.module.css';

interface PublicationAlertsProps {
  missingEmail: boolean;
  missingSlug: boolean;
  missingThumbnail: boolean;
  missingVideos: number;
  selectedLessonsCount: number;
  selectableLessonsCount: number;
}

export function PublicationAlerts({
  missingEmail,
  missingSlug,
  missingThumbnail,
  missingVideos,
  selectedLessonsCount,
  selectableLessonsCount,
}: PublicationAlertsProps) {
  const hasBlockers = missingEmail || missingSlug || missingThumbnail;
  const showPartialNotice =
    missingVideos > 0 ||
    (selectedLessonsCount > 0 &&
      selectedLessonsCount < selectableLessonsCount);
  const blockerCount = [missingEmail, missingSlug, missingThumbnail].filter(Boolean).length;

  return (
    <section className={styles.validationPanel} aria-label="Validación de publicación">
      <div className={styles.panelHeading}>
        <span className={styles.panelIcon} aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <span className={styles.eyebrow}>Validación</span>
          <h3>Antes de publicar</h3>
        </div>
        <span className={styles.validationBadge} data-state={hasBlockers ? 'blocked' : 'ready'}>
          {hasBlockers ? `${blockerCount} pendiente${blockerCount === 1 ? '' : 's'}` : 'Datos completos'}
        </span>
      </div>

      <div className={styles.validationList}>
        <ValidationItem label="Email del instructor" complete={!missingEmail} />
        <ValidationItem label="Slug estable del curso" complete={!missingSlug} />
        <ValidationItem label="Imagen de portada" complete={!missingThumbnail} />
      </div>

      {showPartialNotice && (
        <div className={styles.partialNotice}>
          <AlertTriangle size={15} />
          <div>
            <strong>La entrega será parcial</strong>
            <p>
              {missingVideos > 0
                ? `${missingVideos} lecciones aún no tienen video. `
                : ''}
              Se enviarán {selectedLessonsCount} de {selectableLessonsCount} videos disponibles.
            </p>
          </div>
        </div>
      )}

      {!hasBlockers && !showPartialNotice && (
        <div className={styles.readyNotice}>
          <Check size={15} />
          <span>La configuración está lista para enviarse.</span>
        </div>
      )}
    </section>
  );
}

function ValidationItem({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className={styles.validationItem} data-state={complete ? 'ready' : 'blocked'}>
      {complete ? <Check size={14} /> : <CircleAlert size={14} />}
      <span>{label}</span>
      <small>{complete ? 'Listo' : 'Requerido'}</small>
    </div>
  );
}
