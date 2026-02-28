import React from 'react';
import { CheckCircle } from 'lucide-react';

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
    title = "¡Curso Publicado Exitosamente!",
    message = "El curso ha sido depositado en el buzón de SofLIA Learning y será procesado en breve.",
    buttonText = "Cerrar"
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="relative w-full max-w-md bg-white dark:bg-[#1A222C] rounded-2xl shadow-2xl p-8 flex flex-col items-center text-center animate-in zoom-in-95 duration-200 border border-gray-100 dark:border-gray-800">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mb-6 ring-8 ring-green-50 dark:ring-green-900/10">
                    <CheckCircle className="w-10 h-10" />
                </div>
                
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                    {title}
                </h3>
                
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-8 leading-relaxed">
                    {message}
                </p>

                <button
                    onClick={onClose}
                    className="w-full bg-[#00D4B3] hover:bg-[#00c0a1] text-white font-medium py-3 px-4 rounded-xl transition-all active:scale-[0.98] shadow-sm hover:shadow"
                >
                    {buttonText}
                </button>
            </div>
        </div>
    );
}
