'use client';

import {
  CheckCircle2,
  Film,
  Loader2,
  RefreshCw,
  Rocket,
  Save,
  Send,
} from 'lucide-react';
import type { PublicationProfile } from '@/domains/publication/types/publication.types';
import styles from '../PublicationWorkspace.module.css';

interface PublicationHeaderProps {
  artifactTitle: string;
  lessonsCount: number;
  status?: string;
  profile?: PublicationProfile;
  isReady: boolean;
  metadataCompleteCount: number;
  selectedLessonsCount: number;
  selectableLessonsCount: number;
  isSaving: boolean;
  isPublishing: boolean;
  isResetting: boolean;
  onReset: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}

function getStatusLabel(status?: string) {
  if (status === 'SENT') return 'Enviado';
  if (status === 'APPROVED') return 'Aprobado';
  if (status === 'READY') return 'Listo';
  if (status === 'DRAFT') return 'Borrador';
  return 'Nuevo';
}

export function PublicationHeader({
  artifactTitle,
  lessonsCount,
  status,
  profile,
  isReady,
  metadataCompleteCount,
  selectedLessonsCount,
  selectableLessonsCount,
  isSaving,
  isPublishing,
  isResetting,
  onReset,
  onSaveDraft,
  onPublish,
}: PublicationHeaderProps) {
  return (
    <header className={styles.releaseHeader}>
      <div className={styles.releaseIdentity}>
        <span className={styles.releaseIcon} aria-hidden="true">
          <Rocket size={20} />
        </span>
        <div className={styles.releaseCopy}>
          <span className={styles.eyebrow}>Centro de publicación</span>
          <div className={styles.releaseTitleRow}>
            <h2>{artifactTitle}</h2>
            <span className={styles.statusBadge} data-status={status || 'NEW'}>
              {getStatusLabel(status)}
            </span>
          </div>
          <p>Prepara la entrega, valida el contenido y envíalo a SofLIA.</p>
        </div>
      </div>

      <div className={styles.releaseMetrics}>
        <div className={styles.releaseMetric} data-complete={metadataCompleteCount === 3}>
          <CheckCircle2 size={17} />
          <span>
            <strong>{metadataCompleteCount}/3</strong>
            <small>datos listos</small>
          </span>
        </div>
        <div className={styles.releaseMetric} data-complete={selectedLessonsCount > 0}>
          <Film size={17} />
          <span>
            <strong>{selectedLessonsCount}/{selectableLessonsCount}</strong>
            <small>videos incluidos</small>
          </span>
        </div>
        <div className={styles.releaseMetric}>
          <span>
            <strong>{lessonsCount}</strong>
            <small>lecciones totales</small>
          </span>
        </div>
      </div>

      <div className={styles.releaseActions}>
        <button
          type="button"
          onClick={onReset}
          disabled={isResetting || isSaving || isPublishing}
          className={styles.iconButton}
          title="Sincronizar videos desde Producción"
          aria-label="Sincronizar videos desde Producción"
        >
          {isResetting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>

        <button
          type="button"
          onClick={onSaveDraft}
          disabled={isSaving || isPublishing}
          className={styles.secondaryButton}
        >
          {isSaving ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          Guardar borrador
        </button>

        {profile?.platform_role !== 'CONSTRUCTOR' && (
          <button
            type="button"
            onClick={onPublish}
            disabled={!isReady || isSaving || isPublishing}
            className={styles.primaryButton}
          >
            {isPublishing ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            Enviar a SofLIA
          </button>
        )}
      </div>
    </header>
  );
}
