import { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings2, CheckCircle2, Play, RefreshCw, Library, Loader2, Edit3, AlertCircle, CheckSquare, Pause, Square, PlayCircle, Clipboard, ExternalLink, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useCuration } from '../hooks/useCuration';
import { CurationDashboard } from './CurationDashboard';
import { motion } from 'framer-motion';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { ConfirmationModal, ModalVariant } from '../../../shared/components/ConfirmationModal';

interface SyllabusLesson {
    id?: string;
    title: string;
    objective_specific: string;
}

interface SyllabusModule {
    id?: string;
    title: string;
    objective_general_ref: string;
    lessons: SyllabusLesson[];
}

interface SourcesCurationGenerationContainerProps {
    artifactId: string;
    courseId?: string; // Nuevo prop para ID público
    temario?: SyllabusModule[];
    ideaCentral?: string;
}

const DEFAULT_PROMPT_PREVIEW = `Prompt optimizado con reglas de curaduría, enfoque en accesibilidad (sin descargas), validación de URLs y estructura JSON estricta. Utiliza búsquedas en tiempo real para verificar la disponibilidad.`;

// URL del GPT personalizado
const GPT_URL = 'https://chatgpt.com/g/g-69823d9a6470819196393ee8c227adab-soflia-generating-sources-assistant';

