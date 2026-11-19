'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Sparkles, Upload, ArrowRight, BookOpen, Users, Target, Settings, ChevronDown, CheckCircle2 } from 'lucide-react';

import { generateArtifactAction } from '@/domains/artifacts/actions/artifact.actions';
import { DeliveryConfigurationFields } from '@/domains/course-delivery/components/DeliveryConfigurationFields';
import { deliveryConfigSchema, type DeliveryConfig } from '@/domains/course-delivery/types/delivery.schemas';
import { configureCreatedArtifactDeliveryAction } from '@/domains/course-delivery/actions/delivery-initialization.actions';
import { CourseSourceDraft } from '@/domains/course-sources/CourseSourceDraft';
import { ScormImportFlow } from '@/app/admin/artifacts/new/components/ScormImportFlow';
import { CloudStorageProviderSelector } from '@/app/admin/artifacts/new/components/CloudStorageProviderSelector';
import { toast } from 'sonner';
import { FieldHelp } from '@/components/ui/FieldHelp';
import { artifactCreationHelp, artifactStartHelp } from '../lib/artifact-creation-help';
import type { CloudStorageProvider } from '@/domains/production/cloud-storage/types';
import {
    createDefaultVideoDurationPolicy,
    VideoDurationPolicyFields,
} from '@/domains/artifacts/components/VideoDurationPolicyFields';
import {
    videoDurationPolicySchema,
    type VideoDurationPolicy,
} from '@/domains/video-duration/video-duration-policy';

interface ArtifactIdeaFormData {
    courseId: string;
    description: string;
    expectedResults: string;
    targetAudience: string;
    title: string;
}

interface SelectionCardProps {
    disabled?: boolean;
    active: boolean;
    description: string;
    icon: React.ReactNode;
    onClick: () => void;
    title: string;
}

interface TemplateCardProps {
    disabled?: boolean;
    description: string;
    onClick: () => void;
    title: string;
}

