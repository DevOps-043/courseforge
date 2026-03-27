'use client';

import { Loader2, RefreshCw, Save, Send } from 'lucide-react';
import type { PublicationProfile } from '@/domains/publication/types/publication.types';

interface PublicationHeaderProps {
  artifactTitle: string;
  lessonsCount: number;
  status?: string;
  profile?: PublicationProfile;
  isReady: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  isResetting: boolean;
  onReset: () => void;
  onSaveDraft: () => void;
  onPublish: () => void;
}

function getStatusClasses(status?: string) {
  if (status === 'SENT') {
    return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
  }

  if (status === 'APPROVED') {
    return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
  }

  return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
}

export function PublicationHeader({
  artifactTitle,
  lessonsCount,
  status,
  profile,
  isReady,
  isSaving,
  isPublishing,
  isResetting,
  onReset,
  onSaveDraft,
  onPublish,
}: PublicationHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#151A21] p-4 rounded-xl border border-gray-200 dark:border-[#6C757D]/10">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          {artifactTitle}
        </h2>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`text-xs px-2 py-0.5 rounded-full border ${getStatusClasses(status)}`}
          >
            {status || 'NUEVO'}
          </span>
          <span className="text-xs text-gray-500">
            {lessonsCount} lecciones detectadas
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onReset}
          disabled={isResetting || isSaving || isPublishing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 dark:bg-[#1F2937] dark:text-gray-200 dark:border-gray-700 dark:hover:bg-[#374151] rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          title="Restablecer y Sincronizar Todo"
        >
          {isResetting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>

        <button
          onClick={onSaveDraft}
          disabled={isSaving || isPublishing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 dark:bg-[#1F2937] dark:text-gray-200 dark:border-gray-700 dark:hover:bg-[#374151] rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {isSaving ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Save size={16} />
          )}
          Guardar Borrador
        </button>

        {profile?.platform_role !== 'CONSTRUCTOR' && (
          <button
            onClick={onPublish}
            disabled={!isReady || isSaving || isPublishing}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isReady ? 'bg-[#00D4B3] hover:bg-[#00c0a1]' : 'bg-gray-400 dark:bg-gray-600'}`}
          >
            {isPublishing ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            Enviar a Soflia
          </button>
        )}
      </div>
    </div>
  );
}
