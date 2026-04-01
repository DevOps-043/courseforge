'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, CheckCircle, AlertOctagon } from 'lucide-react';

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
    hideActions?: boolean;
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

const modalTheme = {
    backdrop: 'absolute inset-0 bg-slate-950/45 backdrop-blur-sm dark:bg-black/60',
    container:
        'relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-[#0F1419]',
    title: 'mb-2 text-xl font-bold text-gray-900 dark:text-white',
    message: 'text-sm leading-relaxed text-gray-600 dark:text-gray-400',
    cancelButton:
        'rounded-lg px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white',
    confirmButton:
        'flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-medium text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50',
} as const;

export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    variant = 'info',
    isLoading = false,
    hideActions = false,
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
                        className={modalTheme.backdrop}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className={modalTheme.container}
                    >
                        {/* Header */}
                        <div className="p-6 pb-0 flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${style.bg} ${style.color} ${style.border} border`}>
                                <Icon size={24} />
                            </div>
                            <div className="flex-1">
                                <h3 className={modalTheme.title}>{title}</h3>
                                <div className={modalTheme.message}>
                                    {message}
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        {!hideActions && (
                            <div className="mt-4 flex justify-end gap-3 p-6">
                                <button
                                    onClick={onClose}
                                    disabled={isLoading}
                                    className={modalTheme.cancelButton}
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={onConfirm}
                                    disabled={isLoading}
                                    className={`${modalTheme.confirmButton} ${style.button}`}
                                >
                                    {isLoading ? (
                                        <>
                                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                            Procesando...
                                        </>
                                    ) : (
                                        confirmText
                                    )}
                                </button>
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