export function ArtifactCreationForm({ basePath, sessionsEnabled }: { basePath: string; sessionsEnabled: boolean }) {
    const fieldId = useId();
    const [mode, setMode] = useState<'ai' | 'import'>('ai');
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig>(() => deliveryConfigSchema.parse({}));
    const [documentDraftId, setDocumentDraftId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const submission = useRef({ pending: false, requestId: '' });
    const [cloudStorageProvider, setCloudStorageProvider] = useState<CloudStorageProvider | null>(null);
    const [videoDurationPolicy, setVideoDurationPolicy] = useState<VideoDurationPolicy>(
        createDefaultVideoDurationPolicy,
    );

    // Form State
    const [formData, setFormData] = useState<ArtifactIdeaFormData>({
        title: '',
        description: '',
        targetAudience: '',
        expectedResults: '',
        courseId: ''
    });

    const router = useRouter();
    const videoDurationValidation = videoDurationPolicySchema.safeParse(videoDurationPolicy);
    const live = deliveryConfig.mode !== 'NEXUS';
    const deliveryValidation = !live || deliveryConfigSchema.safeParse(deliveryConfig).success;
    const isGenerateDisabled = isLoading || Boolean(documentDraftId) || !formData.description.trim() || !deliveryValidation || (deliveryConfig.mode !== 'SYNCHRONOUS' && !videoDurationValidation.success);

    const handleCloudStorageProviderChange = useCallback((provider: CloudStorageProvider | null) => {
        setCloudStorageProvider(provider);
    }, []);

    const handleGenerate = async () => {
        if (submission.current.pending) return;
        if (documentDraftId) return;
        if (!deliveryValidation) { toast.error('Revisa los ajustes de las sesiones.'); return; }
        const validation = videoDurationPolicySchema.safeParse(videoDurationPolicy);
        if (deliveryConfig.mode !== 'SYNCHRONOUS' && !validation.success) {
            setIsAdvancedOpen(true);
            toast.error(validation.error.issues[0]?.message || 'Configuración de duración inválida.');
            return;
        }

        submission.current.pending = true;
        submission.current.requestId ||= crypto.randomUUID();
        setIsLoading(true);
        try {
            const result = await generateArtifactAction({
                requestId: submission.current.requestId,
                title: formData.title,
                description: formData.description,
                targetAudience: formData.targetAudience,
                expectedResults: formData.expectedResults,
                courseId: formData.courseId,
                cloudStorageProvider,
                videoDurationPolicy: deliveryConfig.mode === 'SYNCHRONOUS' ? createDefaultVideoDurationPolicy() : videoDurationPolicy,
                deliveryConfig,
            });

            if (result.success) {
                router.push(`${basePath}/artifacts/${result.artifactId}`);
            } else {
                submission.current.pending = false;
                console.error(result.error);
                toast.error(`Error generando el artefacto: ${result.error}`);
            }
        } catch (error) {
            submission.current.pending = false;
            console.error(error);
            toast.error('Ocurrió un error inesperado.');
        } finally {
            if (!submission.current.pending) setIsLoading(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            {/* Header Section */}
            <div className="engine-page-hero">
                <div className="relative z-10">
                    <div className="engine-eyebrow flex items-center gap-2">
                        <Sparkles size={16} />
                        <span>Diseño de experiencias de aprendizaje</span>
                    </div>
                    <h1 className="mb-2 text-3xl md:text-4xl">Crear un curso o taller</h1>
                    <p className="max-w-2xl text-base">
                        Crea un nuevo curso utilizando Inteligencia Artificial o importa contenido existente para comenzar.
                        Elige la modalidad y comparte el contexto una sola vez.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Main Form */}
                <div className="lg:col-span-2 space-y-8">

                    {/* Form Container */}
                    <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 md:p-8 shadow-xl">
                    <section className="mb-6">
                        <DeliveryConfigurationFields value={deliveryConfig} onChange={setDeliveryConfig} sessionsEnabled={sessionsEnabled} disabled={isLoading || Boolean(documentDraftId)} />
                    </section>

                    {/* Mode Selection */}
                    <div className="mb-3 flex items-center justify-between gap-3 text-sm font-medium">
                        <span>¿Cómo quieres comenzar?</span>
                        <FieldHelp label="Origen del contenido" description={artifactCreationHelp.start} selection={artifactStartHelp[mode]} />
                    </div>
                    <div className="mb-6 grid grid-cols-1 gap-3 border-b border-[var(--engine-border)] pb-6 md:grid-cols-2">
                        <ModeCard
                            disabled={isLoading || Boolean(documentDraftId)}
                            active={mode === 'ai'}
                            onClick={() => setMode('ai')}
                            icon={<Sparkles className="text-[var(--engine-accent)]" size={24} />}
                            title="Crear con IA"
                            description="Desarrolla tu idea desde cero."
                        />
                        <ModeCard
                            disabled={isLoading || Boolean(documentDraftId)}
                            active={mode === 'import'}
                            onClick={() => setMode('import')}
                            icon={<Upload className="text-[var(--engine-info)]" size={24} />}
                            title="Importar SCORM"
                            description="Parte de un paquete .zip existente."
                        />
                    </div>


                        {mode === 'ai' ? (
                          <>
                            <fieldset disabled={isLoading || Boolean(documentDraftId)} className="min-w-0 space-y-6 border-0 p-0">

                                {/* Title Input */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3"><label htmlFor={`${fieldId}-title`} className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                        <BookOpen size={16} className="text-[var(--engine-accent)]" />
                                        Tema o título del curso o taller
                                    </label><FieldHelp label="Tema o título" description={artifactCreationHelp.title} /></div>
                                    <input
                                        id={`${fieldId}-title`}
                                        maxLength={300}
                                        type="text"
                                        placeholder="Ej. Curso Completo de Python para Data Science"
                                        className="w-full bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/20 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[var(--engine-muted)] focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/20 transition-all font-medium"
                                        value={formData.title}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setFormData(prev => ({ ...prev, title: val }));
                                        }}
                                    />
                                </div>

                                {/* Description Textarea */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3"><label htmlFor={`${fieldId}-description`} className="flex-1 text-sm font-medium text-gray-900 dark:text-white flex justify-between items-center">
                                        <span>Idea Principal y Descripción</span>
                                        <span className="text-xs text-gray-500 dark:text-[var(--engine-muted)]">{formData.description.length}/1000</span>
                                    </label><FieldHelp label="Idea principal y descripción" description={artifactCreationHelp.description} /></div>
                                    <textarea
                                        id={`${fieldId}-description`}
                                        placeholder="Describe de qué trata el curso en detalle... Por ejemplo: 'Un curso introductorio para enseñar Python a analistas financieros, enfocándose en librerías como Pandas y visualización de datos...'"
                                        className="w-full bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/20 rounded-xl px-4 py-3.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[var(--engine-muted)] focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/20 transition-all min-h-[160px] resize-none leading-relaxed"
                                        value={formData.description}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setFormData(prev => ({ ...prev, description: val }));
                                        }}
                                        maxLength={1000}
                                    />
                                </div>

                                {/* Two Columns Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3"><label htmlFor={`${fieldId}-audience`} className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            <Users size={16} className="text-[#F59E0B]" />
                                            Público Objetivo
                                        </label><FieldHelp label="Público objetivo" description={artifactCreationHelp.audience} /></div>
                                        <input
                                            id={`${fieldId}-audience`}
                                            type="text"
                                            placeholder="Ej. Principiantes, Gerentes..."
                                            className="w-full bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/20 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[var(--engine-muted)] focus:outline-none focus:border-[var(--engine-accent)]/50 transition-all"
                                            value={formData.targetAudience}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setFormData(prev => ({ ...prev, targetAudience: val }));
                                            }}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3"><label htmlFor={`${fieldId}-results`} className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            <Target size={16} className="text-[#10B981]" />
                                            Resultados Esperados
                                        </label><FieldHelp label="Resultados esperados" description={artifactCreationHelp.results} /></div>
                                        <input
                                            id={`${fieldId}-results`}
                                            type="text"
                                            placeholder="Ej. Crear primera app web..."
                                            className="w-full bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/20 rounded-xl px-4 py-3 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[var(--engine-muted)] focus:outline-none focus:border-[var(--engine-accent)]/50 transition-all"
                                            value={formData.expectedResults}
                                            onChange={e => {
                                                const val = e.target.value;
                                                setFormData(prev => ({ ...prev, expectedResults: val }));
                                            }}
                                        />
                                    </div>
                                </div>

                                {/* Advanced Config Toggle */}
                                <div className="pt-4 border-t border-gray-200 dark:border-[var(--engine-muted)]/10">
                                    <button
                                        onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                                        className="flex items-center gap-2 text-sm text-gray-500 dark:text-[var(--engine-text-muted)] hover:text-gray-900 dark:hover:text-white transition-colors"
                                    >
                                        <Settings size={16} />
                                        Configuración Avanzada
                                        <ChevronDown size={14} className={`transform transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {isAdvancedOpen && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            className="pt-4 space-y-4"
                                        >
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between gap-3"><label htmlFor={`${fieldId}-course-id`} className="text-xs uppercase tracking-wider text-gray-500 dark:text-[var(--engine-muted)] font-bold">ID del Curso (Opcional)</label><FieldHelp label="ID del curso" description={artifactCreationHelp.courseId} /></div>
                                                <input
                                                    id={`${fieldId}-course-id`}
                                                    type="text"
                                                    placeholder="#1. MARKETING-101"
                                                    className="w-full bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/20 rounded-lg px-4 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[var(--engine-accent)]/30"
                                                    value={formData.courseId}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setFormData(prev => ({ ...prev, courseId: val }));
                                                    }}
                                                />
                                            </div>

                                            <CloudStorageProviderSelector onProviderChange={handleCloudStorageProviderChange} />
                                            {deliveryConfig.mode !== 'SYNCHRONOUS' && <VideoDurationPolicyFields
                                                showHelp
                                                onChange={setVideoDurationPolicy}
                                                value={videoDurationPolicy}
                                            />}
                                            {deliveryConfig.mode === 'SYNCHRONOUS' && <p className="text-sm text-[var(--engine-text-muted)]">La duración se define por sesión. Este taller no requiere configurar videos asíncronos.</p>}
                                        </motion.div>
                                    )}
                                </div>

                                {/* Action Button for AI Mode */}
                                <div className="pt-4 sticky top-6">
                                    <button
                                        onClick={handleGenerate}
                                        disabled={isGenerateDisabled}
                                        className={`
                                    relative w-full overflow-hidden group px-6 py-4 rounded-2xl font-bold font-sans shadow-2xl flex items-center justify-center gap-3 transition-all duration-300 transform
                                    ${isGenerateDisabled
                                                ? 'bg-gray-200 text-gray-400 dark:bg-[var(--engine-accent)]/10 dark:text-[var(--engine-accent)]/30 cursor-not-allowed border border-transparent dark:border-[var(--engine-accent)]/10'
                                                : 'bg-[var(--engine-primary)] text-white hover:bg-[var(--engine-primary)]/90 dark:bg-[var(--engine-accent)] dark:text-[var(--engine-primary)] dark:hover:bg-[var(--engine-accent-hover)] shadow-lg shadow-[var(--engine-primary)]/25 dark:shadow-[var(--engine-accent)]/25 hover:shadow-[var(--engine-primary)]/40 dark:hover:shadow-[var(--engine-accent)]/40 hover:-translate-y-0.5'
                                            }
                                `}
                                    >
                                        {/* Shimmer Effect for active state */}
                                        {!isGenerateDisabled && (
                                            <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                                        )}

                                        {isLoading ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white dark:border-[var(--engine-primary)]/30 dark:border-t-[var(--engine-primary)] rounded-full animate-spin" />
                                                <span>Generando...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={20} className={`${!isGenerateDisabled ? 'group-hover:animate-pulse' : ''}`} />
                                                <span className="text-lg">Generar Estructura</span>
                                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                            </>
                                        )}
                                    </button>
                                </div>

                            </fieldset>
                            <CourseSourceDraft basePath={basePath} title={formData.title} deliveryConfig={deliveryConfig} onCreated={setDocumentDraftId} />
                            {documentDraftId && <p role="status" className="mt-4 text-sm text-[var(--engine-text-muted)]">La modalidad y el título quedaron guardados. Continúa desde tus documentos para trabajar sobre este mismo curso.</p>}
                          </>
                        ) : (
                            <ScormImportFlow
                                onComplete={async (artifactId) => {
                                    setIsLoading(true);
                                    try {
                                        await configureCreatedArtifactDeliveryAction(artifactId, deliveryConfig);
                                        router.push(`${basePath}/artifacts/${artifactId}`);
                                    } finally { setIsLoading(false); }
                                }}
                            />
                        )}
                    </div>



                </div>

                {/* Right Column: Inspiration / Sidebar */}
                <div className="lg:col-span-1 space-y-6">

                    <div className="bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/10 rounded-2xl p-6 shadow-xl">
                        <h3 className="text-[var(--engine-accent)] font-bold text-sm tracking-wider uppercase mb-4 flex items-center gap-2">
                            <Sparkles size={14} />
                            Plantillas de Inspiración
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)] mb-6">Usa estas plantillas para ver cómo estructurar un buen prompt:</p>

                        <div className="space-y-4">
                            <TemplateCard
                                disabled={isLoading || Boolean(documentDraftId)}
                                title="Liderazgo Moderno"
                                description="Liderazgo transformacional para gerentes."
                                onClick={() => setFormData(prev => ({
                                    ...prev,
                                    title: "Liderazgo Moderno para Gerentes TI",
                                    description: "Un curso enfocado en desarrollar habilidades blandas para líderes técnicos, cubriendo empatía, comunicación asertiva y gestión de conflictos en equipos remotos.",
                                    targetAudience: "Gerentes de Ingeniería, Tech Leads",
                                    expectedResults: "Mejorar retención de talento y velocidad de entrega"
                                }))}
                            />
                            <TemplateCard
                                disabled={isLoading || Boolean(documentDraftId)}
                                title="Comunicación Remota"
                                description="Comunicación efectiva en equipos distribuidos."
                                onClick={() => setFormData(prev => ({
                                    ...prev,
                                    title: "Comunicación Asertiva en Entornos Remotos",
                                    description: "Estrategias para mejorar la comunicación asíncrona y síncrona en equipos globales. Uso de herramientas como Slack y Zoom efectivamente.",
                                    targetAudience: "Equipos remotos, Project Managers",
                                    expectedResults: "Reducción de reuniones innecesarias"
                                }))}
                            />
                            <TemplateCard
                                disabled={isLoading || Boolean(documentDraftId)}
                                title="Productividad Personal"
                                description="Gestión de tiempo y energía."
                                onClick={() => setFormData(prev => ({
                                    ...prev,
                                    title: "Productividad y Gestión del Tiempo",
                                    description: "Técnicas avanzadas de time-blocking y gestión de energía para profesionales con alta carga cognitiva.",
                                    targetAudience: "Profesionales, Emprendedores",
                                    expectedResults: "Aumento del 20% en output diario"
                                }))}
                            />
                        </div>
                    </div>

                    <div className="bg-[var(--engine-primary)]/5 dark:bg-[var(--engine-primary)]/50 border border-[var(--engine-info)]/10 rounded-2xl p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-[var(--engine-info)]/20 flex items-center justify-center text-[var(--engine-info)] shrink-0">
                                <CheckCircle2 size={20} />
                            </div>
                            <div>
                                <h4 className="text-gray-900 dark:text-white font-medium text-sm mb-1">Calidad Garantizada</h4>
                                <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">
                                    Nuestro agente de QA revisará automáticamente la estructura generada para asegurar coherencia pedagógica antes de aprobarla.
                                </p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

function ModeCard({ active, onClick, icon, title, description, disabled }: SelectionCardProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={onClick}
            className={`
                relative flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-300 w-full group disabled:cursor-not-allowed disabled:opacity-50
                ${active
                    ? 'bg-white dark:bg-[var(--engine-surface-solid)] border-[var(--engine-info)] shadow-lg shadow-[var(--engine-info)]/10'
                    : 'bg-white dark:bg-[var(--engine-surface-solid)]/50 border-gray-200 dark:border-[var(--engine-muted)]/10 hover:border-gray-300 dark:hover:border-[var(--engine-muted)]/30 hover:bg-gray-50 dark:hover:bg-[var(--engine-surface-solid)]'
                }
            `}
        >
            <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-colors ${active ? 'bg-[var(--engine-info)]/10' : 'bg-gray-100 dark:bg-[var(--engine-surface-hover)]'}`}>
                {icon}
            </div>
            <div className="min-w-0 flex-1 pr-4"><h3 className={`font-semibold text-sm mb-1 transition-colors ${active ? 'text-[var(--engine-info)] dark:text-white' : 'text-gray-900 dark:text-[#E9ECEF]'}`}>{title}</h3>
            <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">{description}</p></div>

            {active && (
                <div className="absolute top-4 right-4 text-[var(--engine-info)]">
                    <CheckCircle2 size={20} />
                </div>
            )}
        </button>
    )
}

function TemplateCard({ title, description, onClick, disabled }: TemplateCardProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="w-full text-left p-4 rounded-xl bg-gray-50 dark:bg-[var(--engine-canvas)] border border-gray-200 dark:border-[var(--engine-muted)]/10 hover:border-[var(--engine-accent)]/30 hover:shadow-lg hover:shadow-[var(--engine-accent)]/5 transition-all group"
        >
            <h4 className="text-gray-900 dark:text-white font-medium text-sm mb-1 group-hover:text-[var(--engine-accent)] transition-colors">{title}</h4>
            <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">{description}</p>
        </button>
    )
}
