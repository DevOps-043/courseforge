'use client';

import { AlertTriangle } from 'lucide-react';

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

  return (
    <>
      {hasBlockers && (
        <div className="p-4 rounded-xl flex items-start gap-3 border bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-200">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold text-sm">
              Faltan datos requeridos para publicar:
            </p>
            <ul className="list-disc list-inside text-sm mt-1 space-y-0.5 opacity-90">
              {missingEmail && <li>Email del instructor (requerido).</li>}
              {missingSlug && (
                <li>
                  Slug URL (requerido). Es la clave de idempotencia — debe ser
                  estable entre publicaciones del mismo curso.
                </li>
              )}
              {missingThumbnail && <li>Imagen de portada (requerida).</li>}
            </ul>
          </div>
        </div>
      )}

      {showPartialNotice && (
        <div className="p-4 rounded-xl flex items-start gap-3 border bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800/50 dark:text-blue-200">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-semibold text-sm">Aviso de Publicación Parcial:</p>
            <ul className="list-disc list-inside text-sm mt-1 space-y-0.5 opacity-90">
              {missingVideos > 0 && (
                <li>
                  Faltan {missingVideos} videos. Las lecciones sin video no se
                  enviarán, pero podrás actualizarlas después.
                </li>
              )}
              {selectedLessonsCount > 0 && (
                <li>
                  Se enviarán {selectedLessonsCount} lecciones con video en este
                  envío.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