export function SourcesCurationGenerationContainer({ artifactId, courseId, temario, ideaCentral }: SourcesCurationGenerationContainerProps) {
    const { curation, rows, isGenerating, startCuration, updateRow, refresh } = useCuration(artifactId);
    const router = useRouter();
    const [useCustomPrompt, setUseCustomPrompt] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [showAutomaticFlow, setShowAutomaticFlow] = useState(false);
    const [copiedToClipboard, setCopiedToClipboard] = useState(false);

    // Review States
    const [reviewNotes, setReviewNotes] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);

    const [isLoadingModal, setIsLoadingModal] = useState(false);
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: React.ReactNode;
        variant: ModalVariant;
        confirmText?: string;
        onConfirm: () => Promise<void> | void;
    }>({
        isOpen: false,
        title: '',
        message: null,
        variant: 'info',
        onConfirm: () => { }
    });
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Hydration: Restaurar estado desde localStorage INMEDIATAMENTE después del mount
    useEffect(() => {
        const storedValidating = localStorage.getItem(`isValidating_${artifactId}`);
        console.log('[Hydration] Checking localStorage for validation state:', storedValidating);
        if (storedValidating === 'true') {
            console.log('[Hydration] Restoring validation state from localStorage');
            setIsValidating(true);
        }
        setIsHydrated(true);
    }, [artifactId]);

    useEffect(() => {
        if (curation?.qa_decision?.notes) {
            setReviewNotes(curation.qa_decision.notes);
        }
    }, [curation]);

    // Completion Check: Stop polling when all rows are validated
    useEffect(() => {
        if (isValidating && rows.length > 0) {
            const pendingCount = rows.filter(row => {
                const hasGoogleRedirect = row.source_ref &&
                    (row.source_ref.includes('vertexaisearch.cloud.google.com') ||
                        row.source_ref.includes('grounding-api-redirect'));

                // A row is pending if it's not auto-evaluated OR if it still has a google redirect
                return !row.auto_evaluated || hasGoogleRedirect;
            }).length;

            console.log(`[Validation] Pending rows: ${pendingCount}/${rows.length}`);

            if (pendingCount === 0) {
                console.log('[Validation] All rows processed. Stopping polling.');

                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }

                setIsValidating(false);
                localStorage.removeItem(`isValidating_${artifactId}`);
                toast.success('Validación de fuentes completada exitosamente.');
            }
        }
    }, [rows, isValidating, artifactId]);

    // Start polling when isValidating becomes true (including on mount if restored from localStorage)
    useEffect(() => {
        if (isValidating && !pollIntervalRef.current && isHydrated) {
            console.log('[Validation] Starting polling for artifact:', artifactId);
            toast.info('Monitoreando progreso de validación...');

            const pollInterval = setInterval(async () => {
                // Only refresh if validting to avoid zombies
                await refresh();
            }, 5000);

            pollIntervalRef.current = pollInterval;

            // Failsafe: Stop polling after 15 minutes max (Netlify background functions can take up to 15 min)
            const timeoutId = setTimeout(() => {
                console.log('[Validation] Timeout reached, stopping polling');
                clearInterval(pollInterval);
                pollIntervalRef.current = null;
                setIsValidating(false);
                localStorage.removeItem(`isValidating_${artifactId}`);
                toast.info('Monitoreo de validación finalizado. Revisa los resultados.');
                refresh();
            }, 900000); // 15 minutes

            return () => {
                clearInterval(pollInterval);
                clearTimeout(timeoutId);
                pollIntervalRef.current = null;
            };
        }
    }, [isValidating, artifactId, refresh, isHydrated]);

    const startPolling = () => {
        // This function now just sets state - the useEffect handles the actual polling
        setIsValidating(true);
        localStorage.setItem(`isValidating_${artifactId}`, 'true');
    };

    const handleValidate = async () => {
        // Evitar múltiples ejecuciones simultáneas
        if (isValidating) {
            toast.warning('Ya hay una validación en curso. Por favor espera.');
            return;
        }

        // Verificar si ya hay una validación reciente (últimos 5 minutos)
        const lastValidation = localStorage.getItem(`lastValidation_${artifactId}`);
        if (lastValidation) {
            const elapsed = Date.now() - parseInt(lastValidation);
            if (elapsed < 300000) { // 5 minutos
                toast.warning(`Validación reciente detectada. Espera ${Math.ceil((300000 - elapsed) / 60000)} minutos más.`);
                return;
            }
        }

        // Start polling first (this will show the loading UI immediately)
        startPolling();
        localStorage.setItem(`lastValidation_${artifactId}`, Date.now().toString());

        try {
            const { data: { session } } = await createClient().auth.getSession();
            if (!session) throw new Error("No session found");

            const response = await fetch('/.netlify/functions/validate-curation-background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    artifactId,
                    userToken: session.access_token
                })
            });

            // Las funciones background de Netlify devuelven 202 Accepted inmediatamente
            if (response.status === 202 || response.ok) {
                toast.success('Validación iniciada. El proceso se ejecuta en segundo plano.');
                toast.info('Los resultados se actualizarán automáticamente.');
            } else {
                throw new Error('Error en el servicio de validación');
            }

        } catch (err: any) {
            console.error(err);
            toast.error('Falló la validación: ' + err.message);
            setIsValidating(false);
            localStorage.removeItem(`isValidating_${artifactId}`);
        }
    };




    // Dynamic Progress Calculation based on real data
    // Heuristic: Each row found adds to progress. Capped at 98% until 'isGenerating' becomes false.
    // Assuming average course has ~30-50 components. We'll map 50 components to 100%.
    const [progress, setProgress] = useState(5);

    useEffect(() => {
        // If process finished significantly, jump to 100%
        if (!isGenerating && rows.length > 0) {
            setProgress(100);
            return;
        }

        if (rows.length > 0) {
            // Adjusted divisor to 80 to prevent premature 98% on large courses
            // Adjusted divisor to 25 considering typical course size
            const calculated = Math.min(Math.round((rows.length / 25) * 100), 95);
            setProgress(prev => Math.max(prev, calculated));
        }
    }, [rows.length, isGenerating]);

    // Logic to determine view state
    const hasRows = rows.length > 0;

    const showGeneratingView = isGenerating;
    const showDashboard = !isGenerating && hasRows;

    const handleGenerate = async () => {
        setProgress(5); // Reset progress on new run
        await startCuration(1, []);
    };

    // Generate context for GPT
    const generateGPTContext = (): string => {
        if (!temario || !ideaCentral) {
            return `COURSE_ID: ${courseId || artifactId}\n\nNo hay temario disponible. Por favor genera el temario primero.`;
        }

        // Usamos courseId si existe (más seguro/limpio), o artifactId como fallback
        let context = `COURSE_ID: ${courseId || artifactId}\n\n`;
        context += `IDEA CENTRAL: ${ideaCentral}\n\n`;
        context += `TEMARIO:\n`;

        temario.forEach((module, mIdx) => {
            context += `- Módulo ${mIdx + 1}: ${module.title}\n`;
            module.lessons.forEach((lesson, lIdx) => {
                const lessonId = lesson.id || `M${mIdx + 1}L${lIdx + 1}`;
                context += `  - Lección ${mIdx + 1}.${lIdx + 1} (${lessonId}): ${lesson.title}\n`;
                if (lesson.objective_specific) {
                    context += `    Objetivo: ${lesson.objective_specific}\n`;
                }
            });
        });

        return context;
    };

    // Handle GPT button click
    const handleOpenGPT = async () => {
        const context = generateGPTContext();

        try {
            await navigator.clipboard.writeText(context);
            setCopiedToClipboard(true);
            toast.success('Contexto copiado al portapapeles. Pégalo en ChatGPT.');

            // Reset copied state after 3 seconds
            setTimeout(() => setCopiedToClipboard(false), 3000);

            // Open GPT in new tab
            window.open(GPT_URL, '_blank');
        } catch (err) {
            // Fallback for browsers that don't support clipboard API
            toast.error('No se pudo copiar. Copia el contexto manualmente.');
            console.error('Clipboard error:', err);
        }
    };

    const handlePausar = () => {
        setModalConfig({
            isOpen: true,
            title: 'Pausar Curaduría',
            message: 'El proceso se pausará después de completar el lote actual. Podrás reanudarlo más tarde sin perder progreso.',
            variant: 'warning',
            confirmText: 'Pausar Proceso',
            onConfirm: async () => {
                setIsLoadingModal(true);
                const { updateCurationStatusAction } = await import('../../../app/admin/artifacts/actions');
                toast.info('Solicitando pausa...');
                await updateCurationStatusAction(artifactId, 'PAUSED_REQUESTED');
                refresh();
                setIsLoadingModal(false);
                setModalConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDetener = () => {
        // Force Stop Case
        if (curation?.state === 'STOPPED_REQUESTED') {
            setModalConfig({
                isOpen: true,
                title: '¿Forzar Detención?',
                message: (
                    <div className="space-y-2">
                        <p>El proceso parece estar tardando en detenerse.</p>
                        <p className="text-sm font-light opacity-80">
                            Esto actualizará forzosamente el estado en la interfaz a "Detenido".
                            Si el proceso de fondo sigue activo, podría intentar escribir más resultados,
                            pero la interfaz ya no los esperará.
                        </p>
                    </div>
                ),
                variant: 'critical',
                confirmText: 'Sí, Forzar Detención',
                onConfirm: async () => {
                    setIsLoadingModal(true);
                    const { updateCurationStatusAction } = await import('../../../app/admin/artifacts/actions');
                    await updateCurationStatusAction(artifactId, 'STOPPED'); // Force update
                    refresh();
                    setIsLoadingModal(false);
                    setModalConfig(prev => ({ ...prev, isOpen: false }));
                }
            });
            return;
        }

        // Normal Stop Case
        setModalConfig({
            isOpen: true,
            title: 'Detener Curaduría',
            message: (
                <div className="space-y-2">
                    <p>¿Seguro que deseas detener el proceso completamente?</p>
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-200 text-sm">
                        <AlertCircle size={14} className="inline mr-2" />
                        Esta acción detendrá la búsqueda de fuentes permanentemente para esta sesión.
                    </div>
                </div>
            ),
            variant: 'danger',
            confirmText: 'Detener Definitivamente',
            onConfirm: async () => {
                setIsLoadingModal(true);
                const { updateCurationStatusAction } = await import('../../../app/admin/artifacts/actions');
                toast.info('Deteniendo proceso...');
                await updateCurationStatusAction(artifactId, 'STOPPED_REQUESTED');
                refresh();
                setIsLoadingModal(false);
                setModalConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleReanudar = async () => {
        await startCuration(1, [], true);
    };

    // --- LOADING STATE WHILE HYDRATING ---
    // Evitar flash mostrando loading mientras se restaura el estado desde localStorage
    if (!isHydrated) {
        return (
            <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 size={32} className="text-[#00D4B3] animate-spin" />
                    <span className="text-[#6C757D] text-sm">Cargando...</span>
                </div>
            </div>
        );
    }

    // --- ADDED: VALIDATION LOADING VIEW ---
    if (isValidating) {
        return (
            <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[#0A2540] border border-[#00D4B3]/20 text-[#00D4B3]">
                            <CheckSquare size={24} />
                        </div>
                        Validación de Contenido
                    </h2>
                </div>

                <div className="relative overflow-hidden rounded-3xl border border-[#1E2329] bg-[#0F1419] shadow-2xl p-12 min-h-[500px] flex flex-col items-center justify-center group ring-1 ring-[#00D4B3]/10">

                    {/* Background Effects */}
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
                    <div className="absolute top-[-50%] right-[-20%] w-[800px] h-[800px] bg-[#1F5AF6]/5 rounded-full blur-[120px] animate-pulse-slow opacity-30" />

                    <div className="relative z-10 flex flex-col items-center max-w-xl w-full text-center space-y-12">

                        {/* Animated Icon */}
                        <div className="relative w-32 h-32 flex items-center justify-center">
                            <div className="absolute inset-0 animate-[spin_3s_linear_infinite]">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-[#00D4B3] rounded-full shadow-[0_0_8px_#00D4B3]" />
                            </div>
                            <div className="absolute inset-4 animate-[spin_5s_linear_infinite_reverse]">
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-1.5 bg-[#1F5AF6] rounded-full" />
                            </div>

                            <div className="relative w-16 h-16 bg-[#151A21] border border-[#1E2329] rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(0,212,179,0.05)] z-10">
                                <CheckCircle2 size={28} className="text-[#00D4B3] animate-pulse" />
                            </div>
                        </div>

                        {/* Text Content */}
                        <div className="space-y-4">
                            <h3 className="text-3xl font-bold text-white tracking-tight">
                                Verificando Fuentes
                            </h3>
                            <div className="flex flex-col gap-2">
                                <p className="text-[#94A3B8] text-base leading-relaxed max-w-sm mx-auto font-light">
                                    El Agente de Validación está revisando cada enlace, asegurando accesibilidad y relevancia en segundo plano...
                                </p>
                                <span className="text-xs font-mono text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-1 rounded-md mx-auto border border-[#00D4B3]/20 flex items-center gap-2">
                                    <RefreshCw size={10} className="animate-spin" />
                                    Procesando en tiempo real
                                </span>
                            </div>
                        </div>

                        {/* Progress Indication (Fake or Indeterminate) */}
                        <div className="w-full max-w-md space-y-3">
                            <div className="h-1.5 w-full bg-[#151A21] rounded-full overflow-hidden border border-[#1E2329]">
                                {/* Indeterminate loading bar */}
                                <motion.div
                                    className="h-full bg-gradient-to-r from-[#00D4B3] via-[#1F5AF6] to-[#00D4B3] w-[40%]"
                                    animate={{ x: ["-100%", "300%"] }}
                                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                />
                            </div>
                            <p className="text-[10px] text-[#6C757D] font-mono text-center">
                                Esto puede tomar unos minutos dependiendo de la cantidad de fuentes.
                            </p>
                        </div>

                    </div>
                </div>
            </div>
        );
    }

    // --- VIEW 1: GENERATING PROGRESS ---
    if (showGeneratingView) {
        return (
            <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-700">
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[#0A2540] border border-[#00D4B3]/20 text-[#00D4B3]">
                            <BookOpen size={24} />
                        </div>
                        Paso 4: Curaduría de Fuentes (Fase 2)
                    </h2>
                </div>

                {/* Background changed to #0F1419 to blend with Admin Panel */}
                <div className="relative overflow-hidden rounded-3xl border border-[#1E2329] bg-[#0F1419] shadow-2xl p-12 min-h-[500px] flex flex-col items-center justify-center group ring-1 ring-[#00D4B3]/10">

                    {/* Subtle Background Effects */}
                    <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5 mix-blend-overlay" />
                    <div className="absolute top-[-50%] left-[-20%] w-[800px] h-[800px] bg-[#00D4B3]/5 rounded-full blur-[120px] animate-pulse-slow opacity-30" />

                    <div className="relative z-10 flex flex-col items-center max-w-xl w-full text-center space-y-12">

                        {/* Central Animated Illustration - NO RINGS, ONLY DOTS */}
                        <div className="relative w-32 h-32 flex items-center justify-center">

                            {/* Orbiting Dots - Tracks hidden, only dots visible */}
                            <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-[#00D4B3] rounded-full shadow-[0_0_8px_#00D4B3]" />
                            </div>
                            <div className="absolute inset-4 animate-[spin_6s_linear_infinite_reverse]">
                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1.5 h-1.5 bg-[#1F5AF6] rounded-full" />
                            </div>

                            {/* Core Icon */}
                            <div className="relative w-16 h-16 bg-[#151A21] border border-[#1E2329] rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(0,212,179,0.05)] z-10">
                                <Library size={28} className="text-[#00D4B3]" />
                            </div>
                        </div>

                        {/* Text Content */}
                        <div className="space-y-4">
                            <h3 className="text-3xl font-bold text-white tracking-tight">
                                Buscando Fuentes
                            </h3>
                            <div className="flex flex-col gap-2">
                                <p className="text-[#94A3B8] text-base leading-relaxed max-w-sm mx-auto font-light">
                                    Investigando fuentes de alta calidad para cada lección del curso.
                                </p>
                                {rows.length > 0 && (
                                    <span className="text-xs font-mono text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-1 rounded-md mx-auto border border-[#00D4B3]/20">
                                        {rows.length} fuentes encontradas hasta ahora
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Dynamic Progress Bar */}
                        <div className="w-full max-w-md space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <span className="text-[10px] font-bold tracking-widest uppercase text-[#6C757D]">Estado del Agente</span>
                                <span className="text-xs font-mono font-medium text-[#00D4B3] flex items-center gap-2">
                                    {progress < 30 ? 'Iniciando...' : progress < 60 ? 'Analizando...' : 'Finalizando...'}
                                    <span className="opacity-80">| {progress}%</span>
                                </span>
                            </div>
                            <div className="h-2 w-full bg-[#151A21] rounded-full overflow-hidden border border-[#1E2329] p-[1px]">
                                <motion.div
                                    className="h-full rounded-full bg-gradient-to-r from-[#00D4B3] to-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                                    initial={{ width: "0%" }}
                                    animate={{ width: `${progress}%` }}
                                    transition={{ type: "spring", stiffness: 50, damping: 20 }}
                                />
                            </div>
                        </div>

                        {/* Footer Info & Refresh Button */}
                        <div className="flex flex-col gap-6 items-center w-full max-w-xs">
                            <div className="flex items-center gap-2 px-4 py-2 bg-[#151A21]/80 rounded-full border border-[#00D4B3]/20 backdrop-blur-sm">
                                <Loader2 size={12} className="text-[#00D4B3] animate-spin" />
                                <span className="text-[10px] text-[#00D4B3] font-medium tracking-wide uppercase">
                                    Auto-Refresh Activo
                                </span>
                            </div>

                            <button
                                onClick={() => refresh()}
                                className="w-full py-3 px-4 rounded-xl border border-[#6C757D]/30 text-[#94A3B8] hover:text-white hover:border-[#00D4B3] hover:bg-[#00D4B3]/5 transition-all duration-300 flex items-center justify-center gap-2 group"
                            >
                                <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" />
                                <span className="text-xs font-medium uppercase tracking-wide">Actualizar Progreso Manualmente</span>
                            </button>
                        </div>

                        {/* Control Buttons */}
                        <div className="flex gap-4 items-center">
                            <button
                                onClick={handlePausar}
                                disabled={curation?.state === 'PAUSED_REQUESTED' || curation?.state === 'STOPPED_REQUESTED'}
                                className="flex items-center gap-2 px-4 py-2 bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20 rounded-lg hover:bg-[#F59E0B]/20 transition-colors disabled:opacity-50"
                            >
                                <Pause size={16} /> {curation?.state === 'PAUSED_REQUESTED' ? 'Pausando...' : 'Pausar'}
                            </button>
                            <button
                                onClick={handleDetener}
                                disabled={curation?.state === 'PAUSED_REQUESTED'}
                                className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors disabled:opacity-50
                                   ${curation?.state === 'STOPPED_REQUESTED'
                                        ? 'bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444] font-bold animate-pulse'
                                        : 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20 hover:bg-[#EF4444]/20'}
                                `}
                            >
                                <Square size={16} />
                                {curation?.state === 'STOPPED_REQUESTED' ? 'Forzar Detención' : 'Detener'}
                            </button>
                        </div>

                    </div>
                </div>

                {/* Confirmation Modal */}
                <ConfirmationModal
                    isOpen={modalConfig.isOpen}
                    onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                    onConfirm={modalConfig.onConfirm}
                    title={modalConfig.title}
                    message={modalConfig.message}
                    variant={modalConfig.variant}
                    confirmText={modalConfig.confirmText}
                    isLoading={isLoadingModal}
                />
            </div>
        );
    }

    // --- VIEW 2: DASHBOARD (SOFIA Dark Theme) ---
    if (showDashboard) {
        return (
            <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
                <div className="space-y-2 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-[#0A0D12] border border-[#1E2329] text-[#00D4B3]">
                                <BookOpen size={24} />
                            </div>
                            Paso 4: Curaduría de Fuentes (Fase 2)
                        </h2>
                        <p className="text-[#6C757D] text-base ml-12">
                            Fuentes de calidad encontradas para cada lección.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleGenerate()}
                            className="px-3 py-1.5 rounded-lg border border-[#1E2329] text-[#6C757D] text-xs hover:border-[#6C757D] hover:text-white hover:bg-[#1E2329] transition-colors flex items-center gap-2"
                        >
                            <RefreshCw size={14} />
                            Reiniciar este paso
                        </button>

                        {curation?.state === 'PAUSED' && (
                            <button
                                onClick={handleReanudar}
                                className="px-3 py-1.5 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20 hover:bg-[#00D4B3]/20 transition-colors flex items-center gap-2 font-bold animate-pulse"
                            >
                                <PlayCircle size={14} />
                                Reanudar Generación
                            </button>
                        )}
                    </div>
                </div>

                <CurationDashboard
                    rows={rows}
                    onUpdateRow={updateRow}
                    isGenerating={isGenerating}
                />

                {/* REVISION PANEL FASE 4 */}
                <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
                    <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
                        <Edit3 size={18} /> Revisión Fase 4: Curaduría de Fuentes
                    </h3>

                    <textarea
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
                        placeholder="Escribe tus comentarios o feedback sobre la curaduría de fuentes..."
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        disabled={curation?.state === 'PHASE2_APPROVED'}
                    />

                    <div className="flex items-center gap-4 mt-4">
                        {curation?.state !== 'PHASE2_APPROVED' && curation?.state !== 'PHASE2_BLOCKED' && (
                            <>
                                <button
                                    onClick={handleValidate}
                                    disabled={isValidating || isGenerating}
                                    className="flex-1 bg-white dark:bg-[#0F1419] border border-[#00D4B3] hover:bg-[#00D4B3]/10 text-[#00D4B3] py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isValidating ? <RefreshCw size={18} className="animate-spin" /> : <CheckSquare size={18} />}
                                    {isValidating ? "Validando..." : "Validar Contenido"}
                                </button>
                                <button
                                    onClick={async () => {
                                        const { updateCurationStatusAction } = await import('../../../app/admin/artifacts/actions');
                                        await updateCurationStatusAction(artifactId, 'STEP_APPROVED', reviewNotes);
                                        toast.success('Fase 4 aprobada exitosamente');
                                        // Refresh both curation data and parent artifact view
                                        refresh();
                                        router.refresh();
                                    }}
                                    disabled={isValidating}
                                    className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                                    ${isValidating
                                            ? 'bg-[#00D4B3]/5 text-[#00D4B3]/30 border border-[#00D4B3]/5 cursor-not-allowed'
                                            : 'bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20'
                                        }
                                `}
                                >
                                    <CheckCircle2 size={18} />
                                    Aprobar Fase 4
                                </button>
                                <button
                                    onClick={async () => {
                                        const { updateCurationStatusAction } = await import('../../../app/admin/artifacts/actions');
                                        await updateCurationStatusAction(artifactId, 'STEP_REJECTED', reviewNotes);
                                        toast.info('Fase 4 rechazada');
                                        // Refresh both curation data and parent artifact view
                                        refresh();
                                        router.refresh();
                                    }}
                                    disabled={isValidating}
                                    className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                                    ${isValidating
                                            ? 'bg-[#EF4444]/5 text-[#EF4444]/30 border border-[#EF4444]/5 cursor-not-allowed'
                                            : 'bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20'
                                        }
                                `}
                                >
                                    <RefreshCw size={18} />
                                    Rechazar Fase 4
                                </button>
                            </>
                        )}

                        {curation?.state === 'PHASE2_APPROVED' && (
                            <div className="w-full flex gap-4">
                                <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                    <CheckCircle2 size={18} />
                                    Fase 4 Aprobada
                                </div>
                            </div>
                        )}

                        {curation?.state === 'PHASE2_BLOCKED' && (
                            <div className="w-full flex gap-4">
                                <div className="flex-1 bg-[#EF4444]/20 text-[#EF4444] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                    <AlertCircle size={18} />
                                    Fase 4 Rechazada
                                </div>
                                <button
                                    onClick={async () => {
                                        if (!confirm("¿Estás seguro de que quieres regenerar? Esto eliminará la curaduría actual.")) return;
                                        try {
                                            const { deleteCurationAction } = await import('../../../app/admin/artifacts/actions');
                                            await deleteCurationAction(artifactId);
                                            refresh();
                                            // Reset local state if needed
                                            setIsValidating(false);
                                            setReviewNotes('');
                                            // Force UI reset if useCuration hook doesn't auto-handle it effectively
                                            window.location.reload();
                                        } catch (e) {
                                            console.error(e);
                                        }
                                    }}
                                    className="flex-1 bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
                                >
                                    <RefreshCw size={18} />
                                    Regenerar Curaduría
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Confirmation Modal */}
                <ConfirmationModal
                    isOpen={modalConfig.isOpen}
                    onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                    onConfirm={modalConfig.onConfirm}
                    title={modalConfig.title}
                    message={modalConfig.message}
                    variant={modalConfig.variant}
                    confirmText={modalConfig.confirmText}
                    isLoading={isLoadingModal}
                />
            </div>
        );
    }

    // --- VIEW 3: INITIAL CONFIG - GPT PRIMARY, AUTOMATIC SECONDARY ---
    return (
        <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
            <div className="space-y-2">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6]">
                        <BookOpen size={24} />
                    </div>
                    Paso 4: Curaduría de Fuentes (Fase 2)
                </h2>
                <p className="text-gray-500 dark:text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
                    Encuentra fuentes de alta calidad para cada lección. Búsqueda profunda con 1-2 fuentes verificadas por lección.
                </p>
            </div>

            {/* PRIMARY: GPT Flow */}
            <div className="bg-gradient-to-br from-[#1F5AF6]/5 via-[#00D4B3]/5 to-[#1F5AF6]/5 dark:from-[#1F5AF6]/10 dark:via-[#00D4B3]/10 dark:to-[#1F5AF6]/10 border border-[#1F5AF6]/20 dark:border-[#1F5AF6]/30 rounded-2xl p-8 shadow-xl shadow-[#1F5AF6]/5 dark:shadow-black/20 transition-all duration-300 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#1F5AF6]/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-[#00D4B3]/10 rounded-full blur-2xl pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 rounded-lg bg-[#1F5AF6]/20 text-[#1F5AF6]">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 className="text-gray-900 dark:text-white font-bold text-lg">
                                Buscar con ChatGPT
                            </h3>
                            <span className="text-[10px] bg-[#1F5AF6]/20 text-[#1F5AF6] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                Recomendado
                            </span>
                        </div>
                    </div>

                    <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed mb-6 max-w-lg">
                        Usa nuestro GPT especializado para encontrar fuentes verificadas y relevantes.
                        El contexto del taller se copiará automáticamente al portapapeles.
                    </p>

                    <div className="flex flex-wrap gap-3 mb-6">
                        {['Fuentes Verificadas', 'Revisión Humana', 'Envío Automático'].map((tag, i) => (
                            <span key={i} className="text-[10px] bg-white dark:bg-[#151A21] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5">
                                <CheckCircle2 size={10} className="text-[#00D4B3]" />
                                {tag}
                            </span>
                        ))}
                    </div>

                    <button
                        onClick={handleOpenGPT}
                        disabled={!temario || temario.length === 0}
                        className={`
                            w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden
                            ${temario && temario.length > 0
                                ? 'bg-[#1F5AF6] hover:bg-[#1548c7] text-white shadow-lg shadow-[#1F5AF6]/25 hover:shadow-[#1F5AF6]/40 hover:-translate-y-0.5'
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            }
                        `}
                    >
                        {copiedToClipboard ? (
                            <>
                                <CheckCircle2 size={20} />
                                ¡Copiado! Abriendo ChatGPT...
                            </>
                        ) : (
                            <>
                                <ExternalLink size={20} />
                                Buscar fuentes con ChatGPT
                            </>
                        )}
                    </button>

                    {(!temario || temario.length === 0) && (
                        <p className="text-center text-amber-500 text-xs mt-3 flex items-center justify-center gap-1">
                            <AlertCircle size={12} />
                            Necesitas completar el temario primero (Paso 2)
                        </p>
                    )}

                    {temario && temario.length > 0 && (
                        <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
                            📋 Se copiará el contexto del taller ({temario.reduce((acc, m) => acc + m.lessons.length, 0)} lecciones) al portapapeles
                        </p>
                    )}
                </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-gray-200 dark:bg-[#2D333B]" />
                <span className="text-xs text-gray-400 dark:text-[#6C757D] font-medium">o</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-[#2D333B]" />
            </div>

            {/* SECONDARY: Automatic Flow (Collapsible) */}
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden shadow-md shadow-black/5 dark:shadow-black/20 transition-all duration-300">
                <button
                    onClick={() => setShowAutomaticFlow(!showAutomaticFlow)}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-[#1A2027] transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3]">
                            <Settings2 size={18} />
                        </div>
                        <div>
                            <h3 className="text-gray-900 dark:text-white font-semibold text-sm">
                                Búsqueda Automática
                            </h3>
                            <p className="text-gray-500 dark:text-[#6C757D] text-xs">
                                Usa el sistema de curaduría automática con IA
                            </p>
                        </div>
                    </div>
                    {showAutomaticFlow ? (
                        <ChevronUp size={20} className="text-gray-400" />
                    ) : (
                        <ChevronDown size={20} className="text-gray-400" />
                    )}
                </button>

                {showAutomaticFlow && (
                    <div className="p-6 pt-0 animate-in fade-in slide-in-from-top-2 duration-300 border-t border-gray-100 dark:border-[#2D333B]">
                        {/* Configuration Card */}
                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="text-gray-700 dark:text-gray-300 font-medium text-sm flex items-center gap-2">
                                    <Settings2 size={14} className="text-[#00D4B3]" />
                                    Configuración del Prompt
                                </h4>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-medium transition-colors ${useCustomPrompt ? 'text-[#00D4B3]' : 'text-gray-500 dark:text-[#6C757D]'}`}>
                                        {useCustomPrompt ? 'Personalizado' : 'Por defecto'}
                                    </span>
                                    <button
                                        onClick={() => setUseCustomPrompt(!useCustomPrompt)}
                                        className={`w-9 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${useCustomPrompt ? 'bg-[#00D4B3]/20 border-[#00D4B3]' : 'bg-gray-200 dark:bg-[#0F1419] border-gray-300 dark:border-[#6C757D]/20'}`}
                                    >
                                        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${useCustomPrompt ? 'left-[18px] bg-[#00D4B3]' : 'left-0.5 bg-gray-400 dark:bg-[#6C757D]'}`} />
                                    </button>
                                </div>
                            </div>

                            {useCustomPrompt ? (
                                <textarea
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    className="w-full h-32 bg-gray-50 dark:bg-[#0F1419] border border-gray-300 dark:border-[#00D4B3]/30 rounded-xl p-4 text-sm text-gray-900 dark:text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[#00D4B3] transition-colors resize-none"
                                    placeholder={DEFAULT_PROMPT_PREVIEW}
                                />
                            ) : (
                                <div className="bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-4">
                                    <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed">
                                        {DEFAULT_PROMPT_PREVIEW}
                                    </p>
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {['Google Search', 'Validación URL', 'Anti-Hallucination'].map((tag, i) => (
                                            <span key={i} className="text-[10px] bg-white dark:bg-[#151A21] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleGenerate}
                            className="w-full py-3 rounded-xl font-bold text-base flex items-center justify-center gap-3 transition-all bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-md shadow-[#00D4B3]/20"
                        >
                            <Play size={18} fill="currentColor" />
                            Iniciar Curaduría Automática
                        </button>

                        <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
                            La curaduría validará la disponibilidad de enlaces externamente.
                        </p>
                    </div>
                )}
            </div>

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                variant={modalConfig.variant}
                confirmText={modalConfig.confirmText}
                isLoading={isLoadingModal}
            />
        </div>
    );
}
