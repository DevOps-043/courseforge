import React from 'react';
import { CheckCircle2, TrendingUp, ShieldCheck, AlertCircle, Sparkles } from 'lucide-react';

interface MetricProps {
    label: string;
    value: number;
}

function MetricBar({ label, value }: MetricProps) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <span>{label}</span>
                <span className={value >= 90 ? "text-[#00D4B3]" : "text-gray-900 dark:text-white"}>{value}%</span>
            </div>
            <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div 
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${value >= 80 ? 'bg-[#00D4B3]' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${value}%` }}
                />
            </div>
        </div>
    );
}

export function InstructionalPlanValidationResult({ validation }: { validation: any }) {
    if (!validation) return null;
    
    // Fallback default values if validation structure is partial
    const score_general = validation.score_general || 0;
    const metricas = validation.metricas || {};
    const fortalezas = validation.fortalezas || [];
    const recomendaciones = validation.recomendaciones || [];
    const resumen = validation.resumen_ejecutivo || "Sin resumen disponible.";
    const estado = validation.estado || "PENDING";

    const isApproved = estado === 'APROBADO' || score_general >= 80;

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-[#00D4B3]/20 rounded-full">
                    <ShieldCheck size={16} className="text-[#00D4B3]" />
                </div>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-widest">
                    Decisión del Revisor Automático
                </h3>
            </div>

            {/* Main Decision Card */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0A0E12] overflow-hidden shadow-2xl shadow-black/5 dark:shadow-black/50">
                
                {/* Header Section */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex flex-col md:flex-row justify-between items-start gap-6 relative overflow-hidden">
                    {/* Background Glow */}
                    <div className={`absolute top-0 right-0 w-64 h-64 ${isApproved ? 'bg-[#00D4B3]/5' : 'bg-orange-500/5'} blur-[100px] pointer-events-none`} />

                    <div className="flex gap-5 z-10 w-full">
                        <div className={`p-4 rounded-2xl h-fit shrink-0 ${isApproved ? 'bg-[#00D4B3]/10 text-[#00D4B3]' : 'bg-orange-500/10 text-orange-500'}`}>
                            {isApproved ? <ShieldCheck size={32} /> : <AlertCircle size={32} />}
                        </div>
                        <div className="space-y-3 w-full">
                            <div className="flex justify-between items-start w-full">
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    {isApproved ? "Validación Exitosa" : "Requiere Atención"}
                                </h3>
                                <div className="text-right md:hidden">
                                     <div className={`text-4xl font-bold tracking-tighter ${isApproved ? 'text-[#00D4B3]' : 'text-orange-500'}`}>
                                        {score_general}%
                                    </div>
                                </div>
                            </div>
                            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed border-l-2 border-gray-200 dark:border-gray-800 pl-4 py-1">
                                {resumen}
                            </p>
                        </div>
                    </div>
                    
                    <div className="text-right hidden md:block shrink-0 z-10 pl-6 border-l border-gray-200 dark:border-gray-800/50">
                         <div className={`text-5xl font-bold tracking-tighter ${isApproved ? 'text-[#00D4B3]' : 'text-orange-500'}`}>
                            {score_general}%
                        </div>
                        <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mt-1">
                            Score General
                        </div>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div className="p-8 bg-gray-50 dark:bg-[#0F1419]/30">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-8">
                        {metricas.calidad_contenido !== undefined && <MetricBar label="Calidad Contenido" value={metricas.calidad_contenido} />}
                        {metricas.adherencia_bloom !== undefined && <MetricBar label="Adherencia Bloom" value={metricas.adherencia_bloom} />}
                        {metricas.calidad_objetivos !== undefined && <MetricBar label="Calidad Objetivos" value={metricas.calidad_objetivos} />}
                        {metricas.cobertura_objetivos !== undefined && <MetricBar label="Cobertura Objetivos" value={metricas.cobertura_objetivos} />}
                        {metricas.coherencia_tematica !== undefined && <MetricBar label="Coherencia Temática" value={metricas.coherencia_tematica} />}
                        {metricas.estructura_pedagogica !== undefined && <MetricBar label="Estructura Pedagógica" value={metricas.estructura_pedagogica} />}
                    </div>
                </div>

                {/* Footer Section: Fortalezas & Recomendaciones */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-800">
                    {/* Fortalezas */}
                    <div className="p-6 space-y-4 bg-[#00D4B3]/5 dark:bg-[#00D4B3]/[0.02]">
                        <div className="flex items-center gap-2 text-[#00D4B3] font-semibold text-sm uppercase tracking-wide mb-2">
                            <Sparkles size={16} />
                            Fortalezas
                        </div>
                        <ul className="space-y-3">
                            {fortalezas.length > 0 ? fortalezas.map((item: string, idx: number) => (
                                <li key={idx} className="flex gap-3 text-sm text-gray-700 dark:text-gray-400">
                                    <CheckCircle2 size={14} className="text-[#00D4B3] mt-0.5 shrink-0" />
                                    <span>{item}</span>
                                </li>
                            )) : <span className="text-gray-500 dark:text-gray-600 text-sm">No se detectaron fortalezas específicas.</span>}
                        </ul>
                    </div>
                    
                    {/* Recomendaciones */}
                    <div className="p-6 space-y-4 bg-orange-500/5 dark:bg-orange-500/[0.02]">
                        <div className="flex items-center gap-2 text-orange-500 dark:text-orange-400 font-semibold text-sm uppercase tracking-wide mb-2">
                            <TrendingUp size={16} />
                             Recomendaciones
                        </div>
                        <ul className="space-y-3">
                            {recomendaciones.length > 0 ? recomendaciones.map((item: string, idx: number) => (
                                <li key={idx} className="flex gap-3 text-sm text-gray-700 dark:text-gray-400">
                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-orange-400 mt-1.5 shrink-0" />
                                    <span>{item}</span>
                                </li>
                            )) : <span className="text-gray-500 dark:text-gray-600 text-sm">No hay recomendaciones críticas.</span>}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
