"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, UploadCloud, X } from "lucide-react";
import {
  isSupportedSyllabusDocument,
  SYLLABUS_SOURCE_DOCUMENT_MAX_FILES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES,
  SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS,
  type SyllabusSourceDocument,
} from "../syllabus-source-documents";

interface SyllabusDocumentUploaderProps {
  artifactId: string;
  documents: SyllabusSourceDocument[];
  onChange: (documents: SyllabusSourceDocument[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}

export function SyllabusDocumentUploader({
  artifactId,
  documents,
  onChange,
  onUploadingChange,
}: SyllabusDocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const processFiles = async (selectedFiles: File[]) => {
    setError(null);
    if (selectedFiles.length === 0) return;

    const prospectiveFiles = mergeFileSizes(documents, selectedFiles);
    if (prospectiveFiles.length > SYLLABUS_SOURCE_DOCUMENT_MAX_FILES) {
      setError(`Puedes agregar hasta ${SYLLABUS_SOURCE_DOCUMENT_MAX_FILES} documentos.`);
      return;
    }
    const invalidFile = selectedFiles.find(
      (file) =>
        !isSupportedSyllabusDocument(file) ||
        file.size < 1 ||
        file.size > SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES,
    );
    if (invalidFile) {
      setError(
        `${invalidFile.name}: usa PDF, DOCX, PPTX o TXT de hasta 15 MB.`,
      );
      return;
    }
    const prospectiveBytes = prospectiveFiles.reduce(
      (total, file) => total + file.sizeBytes,
      0,
    );
    if (prospectiveBytes > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_BYTES) {
      setError("El conjunto de documentos no puede exceder 40 MB.");
      return;
    }

    const formData = new FormData();
    formData.set("artifactId", artifactId);
    selectedFiles.forEach((file) => formData.append("files", file));
    setUploading(true);
    onUploadingChange(true);
    try {
      const response = await fetch("/api/syllabus/documents", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        documents?: SyllabusSourceDocument[];
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !payload?.documents) {
        throw new Error(
          payload?.message || payload?.error || "No se pudieron procesar los documentos.",
        );
      }

      const nextDocuments = [...documents];
      for (const document of payload.documents) {
        const duplicateIndex = nextDocuments.findIndex(
          (current) =>
            current.filename === document.filename &&
            current.sizeBytes === document.sizeBytes,
        );
        if (duplicateIndex >= 0) nextDocuments[duplicateIndex] = document;
        else nextDocuments.push(document);
      }
      const totalCharacters = nextDocuments.reduce(
        (total, document) => total + document.characterCount,
        0,
      );
      if (totalCharacters > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS) {
        throw new Error(
          "El texto extraído del conjunto de documentos excede 120,000 caracteres. Quita o reduce algún archivo.",
        );
      }
      onChange(nextDocuments);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudieron procesar los documentos.",
      );
    } finally {
      setUploading(false);
      onUploadingChange(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/5 p-5">
      <div>
        <h4 className="font-bold text-gray-900 dark:text-white">
          Documentos fuente
        </h4>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Su contenido será la fuente principal del temario. Puedes combinar hasta 8 archivos.
        </p>
      </div>

      <button
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-7 text-center transition-colors ${
          dragging
            ? "border-[var(--engine-accent)] bg-[var(--engine-accent)]/10"
            : "border-gray-300 bg-white hover:border-[var(--engine-accent)]/60 dark:border-white/15 dark:bg-[var(--engine-canvas)]"
        }`}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void processFiles(Array.from(event.dataTransfer.files));
        }}
        type="button"
      >
        {uploading ? (
          <Loader2 className="mb-2 h-7 w-7 animate-spin text-[var(--engine-accent)]" />
        ) : (
          <UploadCloud className="mb-2 h-7 w-7 text-[var(--engine-accent)]" />
        )}
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {uploading ? "Procesando documentos…" : "Selecciona o arrastra varios documentos"}
        </span>
        <span className="mt-1 text-xs text-gray-500">
          PDF, DOCX, PPTX o TXT · máximo 15 MB por archivo
        </span>
      </button>
      <input
        ref={inputRef}
        accept=".pdf,.docx,.pptx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
        className="sr-only"
        multiple
        onChange={(event) => void processFiles(Array.from(event.target.files || []))}
        type="file"
      />

      {documents.length > 0 ? (
        <ul className="space-y-2" aria-label="Documentos fuente procesados">
          {documents.map((document) => (
            <li
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-[var(--engine-canvas)]"
              key={document.fileId}
            >
              <FileText className="h-4 w-4 shrink-0 text-[var(--engine-accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {document.filename}
                </span>
                <span className="text-xs text-gray-500">
                  {formatBytes(document.sizeBytes)} · {document.characterCount.toLocaleString("es-MX")} caracteres
                </span>
              </span>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <button
                aria-label={`Quitar ${document.filename}`}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-white/10"
                onClick={() => onChange(documents.filter((item) => item.fileId !== document.fileId))}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="text-sm font-medium text-red-600 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeFileSizes(documents: SyllabusSourceDocument[], files: File[]) {
  const merged = documents.map((document) => ({
    filename: document.filename,
    sizeBytes: document.sizeBytes,
  }));
  for (const file of files) {
    const duplicateIndex = merged.findIndex(
      (current) =>
        current.filename === file.name && current.sizeBytes === file.size,
    );
    if (duplicateIndex >= 0) {
      merged[duplicateIndex] = { filename: file.name, sizeBytes: file.size };
    } else {
      merged.push({ filename: file.name, sizeBytes: file.size });
    }
  }
  return merged;
}
