'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, ArrowRight, Database } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

interface ScormImportFlowProps {
    onComplete: (importId: string) => void;
}

type Step = 'upload' | 'uploading' | 'analyzing' | 'review' | 'success';

export function ScormImportFlow({ onComplete }: ScormImportFlowProps) {
    const [step, setStep] = useState<Step>('upload');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [manifest, setManifest] = useState<any>(null);
    const [importId, setImportId] = useState<string | null>(null);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        if (!file.name.endsWith('.zip')) {
            toast.error('Por favor sube un archivo .zip válido');
            return;
        }

        setStep('uploading');
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            // Simulated upload progress
            const interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 90) return prev;
                    return prev + 10;
                });
            }, 500);

            const { data } = await axios.post('/api/admin/scorm/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            clearInterval(interval);
            setProgress(100);

            setImportId(data.importId);
            setManifest(data.manifest);

            setTimeout(() => {
                setStep('review');
            }, 500);

        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || 'Error al subir el archivo');
            setStep('upload');
            toast.error('Error en la subida');
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/zip': ['.zip'],
            'application/x-zip-compressed': ['.zip']
        },
        multiple: false
    });

    const handleConfirm = async () => {
        if (!importId) return;

        try {
            setStep('analyzing'); // Reuse analyzing state or add a new 'processing' state
            // Or better, add a specific loading state for this final step

            const response = await axios.post('/api/admin/scorm/process', { importId });

            if (response.data.success) {
                toast.success('Curso importado y procesado correctamente');
                onComplete(response.data.artifactId);
            }
        } catch (err: any) {
            console.error(err);
            toast.error('Error al procesar el curso: ' + (err.response?.data?.error || err.message));
            setStep('review'); // Go back to review on error
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            <AnimatePresence mode="wait">
                {step === 'upload' && (
                    <motion.div
                        key="upload"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="space-y-6"
                    >
                        <div
                            {...getRootProps()}
                            className={`
                                border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300
                                ${isDragActive
                                    ? 'border-[#00D4B3] bg-[#00D4B3]/5'
                                    : 'border-gray-200 dark:border-[#6C757D]/30 hover:border-[#1F5AF6] hover:bg-gray-50 dark:hover:bg-[#151A21]'
                                }
                            `}
                        >
                            <input {...getInputProps()} />
                            <div className="w-16 h-16 rounded-full bg-[#1F5AF6]/10 flex items-center justify-center mx-auto mb-4 text-[#1F5AF6]">
                                <Upload size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                                {isDragActive ? 'Suelta el archivo aquí...' : 'Arrastra tu paquete SCORM aquí'}
                            </h3>
                            <p className="text-gray-500 dark:text-[#94A3B8] mb-6">
                                Soporta archivos .zip (SCORM 1.2 o 2004)
                            </p>
                            <button className="px-6 py-2 bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-[#6C757D]/30 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2C333A] transition-colors">
                                Seleccionar Archivo
                            </button>
                        </div>

                        {error && (
                            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl text-red-600 dark:text-red-400 flex items-center gap-2">
                                <AlertCircle size={20} />
                                {error}
                            </div>
                        )}
                    </motion.div>
                )}

                {(step === 'uploading' || step === 'analyzing') && (
                    <motion.div
                        key="processing"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center py-12"
                    >
                        <div className="w-20 h-20 relative mx-auto mb-6">
                            <svg className="w-full h-full" viewBox="0 0 100 100">
                                <circle
                                    className="text-gray-200 dark:text-[#6C757D]/20 stroke-current"
                                    strokeWidth="8"
                                    cx="50"
                                    cy="50"
                                    r="40"
                                    fill="transparent"
                                />
                                <circle
                                    className="text-[#1F5AF6] stroke-current transition-all duration-300"
                                    strokeWidth="8"
                                    strokeLinecap="round"
                                    cx="50"
                                    cy="50"
                                    r="40"
                                    fill="transparent"
                                    strokeDasharray="251.2"
                                    strokeDashoffset={251.2 - (251.2 * progress) / 100}
                                    transform="rotate(-90 50 50)"
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#1F5AF6]">
                                {progress}%
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                            {step === 'uploading' ? 'Subiendo paquete...' : 'Analizando estructura...'}
                        </h3>
                        <p className="text-gray-500 dark:text-[#94A3B8]">
                            Esto puede tomar unos momentos dependiendo del tamaño.
                        </p>
                    </motion.div>
                )}

                {step === 'review' && manifest && (
                    <motion.div
                        key="review"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-6"
                    >
                        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/30 rounded-2xl p-6 shadow-xl">
                            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100 dark:border-[#6C757D]/10">
                                <div className="w-12 h-12 rounded-xl bg-[#00D4B3]/10 flex items-center justify-center text-[#00D4B3]">
                                    <CheckCircle2 size={24} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Análisis Completado</h3>
                                    <p className="text-sm text-gray-500 dark:text-[#94A3B8]">
                                        Hemos detectado la siguiente estructura en tu paquete SCORM {manifest.version}.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="p-4 bg-gray-50 dark:bg-[#0F1419] rounded-xl border border-gray-200 dark:border-[#6C757D]/10">
                                    <h4 className="flex items-center gap-2 font-medium text-gray-900 dark:text-white mb-2">
                                        <Database size={16} className="text-[#1F5AF6]" />
                                        {manifest.title}
                                    </h4>
                                    <div className="pl-6 space-y-2">
                                        {manifest.organizations[0]?.items.map((item: any, i: number) => (
                                            <div key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                                                <span>{item.title}</span>
                                                {item.children?.length > 0 && (
                                                    <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-[#2C333A] rounded-full">
                                                        {item.children.length} lecciones
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl border border-blue-100 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-900/30 text-sm text-blue-800 dark:text-blue-300">
                                    <p className="flex gap-2">
                                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                        <span>
                                            El siguiente paso utilizará <strong>Inteligencia Artificial</strong> para extraer el contenido, generar objetivos de aprendizaje y crear un plan instruccional completo.
                                        </span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleConfirm}
                            className="w-full py-4 bg-[#1F5AF6] hover:bg-[#1F5AF6]/90 text-white rounded-xl font-bold shadow-lg shadow-[#1F5AF6]/25 flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5"
                        >
                            <span>Comenzar Importación e IA</span>
                            <ArrowRight size={20} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
