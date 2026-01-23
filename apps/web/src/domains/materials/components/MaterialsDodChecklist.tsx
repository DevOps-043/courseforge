'use client';

import { LessonDod, ValidationCheck } from '../types/materials.types';
import { CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

interface MaterialsDodChecklistProps {
    dod: LessonDod;
    checks?: ValidationCheck[];
    className?: string;
}

export function MaterialsDodChecklist({ dod, checks, className = '' }: MaterialsDodChecklistProps) {
    const controls = [
        {
            code: 'control3',
            label: 'Control 3: Consistencia con el Plan',
            status: dod.control3_consistency,
            description: 'OA reflejado, componentes completos, demo guide si requerido',
        },
        {
            code: 'control4',
            label: 'Control 4: Uso de Fuentes',
            status: dod.control4_sources,
            description: 'Solo fuentes aptas, trazabilidad correcta',
        },
        {
            code: 'control5',
            label: 'Control 5: Evaluación (Quiz)',
            status: dod.control5_quiz,
            description: 'Cantidad, tipos, dificultad variada, feedback',
        },
    ];

    const getStatusIcon = (status: 'PASS' | 'FAIL' | 'PENDING') => {
        switch (status) {
            case 'PASS':
                return <CheckCircle className="h-5 w-5 text-[#00D4B3]" />; // Aqua
            case 'FAIL':
                return <XCircle className="h-5 w-5 text-red-500" />;
            case 'PENDING':
                return <Clock className="h-5 w-5 text-gray-500" />;
        }
    };

    const getStatusBg = (status: 'PASS' | 'FAIL' | 'PENDING') => {
        switch (status) {
            case 'PASS':
                return 'bg-[#00D4B3]/5 border-[#00D4B3]/20';
            case 'FAIL':
                return 'bg-red-500/5 border-red-500/20';
            case 'PENDING':
                return 'bg-white/5 border-white/5';
        }
    };

    const allPassed = controls.every((c) => c.status === 'PASS');
    const hasFails = controls.some((c) => c.status === 'FAIL');

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <h4 className="font-semibold text-lg text-gray-900 dark:text-white">Definition of Done (DoD)</h4>
                {allPassed && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20 rounded-full">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Aprobado por IA
                    </span>
                )}
                {hasFails && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Correcciones requeridas
                    </span>
                )}
            </div>

            {/* Controls List */}
            <div className="space-y-3">
                {controls.map((control) => (
                    <div
                        key={control.code}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${getStatusBg(control.status)}`}
                    >
                        <div className="flex-shrink-0 mt-0.5">
                            {getStatusIcon(control.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{control.label}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{control.description}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Errors List */}
            {dod.errors && dod.errors.length > 0 && (
                <div className="mt-6 p-4 bg-red-500/5 border border-red-500/10 rounded-xl">
                    <h5 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                         <XCircle className="w-4 h-4" /> Errores detectados
                    </h5>
                    <ul className="space-y-1">
                        {dod.errors.map((error, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                                <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Detailed Checks (if provided) */}
            {checks && checks.length > 0 && (
                <details className="mt-4">
                    <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200">
                        Ver validaciones detalladas ({checks.length})
                    </summary>
                    <div className="mt-2 space-y-1 pl-4 border-l-2 border-gray-200 dark:border-white/10">
                        {checks.map((check, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs">
                                {check.pass ? (
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                ) : (
                                    <XCircle className="h-3 w-3 text-red-500" />
                                )}
                                <span className={check.pass ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}>
                                    [{check.code}] {check.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
