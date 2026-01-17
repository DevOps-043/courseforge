
import { useState } from 'react';
import { TemarioEsp02, SyllabusModule } from '../../types/syllabus.types';

interface SyllabusImportFormProps {
  onImport: (modules: SyllabusModule[]) => void;
  onCancel?: () => void;
}

export function SyllabusImportForm({ onImport, onCancel }: SyllabusImportFormProps) {
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleParseAndImport = () => {
    if (!content.trim()) {
      setError('Por favor pega el contenido del temario.');
      return;
    }

    try {
      // Parser simplificado (MVP) de Markdown a SyllabusModule
      // Esto asumiría un formato como:
      // # Módulo 1: Título
      // ## Lección 1.1: Título 
      // Objetivo: ...
      
      // Por ahora, para no complicar el regex, simularemos que aceptamos JSON directo o texto simple
      // Si el usuario pega JSON:
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);
        if (parsed.modules && Array.isArray(parsed.modules)) {
          onImport(parsed.modules);
          return;
        }
      }
      
      // TODO: Implementar parser robusto de Markdown aquí
      setError('El formato no es reconocido. Por favor usa un JSON válido por ahora.');
      
    } catch (err) {
      setError('Error al procesar el contenido. Verifica el formato.');
    }
  };

  return (
    <div className="bg-white dark:bg-[#1E2329] p-6 rounded-xl border border-gray-200 dark:border-white/10 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-[#0A2540] dark:text-white">Importar Temario Existente</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pega aquí tu temario en formato JSON o Markdown pre-estructurado.
        </p>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder='{ "modules": [...] }'
        className="w-full h-64 p-4 rounded-lg bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 text-sm font-mono focus:ring-2 focus:ring-[#00D4B3] focus:outline-none dark:text-gray-300 resize-none transition-all"
      />

      {error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
        )}
        <button
          onClick={handleParseAndImport}
          className="px-6 py-2 bg-[#0A2540] dark:bg-white text-white dark:text-[#0A2540] rounded-lg text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-blue-900/10"
        >
          Procesar e Importar
        </button>
      </div>
    </div>
  );
}
