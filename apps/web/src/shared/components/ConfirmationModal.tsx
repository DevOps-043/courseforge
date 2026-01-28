'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, CheckCircle, X, AlertOctagon } from 'lucide-react';

export type ModalVariant = 'info' | 'success' | 'warning' | 'danger' | 'critical';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: ModalVariant;
    isLoading?: boolean;
}

const variantStyles = {
    info: {
        icon: Info,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/20',
        button: 'bg-blue-500 hover:bg-blue-600'
    },
    success: {
        icon: CheckCircle,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
        border: 'border-green-500/20',
        button: 'bg-green-500 hover:bg-green-600'
    },
    warning: {
        icon: AlertTriangle,
        color: 'text-yellow-500',
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/20',
        button: 'bg-yellow-500 hover:bg-yellow-600'
    },
    danger: {
        icon: AlertTriangle,
        color: 'text-red-500',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        button: 'bg-red-500 hover:bg-red-600'
    },
    critical: {
        icon: AlertOctagon,
        color: 'text-red-600',
        bg: 'bg-red-600/10',
        border: 'border-red-600/20',
        button: 'bg-red-600 hover:bg-red-700 animate-pulse'
    }
};

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'info',
    isLoading = false
}: ConfirmationModalProps) {
    const style = variantStyles[variant];
    const Icon = style.icon;

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={isLoading ? undefined : onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-md bg-[#0F1419] border border-gray-800 rounded-2xl shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <div className="p-6 pb-0 flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${style.bg} ${style.color} ${style.border} border`}>
                                <Icon size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
                                <div className="text-gray-400 text-sm leading-relaxed">
                                    {message}
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="p-6 flex justify-end gap-3 mt-4">
                            <button
                                onClick={onClose}
                                disabled={isLoading}
                                className="px-4 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium disabled:opacity-50"
                            >
                                {cancelText}
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={isLoading}
                                className={`px-6 py-2 rounded-lg text-white font-medium text-sm transition-all shadow-lg flex items-center gap-2 ${style.button} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {isLoading ? (
                                    <>
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Procesando...
                                    </>
                                ) : (
                                    confirmText
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
