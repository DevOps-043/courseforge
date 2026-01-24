
'use client';

import { useState, useEffect } from 'react';
import {
    CheckCircle2, AlertCircle, BookOpen, Layers,
    FileText, Edit3, Target, RotateCw,
    Save, X, Edit2, Check
} from 'lucide-react';
import { regenerateArtifactAction, updateArtifactContentAction, updateArtifactStatusAction } from '../actions';
import { useRouter } from 'next/navigation';
import { SyllabusGenerationContainer } from '@/domains/syllabus/components/SyllabusGenerationContainer';
import { InstructionalPlanGenerationContainer } from '@/domains/plan/components/InstructionalPlanGenerationContainer';
import { SourcesCurationGenerationContainer } from '@/domains/curation/components/SourcesCurationGenerationContainer';
import { MaterialsForm } from '@/domains/materials/components/MaterialsForm';
import { VisualProductionContainer } from '@/domains/materials/components/VisualProductionContainer';

export default function ArtifactClientView({ artifact }: { artifact: any }) {
    const [activeTab, setActiveTab] = useState<'content' | 'validation'>('content');
    const [currentStep, setCurrentStep] = useState(1);
    const [feedback, setFeedback] = useState('');
    const [isRegenerating, setIsRegenerating] = useState(false);

    // Si el artefacto ya está aprobado (Fase 1), inicializamos en 'approved'
    const [reviewState, setReviewState] = useState<'pending' | 'approved' | 'rejected'>(
        artifact.state === 'APPROVED' || artifact.qa_status === 'APPROVED' ? 'approved' : 'pending'
    );

    const [toast, setToast] = useState<{ show: boolean, message: string, type: 'success' | 'error' | 'info' }>({ show: false, message: '', type: 'info' });
    const router = useRouter();

    const [editingSection, setEditingSection] = useState<'nombres' | 'objetivos' | 'descripcion' | null>(null);
    const [editedContent, setEditedContent] = useState({
        nombres: artifact.nombres || [],
        objetivos: artifact.objetivos || [],
        descripcion: {
            texto: artifact.descripcion?.texto || artifact.descripcion?.resumen || '',
            publico_objetivo: artifact.descripcion?.publico_objetivo || '',
            beneficios: artifact.descripcion?.beneficios || ''
        }
    });

    useEffect(() => {
        setEditedContent({
            nombres: artifact.nombres || [],
            objetivos: artifact.objetivos || [],
            descripcion: {
                texto: artifact.descripcion?.texto || artifact.descripcion?.resumen || '',
                publico_objetivo: artifact.descripcion?.publico_objetivo || '',
                beneficios: artifact.descripcion?.beneficios || ''
            }
        });
    }, [artifact]);

    const validation = artifact.validation_report || { results: [], all_passed: false };

    const statusColors: any = {
        READY_FOR_QA: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
        ESCALATED: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
        GENERATING: 'text-blue-400 bg-blue-500/10 border-blue-500/20 animate-pulse',
        APPROVED: 'text-green-400 bg-green-500/10 border-green-500/20'
    };
    const currentStatusStyle = statusColors[artifact.state] || statusColors.GENERATING;

    // Polling
    useEffect(() => {
        if (artifact.state === 'GENERATING' || isRegenerating) {
            const interval = setInterval(() => {
                console.log('Polling artifact status...');
                router.refresh();
            }, 3000);
            return () => clearInterval(interval);
        }
    }, [artifact.state, isRegenerating, router]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ show: true, message, type });
        setTimeout(() => setToast(prev => ({ ...prev, show: false })), 4000);
    };

    const handleRegenerate = async () => {
        setIsRegenerating(true);
        try {
            await regenerateArtifactAction(artifact.id, feedback);
            showToast('Regeneración iniciada.', 'info');
            setReviewState('pending');
            setFeedback('');
            router.refresh();
        } catch (e) {
            showToast('Error al regenerar.', 'error');
        } finally {
            setIsRegenerating(false);
        }
    };

    // Lógica de aprobación de Syllabus
    // Asumimos que artifact tiene relación con syllabus y trae su estado.
    const syllabusApproved = artifact.syllabus_status === 'STEP_APPROVED' || (artifact.temario && artifact.temario.qa?.status === 'APPROVED');
    const planApproved = artifact.plan_state === 'STEP_APPROVED';
    const curationApproved = artifact.curation_state === 'PHASE2_APPROVED' || artifact.curation_state === 'PHASE2_READY_FOR_QA' || artifact.curation_state === 'PHASE2_HITL_REVIEW' || artifact.curation_state === 'PHASE2_GENERATED';



    const handleSaveContent = async () => {
        if (!editingSection) return;

        try {
            const updates: any = {};
            if (editingSection === 'nombres') updates.nombres = editedContent.nombres;
            if (editingSection === 'objetivos') updates.objetivos = editedContent.objetivos;
            if (editingSection === 'descripcion') updates.descripcion = { ...artifact.descripcion, ...editedContent.descripcion };

            const res = await updateArtifactContentAction(artifact.id, updates);

            if (res.success) {
                setEditingSection(null);
                showToast('Cambios guardados.', 'success');
                router.refresh();
            } else {
                showToast('Error al guardar.', 'error');
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    const handleCancelEdit = () => {
        setEditingSection(null);
        setEditedContent({
            nombres: artifact.nombres || [],
            objetivos: artifact.objetivos || [],
            descripcion: {
                texto: artifact.descripcion?.texto || artifact.descripcion?.resumen || '',
                publico_objetivo: artifact.descripcion?.publico_objetivo || '',
                beneficios: artifact.descripcion?.beneficios || ''
            }
        });
    };

    return (
        <div className="space-y-8 relative">
            {/* TOAST */}
            {toast.show && (
                <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md ${toast.type === 'success' ? 'bg-[#00D4B3]/10 border-[#00D4B3]/20 text-[#00D4B3]' :
                        toast.type === 'error' ? 'bg-[#EF4444]/10 border-[#EF4444]/20 text-[#EF4444]' :
                            'bg-[#151A21] border-[#6C757D]/20 text-white'
                        }`}>
                        {toast.type === 'success' && <CheckCircle2 size={18} />}
                        {toast.type === 'error' && <AlertCircle size={18} />}
                        {toast.type === 'info' && <RotateCw size={18} className="animate-spin" />}
                        <span className="text-sm font-medium">{toast.message}</span>
                        <button onClick={() => setToast(t => ({ ...t, show: false }))} className="ml-2 opacity-50"><X size={14} /></button>
                    </div>
                </div>
            )}

            {/* HEADER */}
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 relative overflow-hidden flex items-center justify-between gap-4">
                <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-[#1F5AF6]/5 rounded-full blur-[80px] pointer-events-none translate-x-1/2 -translate-y-1/2" />
                <div className="relative z-10 flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate" title={artifact.idea_central}>
                            {(artifact.idea_central || 'Artefacto sin nombre')
                                .replace(/(TEMA:|IDEA PRINCIPAL:|PÚBLICO:|RESULTADOS:)/g, '')
                                .split('.')[0]
                                .trim()}
                        </h1>
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 uppercase tracking-wider ${currentStatusStyle}`}>
                            {artifact.state === 'READY_FOR_QA' ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                            {artifact.state.replace('_', ' ')}
                        </div>
                    </div>
                    <p className="text-gray-500 dark:text-[#6C757D] text-xs font-mono">{artifact.courseId || artifact.id} • Creado hace {new Date(artifact.created_at).toLocaleDateString()}</p>
                </div>
            </div>

            {/* STEPPER */}
            <div className="px-8 py-6 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl flex items-center justify-between overflow-x-auto">
                <StepItem step={1} label="Base" active={currentStep === 1} onClick={() => setCurrentStep(1)} icon={<Target size={18} />} done={reviewState === 'approved'} />

                <div className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${reviewState === 'approved' ? 'bg-[#1F5AF6]' : 'bg-gray-200 dark:bg-[#2D333B]'}`} />

                <StepItem
                    step={2}
                    label="Temario"
                    active={currentStep === 2}
                    onClick={() => setCurrentStep(2)}
                    icon={<BookOpen size={18} />}
                    disabled={reviewState !== 'approved' && !artifact.temario}
                    done={syllabusApproved || currentStep > 2}
                />

                <div className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${syllabusApproved || currentStep > 2 ? 'bg-[#1F5AF6]' : 'bg-gray-200 dark:bg-[#2D333B]'}`} />

                <StepItem
                    step={3}
                    label="Plan"
                    active={currentStep === 3}
                    onClick={() => setCurrentStep(3)}
                    icon={<Layers size={18} />}
                    disabled={!syllabusApproved}
                    done={planApproved}
                />

                <div className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${planApproved ? 'bg-[#1F5AF6]' : 'bg-gray-200 dark:bg-[#2D333B]'}`} />

                <StepItem
                    step={4}
                    label="Fuentes"
                    active={currentStep === 4}
                    onClick={() => setCurrentStep(4)}
                    disabled={!planApproved}
                    icon={<FileText size={18} />}
                    done={curationApproved}
                />

                <div className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${curationApproved ? 'bg-[#1F5AF6]' : 'bg-gray-200 dark:bg-[#2D333B]'}`} />

                <StepItem
                    step={5}
                    label="Materiales"
                    active={currentStep === 5}
                    onClick={() => setCurrentStep(5)}
                    icon={<Layers size={18} />}
                    disabled={!curationApproved}
                    done={artifact.materials_state === 'PHASE3_APPROVED'}
                />

                <div className={`h-0.5 flex-1 mx-4 rounded-full transition-colors relative top-[-10px] ${artifact.materials_state === 'PHASE3_APPROVED' ? 'bg-[#1F5AF6]' : 'bg-gray-200 dark:bg-[#2D333B]'}`} />

                <StepItem
                    step={6}
                    label="Producción"
                    active={currentStep === 6}
                    onClick={() => setCurrentStep(6)}
                    icon={<Target size={18} />}
                    disabled={artifact.materials_state !== 'PHASE3_APPROVED'}
                />
            </div>

            {/* CONTENT SWITCHER */}
            {currentStep === 1 ? (
                <>
                    <div className="flex items-center gap-4">
                        {['content', 'validation'].map((tab) => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-[#1F5AF6] text-white' : 'bg-white dark:bg-[#151A21] text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-[#6C757D]/10'}`}
                            >
                                {tab === 'content' ? 'Idea Central' : 'Validación'}
                            </button>
                        ))}
                    </div>

                    {activeTab === 'content' ? (
                        <div className="space-y-6">
                            <SectionCard
                                title="Nombres del Curso"
                                icon={<FileText size={18} className="text-[#00D4B3]" />}
                                action={
                                    editingSection === 'nombres' ? (
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleSaveContent} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors"><Check size={16} /></button>
                                            <button onClick={handleCancelEdit} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"><X size={16} /></button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setEditingSection('nombres')} className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"><Edit2 size={16} /></button>
                                    )
                                }
                            >
                                {editingSection === 'nombres' ? (
                                    <div className="space-y-3">
                                        {editedContent.nombres.map((nombre: string, idx: number) => (
                                            <div key={idx} className="flex items-center gap-3">
                                                <span className="text-[#6C757D] font-mono text-sm">{idx + 1}.</span>
                                                <input
                                                    className="flex-1 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3] transition-colors"
                                                    value={nombre}
                                                    onChange={(e) => {
                                                        const newNombres = [...editedContent.nombres];
                                                        newNombres[idx] = e.target.value;
                                                        setEditedContent({ ...editedContent, nombres: newNombres });
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {(artifact.nombres || []).map((nombre: string, idx: number) => (
                                            <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/10 text-gray-900 dark:text-white text-sm">
                                                <span className="text-[#6C757D] font-mono">{idx + 1}.</span> {nombre}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </SectionCard>

                            <SectionCard
                                title="Objetivos"
                                icon={<Target size={18} className="text-[#F59E0B]" />}
                                action={
                                    editingSection === 'objetivos' ? (
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleSaveContent} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors"><Check size={16} /></button>
                                            <button onClick={handleCancelEdit} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"><X size={16} /></button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setEditingSection('objetivos')} className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"><Edit2 size={16} /></button>
                                    )
                                }
                            >
                                {editingSection === 'objetivos' ? (
                                    <div className="space-y-3">
                                        {editedContent.objetivos.map((obj: string, idx: number) => (
                                            <div key={idx} className="flex items-start gap-3">
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-4 shrink-0" />
                                                <textarea
                                                    className="flex-1 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg p-3 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#F59E0B] transition-colors min-h-[60px]"
                                                    value={obj}
                                                    onChange={(e) => {
                                                        const newObjetivos = [...editedContent.objetivos];
                                                        newObjetivos[idx] = e.target.value;
                                                        setEditedContent({ ...editedContent, objetivos: newObjetivos });
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <ul className="space-y-3">
                                        {(artifact.objetivos || []).map((obj: string, idx: number) => (
                                            <li key={idx} className="flex gap-3 text-sm text-gray-700 dark:text-[#E9ECEF] bg-gray-50 dark:bg-[#0F1419] p-3 rounded-lg border border-gray-200 dark:border-[#6C757D]/10">
                                                <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-2 shrink-0" /> {obj}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </SectionCard>

                            <SectionCard
                                title="Descripción"
                                icon={<Layers size={18} className="text-[#1F5AF6]" />}
                                action={
                                    editingSection === 'descripcion' ? (
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleSaveContent} className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg transition-colors"><Check size={16} /></button>
                                            <button onClick={handleCancelEdit} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"><X size={16} /></button>
                                        </div>
                                    ) : (
                                        <button onClick={() => setEditingSection('descripcion')} className="p-1.5 hover:bg-[#1F5AF6]/10 text-[#6C757D] hover:text-[#1F5AF6] rounded-lg transition-colors"><Edit2 size={16} /></button>
                                    )
                                }
                            >
                                {editingSection === 'descripcion' ? (
                                    <textarea
                                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#1F5AF6] min-h-[150px] leading-relaxed"
                                        value={editedContent.descripcion.texto}
                                        onChange={(e) => setEditedContent({
                                            ...editedContent,
                                            descripcion: { ...editedContent.descripcion, texto: e.target.value }
                                        })}
                                    />
                                ) : (
                                    <p className="text-sm text-gray-700 dark:text-[#E9ECEF] bg-gray-50 dark:bg-[#0F1419] p-4 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 leading-relaxed">{artifact.descripcion?.texto || 'N/A'}</p>
                                )}
                            </SectionCard>

                            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
                                <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
                                    <Edit3 size={18} /> Revisión Fase 1
                                </h3>

                                <textarea
                                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
                                    placeholder="Escribe tus comentarios o feedback para la IA..."
                                    value={feedback}
                                    onChange={(e) => setFeedback(e.target.value)}
                                    disabled={reviewState === 'approved' || isRegenerating}
                                />

                                <div className="flex items-center gap-4 mt-4">
                                    {reviewState === 'pending' && (
                                        <>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await updateArtifactStatusAction(artifact.id, 'APPROVED');
                                                        if (res.success) {
                                                            setReviewState('approved');
                                                            showToast('Fase 1 Aprobada.', 'success');
                                                            router.refresh();
                                                        } else {
                                                            showToast('Error al actualizar.', 'error');
                                                        }
                                                    } catch (e) {
                                                        console.error(e);
                                                        showToast('Error de conexión.', 'error');
                                                    }
                                                }}
                                                className="flex-1 bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20 py-3 rounded-xl font-medium transition-all"
                                            >
                                                Aprobar Fase 1
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await updateArtifactStatusAction(artifact.id, 'REJECTED');
                                                        if (res.success) {
                                                            setReviewState('rejected');
                                                            showToast('Fase 1 Rechazada.', 'info');
                                                            router.refresh();
                                                        } else {
                                                            showToast('Error al actualizar.', 'error');
                                                        }
                                                    } catch (e) {
                                                        console.error(e);
                                                        showToast('Error de conexión.', 'error');
                                                    }
                                                }}
                                                className="flex-1 bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20 py-3 rounded-xl font-medium transition-all"
                                            >
                                                Rechazar Fase 1
                                            </button>
                                        </>
                                    )}

                                    {reviewState === 'rejected' && (
                                        <button
                                            onClick={handleRegenerate}
                                            disabled={isRegenerating}
                                            className="w-full bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                                        >
                                            {isRegenerating ? <RotateCw className="animate-spin" /> : <RotateCw />}
                                            {isRegenerating ? 'Regenerando...' : 'Regenerar Contenido con IA'}
                                        </button>
                                    )}

                                    {reviewState === 'approved' && (
                                        <div className="w-full flex gap-4">
                                            <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                                <CheckCircle2 /> Fase 1 Aprobada
                                            </div>
                                            <button
                                                onClick={() => setCurrentStep(2)}
                                                className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
                                            >
                                                Continuar a Estructura
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* SEARCH QUERIES */}
                            {artifact.generation_metadata?.search_queries && artifact.generation_metadata.search_queries.length > 0 && (
                                <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-5">
                                    <h3 className="text-gray-900 dark:text-white font-bold text-sm mb-3 flex items-center gap-2">
                                        <Layers size={16} className="text-[#1F5AF6]" />
                                        Búsquedas de Investigación
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {artifact.generation_metadata.search_queries.map((q: string, idx: number) => (
                                            <span key={idx} className="text-xs text-gray-600 dark:text-[#E9ECEF] bg-gray-100 dark:bg-[#0F1419] px-3 py-1.5 rounded-full border border-gray-200 dark:border-[#6C757D]/20">
                                                🔍 {q}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* VALIDATION RESULTS */}
                            <div className="space-y-2">
                                {validation.results?.map((res: any, idx: number) => (
                                    <div key={idx} className={`p-4 rounded-xl border flex items-start gap-4 ${res.passed ? 'bg-[#00D4B3]/10 border-[#00D4B3]/20' : 'bg-[#EF4444]/10 border-[#EF4444]/20'}`}>
                                        {res.passed ? <CheckCircle2 className="text-[#00D4B3]" /> : <AlertCircle className="text-[#EF4444]" />}
                                        <p className="text-sm text-gray-900 dark:text-white mt-1">{res.message}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            ) : currentStep === 2 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <SyllabusGenerationContainer
                        artifactId={artifact.id}
                        initialObjetivos={artifact.objetivos || []}
                        initialIdeaCentral={artifact.idea_central || ''}
                        onNext={() => setCurrentStep(3)}
                    />
                </div>
            ) : currentStep === 3 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <InstructionalPlanGenerationContainer
                        artifactId={artifact.id}
                        onNext={() => setCurrentStep(4)}
                    />
                </div>
            ) : currentStep === 4 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <SourcesCurationGenerationContainer
                        artifactId={artifact.id}
                    />
                </div>
            ) : currentStep === 5 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <MaterialsForm artifactId={artifact.id} />
                </div>
            ) : currentStep === 6 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                    <VisualProductionContainer artifactId={artifact.id} />
                </div>
            ) : null}
        </div>
    )
}

function SectionCard({ title, icon, action, children }: any) {
    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-[#6C757D]/10 flex justify-between items-center bg-gray-50 dark:bg-[#1A2027]">
                <h3 className="text-gray-900 dark:text-white font-bold flex items-center gap-2">{icon} {title}</h3>
                {action && <div>{action}</div>}
            </div>
            <div className="p-6">{children}</div>
        </div>
    )
}

function StepItem({ step, label, active, onClick, icon, disabled, done }: any) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`flex flex-col items-center gap-2 group ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
        >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all border-2 relative 
                ${active
                    ? 'border-blue-600 text-blue-600 dark:border-[#1F5AF6] dark:text-[#1F5AF6] bg-white dark:bg-[#0F1419]'
                    : done
                        ? 'border-green-500 text-green-500 dark:border-[#00D4B3] dark:text-[#00D4B3] bg-green-50 dark:bg-[#00D4B3]/10'
                        : 'border-gray-200 dark:border-[#2D333B] text-gray-400 dark:text-[#6C757D] bg-white dark:bg-[#0F1419]'
                }`}>
                {done ? <CheckCircle2 size={16} /> : icon}
            </div>
            <span className={`text-xs font-medium uppercase ${active ? 'text-blue-600 dark:text-[#1F5AF6]' : done ? 'text-green-500 dark:text-[#00D4B3]' : 'text-gray-400 dark:text-[#6C757D]'}`}>{label}</span>
        </button>
    )
}
