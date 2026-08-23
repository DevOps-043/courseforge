import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { EngineDialog } from '@/components/ui/EngineDialog';

interface PublishSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    message?: string;
    buttonText?: string;
}

export const PublishSuccessModal: React.FC<PublishSuccessModalProps> = ({
    isOpen,
    onClose,
    title = "Curso publicado",
    message = "El curso se depositó en el buzón de SofLIA Learning y será procesado en breve.",
    buttonText = "Cerrar"
}) => (
    <EngineDialog
        isOpen={isOpen}
        onClose={onClose}
        size="compact"
        eyebrow="Publicación completada"
        title={title}
        description="El envío fue confirmado por SofLIA Engine."
        icon={<CheckCircle2 />}
        footer={(
            <button
                type="button"
                onClick={onClose}
                className="min-h-11 w-full rounded-[0.86rem] border border-[var(--engine-action)] bg-[var(--engine-action)] px-4 text-sm font-semibold text-[var(--engine-on-action)] shadow-lg hover:-translate-y-px"
            >
                {buttonText}
            </button>
        )}
    >
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4 text-sm leading-6 text-[var(--engine-text)]">
            <p>{message}</p>
            <p className="mt-2 font-[var(--font-system-label)] text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-emerald-500">Listo para procesamiento</p>
        </div>
    </EngineDialog>
);
