
import { useRef, useState, useEffect } from 'react';
import { BookOpen, Sparkles, Settings2, Play, CheckCircle2, ChevronDown, ChevronRight, LayoutList, MessageSquare, Book, FileText, Video as VideoIcon, BrainCircuit, RefreshCw, Clock, Target, CheckSquare, Layers, Info, AlertCircle, Edit3, Check, X, Trash2, Plus } from 'lucide-react';
import { InstructionalPlanValidationResult } from './InstructionalPlanValidationResult';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

// Initialize Supabase client for client-side
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const PremiumInput = ({ className, ...props }: any) => (
  <input
    className={`w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 
              text-white placeholder-white/30 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white/10
              transition-all duration-200 ${className}`}
    {...props}
  />
);

const PremiumTextarea = ({ className, ...props }: any) => (
  <textarea
    className={`w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 
              text-white placeholder-white/30 focus:outline-none focus:border-[#00D4B3]/50 focus:bg-white/10
              transition-all duration-200 resize-none ${className}`}
    {...props}
  />
);

const PremiumSelect = ({ options, value, onChange, placeholder = "Select...", className }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((o: any) => o.value === value)?.label || value || placeholder;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between gap-2 text-xs font-medium text-white hover:border-[#00D4B3]/50 transition-all"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className={`text-white/50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-white/10 bg-[#1E2329] shadow-2xl overflow-hidden z-[50] min-w-[150px]"
          >
            <div className="max-h-[200px] overflow-y-auto py-1">
                {options.map((option: any) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors flex items-center justify-between
                            ${option.value === value ? 'text-[#00D4B3] bg-[#00D4B3]/10' : 'text-gray-300'}
                    `}
                >
                    {option.label}
                    {option.value === value && <Check size={12} />}
                </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


interface InstructionalPlanGenerationContainerProps {
  artifactId: string;
  onNext?: () => void;
}

const DEFAULT_PROMPT_PREVIEW = `Genera un plan instruccional detallado para cada lección del temario proporcionado.
Para cada lección, debes estructurar el contenido en 4 componentes obligatorios:
1. DIALOGUE: Guion conversacional o explicativo.
2. READING: Material de lectura complementario.
3. QUIZ: Pregunta de evaluación.
4. VIDEO: Sugerencia visual o script.
...`;

// Component Badge Colors helper
const getComponentBadge = (type: string) => {
    const t = type.toUpperCase();
    if (t.includes('DIALOG')) return { color: 'text-blue-400 bg-blue-400/10 border-blue-400/20', icon: <MessageSquare size={12} />, label: 'Diálogo' };
    if (t.includes('READ')) return { color: 'text-green-400 bg-green-400/10 border-green-400/20', icon: <Book size={12} />, label: 'Lectura' };
    
    // Video Types Specifics
    if (t === 'VIDEO_DEMO' || t === 'VIDEO_GUIDE') return { color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20', icon: <VideoIcon size={12} />, label: 'Video Demo' };
    if (t.includes('VIDEO')) return { color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: <VideoIcon size={12} />, label: 'Video Teórico' };
    
    if (t.includes('QUIZ')) return { color: 'text-orange-400 bg-orange-400/10 border-orange-400/20', icon: <BrainCircuit size={12} />, label: 'Quiz' };
    if (t.includes('EXER')) return { color: 'text-pink-400 bg-pink-400/10 border-pink-400/20', icon: <LayoutList size={12} />, label: 'Ejercicio' };
    if (t.includes('DEMO_GUIDE')) return { color: 'text-teal-400 bg-teal-400/10 border-teal-400/20', icon: <Play size={12} />, label: 'Demo Interactiva' };
    
    return { color: 'text-gray-400 bg-gray-400/10 border-gray-400/20', icon: <FileText size={12} />, label: type };
};

const COMPONENT_TYPES = [
    { value: 'DIALOGUE', label: 'Diálogo' },
    { value: 'READING', label: 'Lectura' },
    { value: 'VIDEO_THEORY', label: 'Video Teórico' },
    { value: 'VIDEO_DEMO', label: 'Video Demo' },
    { value: 'QUIZ', label: 'Quiz' },
    { value: 'EXERCISE', label: 'Ejercicio' },
    { value: 'DEMO_GUIDE', label: 'Guía Interactiva' }
];

export function InstructionalPlanGenerationContainer({ artifactId, onNext }: InstructionalPlanGenerationContainerProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isValidating, setIsValidating] = useState(false); // New state
  const [existingPlan, setExistingPlan] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  
  // Edit State
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [editedLesson, setEditedLesson] = useState<any>(null);
  
  // Custom Prompt States
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  // Fetch plan on mount or poll
  const fetchPlan = async (silent = false) => {
      if (!silent) setLoadingPlan(true);
      
      const { data, error } = await supabase
          .from('instructional_plans')
          .select('*')
          .eq('artifact_id', artifactId)
          .maybeSingle();
      
      if (data && data.lesson_plans && data.lesson_plans.length > 0) {
          // USER REQUEST: Do not load previous validations on mount. 
          // Only show validation if it comes from a poll (silent update) triggered by the user.
          // Keep validation visible always

          if (data.approvals && data.approvals.notes) {
              setReviewNotes(data.approvals.notes);
          }

          setExistingPlan(data);
          setIsGenerating(false); // Stop generating state if plan exists
          
          if (data.validation) {
             setIsValidating(false);
          }
      } else {
          setExistingPlan(null);
      }
      
      if (!silent) setLoadingPlan(false);
  };

  // Effect 1: Initial Fetch
  useEffect(() => {
      fetchPlan(); 
  }, [artifactId]);

  // Effect 2: Polling & Realtime
  useEffect(() => {
      let intervalId: NodeJS.Timeout;
      
      // Polling strategy
      if (isGenerating || isValidating) { 
          intervalId = setInterval(async () => {
              console.log("Polling for plan updates...");
              await fetchPlan(true); // Silent poll
          }, 3000);
      }
      
      // Realtime subscription (keep as backup)
      const channel = supabase
        .channel('instructional_plans_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'instructional_plans',
            filter: `artifact_id=eq.${artifactId}`,
          },
          (payload) => {
            console.log('Realtime update:', payload);
            fetchPlan(true);
            if (payload.new && (payload.new as any).state === 'STEP_COMPLETED') {
                setIsGenerating(false);
            }
            if (payload.new && (payload.new as any).validation) { 
                setIsValidating(false);
            }
          }
        )
        .subscribe();

      return () => {
          supabase.removeChannel(channel);
          if (intervalId) clearInterval(intervalId);
      };
  }, [artifactId, isGenerating, isValidating]);


  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
        const { generateInstructionalPlanAction } = await import('../../../app/admin/artifacts/actions');
        const result = await generateInstructionalPlanAction(
            artifactId, 
            customPrompt, 
            useCustomPrompt
        );

        if (!result.success) {
            console.error(result.error);
            setIsGenerating(false);
        } else {
             console.log("Generation started successfully");
             // We rely on realtime or manual poll, but let's wait a bit and re-fetch just in case
             setTimeout(fetchPlan, 2000);
        }
    } catch (e) {
        console.error("Error calling action:", e);
        setIsGenerating(false);
    }
  };

  const handleValidate = async () => {
      setIsValidating(true);
      // Clear previous validation to show fresh state
      // Retain existing validation while re-validating
      try {
          const { validateInstructionalPlanAction } = await import('../../../app/admin/artifacts/actions');
          const result = await validateInstructionalPlanAction(artifactId);
          if (!result.success) {
              console.error(result.error);
              setIsValidating(false);
          } else {
               // Validation background job started
               // Polling will pick up the result
               // We keep isValidating true until polling finds the 'validation' field
          }
      } catch (e) {
          console.error("Error calling validate action:", e);
          setIsValidating(false);
      }
  };
  
  // Lesson Editing Handlers
  const handleStartEdit = (lesson: any) => {
      setEditingLessonId(lesson.lesson_id);
      setEditedLesson(JSON.parse(JSON.stringify(lesson))); // Deep copy
      setExpandedLessonId(lesson.lesson_id); // Ensure it's expanded
  };

  const handleCancelEdit = () => {
      setEditingLessonId(null);
      setEditedLesson(null);
  };

  interface Component {
    type: string;
    description?: string;
    summary?: string;
    duration?: string;
    [key: string]: any;
  }

  const handleSaveLesson = async () => {
      if (!editedLesson || !editingLessonId) return;

      try {
          // Prepare updated plan
          const updatedLessonPlans = existingPlan.lesson_plans.map((l: any) => 
              l.lesson_id === editingLessonId ? editedLesson : l
          );

          // Optimistic Update
          setExistingPlan({ ...existingPlan, lesson_plans: updatedLessonPlans });
          setEditingLessonId(null);
          
          // Server Action
          const { updateInstructionalPlanContentAction } = await import('../../../app/admin/artifacts/actions');
          const result = await updateInstructionalPlanContentAction(artifactId, updatedLessonPlans);
          
          if (result.success) {
              toast.success('Lección actualizada correctamente');
          } else {
              toast.error('Error al guardar cambios');
              // Revert logic could go here if critical
          }
      } catch (e) {
          console.error(e);
          toast.error('Error de conexión');
      }
  };

  const handleUpdateComponent = (idx: number, field: string, value: any) => {
      if (!editedLesson) return;
      const newComponents = [...editedLesson.components];
      newComponents[idx] = { ...newComponents[idx], [field]: value };
      setEditedLesson({ ...editedLesson, components: newComponents });
  };

  const handleTypeChange = (idx: number, newType: string) => {
      if (!editedLesson) return;
      const newComponents = [...editedLesson.components];
      // Reset implicit fields if type changes mostly? Or keep generic ones.
      newComponents[idx] = { ...newComponents[idx], type: newType };
      setEditedLesson({ ...editedLesson, components: newComponents });
  };
  
  // Group lessons by module
  const groupedModules = existingPlan?.lesson_plans?.reduce((acc: any, lesson: any) => {
      const modTitle = lesson.module_title || 'Módulo General';
      const modIndex = lesson.module_index ?? 999;
      
      if (!acc[modIndex]) {
          acc[modIndex] = {
              title: modTitle,
              index: modIndex,
              lessons: []
          };
      }
      acc[modIndex].lessons.push(lesson);
      return acc;
  }, {}) || {};

  const sortedModules = Object.values(groupedModules).sort((a: any, b: any) => a.index - b.index);

  if (loadingPlan) return <div className="text-center text-gray-500 py-10">Cargando plan instruccional...</div>;

  // --- VIEW: EXISTING PLAN (RESULTS) ---
  if (existingPlan) {
      return (
        <div className="max-w-5xl mx-auto space-y-8 pb-20 animate-in fade-in duration-500">
            <div className="flex justify-between items-center border-b border-gray-200 dark:border-gray-800 pb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
                            <CheckCircle2 size={24} />
                        </div>
                        Plan Instruccional Generado
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 ml-12">
                        {existingPlan.lesson_plans.length} lecciones planificadas • Iteración {existingPlan.iteration_count || 1}/2
                    </p>
                </div>
                <div className="flex items-center gap-3">

                    
                    <button 
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-gray-700 hover:border-[#00D4B3] text-gray-700 dark:text-gray-300 hover:text-[#00D4B3] dark:hover:text-[#00D4B3] rounded-lg transition-colors text-sm"
                    >
                        <RefreshCw size={14} className={isGenerating ? "animate-spin" : ""} />
                        {isGenerating ? "Regenerando..." : "Regenerar"}
                    </button>
                </div>
            </div>

            <div className="space-y-8">
                {sortedModules.map((mod: any) => (
                    <div key={mod.index} className="space-y-4">
                        <div className="flex items-center gap-3 py-4 border-b border-gray-200 dark:border-gray-800/50">
                            <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400 flex items-center justify-center font-bold text-sm">
                                {mod.index}
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-200">
                                {mod.title}
                            </h3>
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-1 rounded bg-gray-100 dark:bg-gray-800/50">
                                {mod.lessons.length} Lecciones
                            </span>
                        </div>

                        <div className="grid gap-4">
                            {mod.lessons.map((lesson: any, idx: number) => {
                                const isEditing = editingLessonId === lesson.lesson_id;
                                const displayLesson = isEditing ? editedLesson : lesson;

                                return (
                                <div 
                                    key={`lsn-${mod.index}-${idx}-${lesson.lesson_id || "noid"}`} 
                                    className={`
                                        group rounded-xl border transition-all duration-300 overflow-hidden
                                        ${expandedLessonId === lesson.lesson_id 
                                            ? 'bg-white dark:bg-[#0f1418] border-[#00D4B3]/30 shadow-lg shadow-black/5 dark:shadow-black/40' 
                                            : 'bg-white dark:bg-[#0A0E12] border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-[#0f1418]'
                                        }
                                    `}
                                >
                                    {/* Header Section */}
                                    <div 
                                        onClick={() => !isEditing && setExpandedLessonId(expandedLessonId === lesson.lesson_id ? null : lesson.lesson_id)}
                                        className={`p-5 flex items-start justify-between cursor-pointer ${isEditing ? 'cursor-default' : ''}`}
                                    >
                                        <div className="flex gap-4 flex-1">
                                            <div className="mt-1 flex flex-col items-center gap-2">
                                                <div className="h-6 w-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 flex items-center justify-center text-xs font-bold font-mono">
                                                    {lesson.lesson_order}
                                                </div>
                                                <div className={`h-full w-0.5 rounded-full ${expandedLessonId === lesson.lesson_id ? 'bg-[#00D4B3]/20' : 'bg-transparent'}`} />
                                            </div>
                                            
                                            <div className="space-y-1 flex-1">
                                                <h4 className={`font-semibold text-base transition-colors ${expandedLessonId === lesson.lesson_id ? 'text-[#00D4B3]' : 'text-gray-900 dark:text-gray-200 group-hover:text-[#00D4B3] dark:group-hover:text-white'}`}>
                                                    {lesson.lesson_title}
                                                </h4>
                                                
                                                {!isEditing && (
                                                    <div className="flex flex-wrap gap-2 pt-1">
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 uppercase">
                                                            <Clock size={10} />
                                                            {lesson.duration}
                                                        </span>
                                                        
                                                        {lesson.components.map((comp: any, cIdx: number) => {
                                                            const badge = getComponentBadge(comp.type);
                                                            return (
                                                                <span key={cIdx} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium tracking-wide border uppercase ${badge.color}`}>
                                                                    {badge.icon}
                                                                    {badge.label}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* Edit Button in Header */}
                                            {!isEditing && expandedLessonId === lesson.lesson_id && (
                                                <button 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStartEdit(lesson);
                                                    }}
                                                    className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                                >
                                                    <Edit3 size={16} />
                                                </button>
                                            )}

                                            <div className={`
                                                p-2 rounded-lg transition-all duration-300
                                                ${expandedLessonId === lesson.lesson_id ? 'bg-[#00D4B3] text-white dark:text-[#0A2540] rotate-180' : 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800/50 group-hover:bg-white dark:group-hover:bg-gray-800 group-hover:text-gray-600 dark:group-hover:text-gray-300'}
                                            `}>
                                                <ChevronDown size={16} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Details Section */}
                                    {expandedLessonId === lesson.lesson_id && (
                                        <div className="px-5 pb-5 pl-[3.25rem] space-y-6 animate-in slide-in-from-top-2 duration-300">
                                            
                                            {isEditing ? (
                                                // EDIT MODE FORM
                                                <div className="space-y-6 bg-white dark:bg-[#0A0E12] p-4 rounded-2xl border border-gray-200 dark:border-gray-800/60 shadow-inner">
                                                    
                                                    {/* Edit Objective */}
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-bold text-[#00D4B3] uppercase tracking-wider flex items-center gap-2">
                                                            <Target size={14} /> Objetivo de Aprendizaje
                                                        </label>
                                                        <PremiumTextarea
                                                            value={displayLesson.learning_objective || displayLesson.oa_text || ''}
                                                            onChange={(e: any) => setEditedLesson({...displayLesson, learning_objective: e.target.value})}
                                                            placeholder="Describe qué aprenderá el estudiante..."
                                                            className="min-h-[100px] text-sm bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/10"
                                                        />
                                                    </div>

                                                    {/* Edit Criteria */}
                                                    <div className="space-y-2">
                                                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                                                            <CheckSquare size={14} /> Criterio de Éxito
                                                        </label>
                                                        <PremiumInput
                                                            value={displayLesson.measurable_criteria || ''}
                                                            onChange={(e: any) => setEditedLesson({...displayLesson, measurable_criteria: e.target.value})}
                                                            placeholder="Ej: Identificar 3 de 5 elementos..."
                                                            className="text-sm bg-gray-50 dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/10"
                                                        />
                                                    </div>

                                                    {/* Edit Components List */}
                                                    <div className="space-y-4">
                                                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                                                            <span className="flex items-center gap-2"><Layers size={14} /> Componentes</span>
                                                        </div>

                                                        {displayLesson.components.map((comp: Component, cIdx: number) => (
                                                            <div key={cIdx} className="bg-gray-50 dark:bg-[#151A21]/50 border border-gray-200 dark:border-gray-700/50 rounded-xl p-4 space-y-3 relative group/edit-card hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                                                                <div className="flex gap-4">
                                                                    {/* Component Type & Duration Column */}
                                                                    <div className="w-48 space-y-3 flex-shrink-0">
                                                                        <div>
                                                                            <label className="text-[10px] text-gray-500 font-bold uppercase mb-1 block">Tipo</label>
                                                                            <PremiumSelect 
                                                                                options={COMPONENT_TYPES}
                                                                                value={comp.type}
                                                                                onChange={(val: string) => handleTypeChange(cIdx, val)}
                                                                                className="text-gray-900 dark:text-white bg-white dark:bg-white/5 border-gray-200 dark:border-white/10"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[10px] text-gray-500 font-bold uppercase mb-1 block">Duración</label>
                                                                            <PremiumInput
                                                                                value={comp.duration || ''}
                                                                                placeholder="Ej: 5 min"
                                                                                onChange={(e: any) => handleUpdateComponent(cIdx, 'duration', e.target.value)}
                                                                                className="px-3 py-2 text-xs bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/10"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    {/* Description Column */}
                                                                    <div className="flex-1">
                                                                        <label className="text-[10px] text-gray-500 font-bold uppercase mb-1 block">Descripción / Guion</label>
                                                                        <PremiumTextarea
                                                                            value={comp.description || comp.summary || ''}
                                                                            onChange={(e: any) => handleUpdateComponent(cIdx, 'description', e.target.value)}
                                                                            placeholder="Detalles sobre este componente..."
                                                                            className="min-h-[105px] text-xs leading-relaxed bg-white dark:bg-white/5 text-gray-900 dark:text-white border-gray-200 dark:border-white/10"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex gap-3 items-center pt-2">
                                                        <button 
                                                            onClick={handleSaveLesson}
                                                            className="px-5 py-2.5 bg-gradient-to-r from-[#00D4B3] to-[#00A38D] text-white dark:text-[#0A2540] rounded-xl font-bold text-sm flex items-center gap-2 hover:shadow-lg hover:shadow-[#00D4B3]/20 transition-all transform hover:-translate-y-0.5"
                                                        >
                                                            <Check size={16} /> Guardar Cambios
                                                        </button>
                                                        <button 
                                                            onClick={handleCancelEdit}
                                                            className="px-5 py-2.5 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 rounded-xl font-medium text-sm flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                                                        >
                                                            <X size={16} /> Cancelar
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                // VIEW MODE
                                                <>
                                                    {/* Learning Objective */}
                                                    <div className="space-y-3 relative">
                                                        <div className="absolute left-[-1.5rem] top-2 w-0.5 h-full bg-[#00D4B3]/20" />
                                                        
                                                        <div className="bg-[#00D4B3]/5 rounded-lg p-4 border border-[#00D4B3]/10">
                                                            <div className="flex items-center gap-2 mb-2 text-[#00D4B3] text-xs font-bold uppercase tracking-wider">
                                                                <Target size={14} />
                                                                Objetivo de Aprendizaje
                                                            </div>
                                                            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                                                                {lesson.learning_objective || lesson.oa_text}
                                                            </p>
                                                            <div className="mt-3 flex gap-2">
                                                                {(lesson.bloom_taxonomy_level || lesson.oa_bloom_verb) && (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 text-[10px] font-bold uppercase">
                                                                        Bloom: {lesson.bloom_taxonomy_level || lesson.oa_bloom_verb}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Measurable Criteria */}
                                                        {lesson.measurable_criteria && (
                                                            <div className="flex gap-3 items-start pl-2">
                                                                <div className="mt-1 p-1 rounded bg-green-500/10 text-green-600 dark:text-green-500">
                                                                    <CheckSquare size={12} />
                                                                </div>
                                                                <div>
                                                                    <span className="text-xs font-bold text-gray-500 uppercase">Criterio de Éxito</span>
                                                                    <p className="text-gray-600 dark:text-gray-400 text-sm">{lesson.measurable_criteria}</p>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Components Detail List */}
                                                    <div className="space-y-3">
                                                        <div className="flex items-center gap-2 text-gray-500 text-xs font-bold uppercase tracking-wider">
                                                            <Layers size={14} />
                                                            Componentes Detallados
                                                        </div>
                                                        
                                                        <div className="grid gap-3">
                                                            {lesson.components.map((comp: any, idx: number) => {
                                                                const badge = getComponentBadge(comp.type);
                                                                return (
                                                                    <div key={idx} className="bg-white dark:bg-[#161b22] p-3 rounded-lg border border-gray-200 dark:border-gray-800 flex gap-3 group/card hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                                                                        <div className={`mt-0.5 p-1.5 rounded h-fit ${badge.color.split(' ')[1]} ${badge.color.split(' ')[0]}`}>
                                                                            {badge.icon}
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <div className="flex items-center justify-between">
                                                                                <span className={`text-xs font-bold ${badge.color.split(' ')[0]}`}>
                                                                                    {badge.label}
                                                                                </span>
                                                                                {comp.duration && <span className="text-[10px] text-gray-500 dark:text-gray-600 font-mono">{comp.duration}</span>}
                                                                            </div>
                                                                            <p className="text-gray-700 dark:text-gray-400 text-sm leading-snug">
                                                                                {comp.description || comp.summary}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Notes Table */}
                                                    {lesson.alignment_notes && (
                                                        <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                                                            <div className="flex gap-2 items-start text-xs text-gray-500 italic">
                                                                <Info size={12} className="mt-0.5" />
                                                                <p>{lesson.alignment_notes}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Validation Result - Bottom Placement */}
            {existingPlan.validation && (
                <div className="pt-8 border-t border-gray-200 dark:border-gray-800">
                    <InstructionalPlanValidationResult validation={existingPlan.validation} />
                </div>
            )}

            {/* REVISION PANEL FASE 3 */}
            <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 mt-8">
                <h3 className="text-gray-900 dark:text-white font-bold mb-4 flex items-center gap-2">
                    <Edit3 size={18} /> Revisión Fase 3: Plan Instruccional
                </h3>
                
                <textarea
                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 min-h-[100px] placeholder-gray-400 dark:placeholder-gray-600"
                    placeholder="Escribe tus comentarios o feedback sobre el plan instruccional..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    disabled={existingPlan.state === 'STEP_APPROVED'}
                />

                <div className="flex items-center gap-4 mt-4">
                    {existingPlan.state !== 'STEP_APPROVED' && existingPlan.state !== 'STEP_REJECTED' && (
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
                                    const { updateInstructionalPlanStatusAction } = await import('../../../app/admin/artifacts/actions');
                                    await updateInstructionalPlanStatusAction(artifactId, 'STEP_APPROVED', reviewNotes);
                                    setExistingPlan({ ...existingPlan, state: 'STEP_APPROVED' });
                                    if (onNext) onNext();
                                }}
                                disabled={!existingPlan.validation || isValidating}
                                className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                                    ${!existingPlan.validation || isValidating 
                                        ? 'bg-[#00D4B3]/5 text-[#00D4B3]/30 border border-[#00D4B3]/5 cursor-not-allowed' 
                                        : 'bg-[#00D4B3]/10 hover:bg-[#00D4B3]/20 text-[#00D4B3] border border-[#00D4B3]/20'
                                    }
                                `}
                            >
                                <CheckCircle2 size={18} />
                                Aprobar Fase 3
                            </button>
                            <button 
                                onClick={async () => {
                                    const { updateInstructionalPlanStatusAction } = await import('../../../app/admin/artifacts/actions');
                                    await updateInstructionalPlanStatusAction(artifactId, 'STEP_REJECTED', reviewNotes);
                                    setExistingPlan({ ...existingPlan, state: 'STEP_REJECTED' }); 
                                }}
                                disabled={!existingPlan.validation || isValidating}
                                className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2
                                    ${!existingPlan.validation || isValidating 
                                        ? 'bg-[#EF4444]/5 text-[#EF4444]/30 border border-[#EF4444]/5 cursor-not-allowed' 
                                        : 'bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/20'
                                    }
                                `}
                            >
                                <RefreshCw size={18} />
                                Rechazar Fase 3
                            </button>
                        </>
                    )}

                    {existingPlan.state === 'STEP_APPROVED' && (
                        <div className="w-full flex gap-4">
                                <div className="flex-1 bg-[#00D4B3]/20 text-[#00D4B3] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                <CheckCircle2 size={18} />
                                Fase 3 Aprobada
                            </div>
                            {onNext && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        console.log('Navigating to next step (Sources)...');
                                        if (onNext) onNext();
                                    }}
                                    className="flex-1 bg-[#1F5AF6] hover:bg-[#1548c7] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1F5AF6]/20"
                                >
                                    Continuar a Fuentes
                                </button>
                            )}
                        </div>
                    )}
                    
                    {existingPlan.state === 'STEP_REJECTED' && (
                         <div className="w-full flex gap-4">
                                <div className="flex-1 bg-[#EF4444]/20 text-[#EF4444] py-3 rounded-xl font-bold text-center flex items-center justify-center gap-2">
                                <AlertCircle size={18} />
                                Fase 3 Rechazada
                            </div>
                             <button
                                onClick={async () => {
                                    if(!confirm("¿Estás seguro de que quieres regenerar? Esto eliminará el plan actual.")) return;
                                    try {
                                        const { deleteInstructionalPlanAction } = await import('../../../app/admin/artifacts/actions');
                                        await deleteInstructionalPlanAction(artifactId);
                                        setExistingPlan(null);
                                        setIsGenerating(false);
                                        setIsValidating(false);
                                        setReviewNotes('');
                                    } catch (e) {
                                        console.error(e);
                                    }
                                }}
                                className="flex-1 bg-[#EF4444] hover:bg-[#cc3a3a] text-white py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
                             >
                                <RefreshCw size={18} />
                                Regenerar Plan
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
      );
  }

  // --- VIEW: GENERATION FORM (DEFAULT) ---
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
         <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3]">
                <BookOpen size={24} />
            </div>
            Paso 3: Plan Instruccional
         </h2>
         <p className="text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
            La IA generará el plan instruccional detallado para cada lección, definiendo actividades, recursos y evaluaciones validadas pedagógicamente.
         </p>
      </div>

      <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6 shadow-xl shadow-black/20 transition-all duration-300">
          <div className="flex justify-between items-center mb-6">
              <h3 className="text-white font-semibold text-sm uppercase tracking-wider flex items-center gap-2">
                  <Settings2 size={16} className="text-[#00D4B3]" />
                  Versión del Prompt
              </h3>
              <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium transition-colors ${useCustomPrompt ? 'text-[#00D4B3]' : 'text-[#6C757D]'}`}>
                      {useCustomPrompt ? 'Prompt personalizado' : 'Prompt personalizado'}
                  </span>
                  
                  <button 
                      onClick={() => setUseCustomPrompt(!useCustomPrompt)}
                      className={`w-10 h-5 rounded-full relative border transition-all duration-300 focus:outline-none ${useCustomPrompt ? 'bg-[#00D4B3]/20 border-[#00D4B3]' : 'bg-[#0F1419] border-[#6C757D]/20'}`}
                  >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-sm ${useCustomPrompt ? 'left-5 bg-[#00D4B3]' : 'left-0.5 bg-[#6C757D]'}`} />
                  </button>
              </div>
          </div>

          <div className="relative">
              {useCustomPrompt ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-3">
                      <div className="flex justify-between items-center">
                          <label className="text-xs text-gray-400 font-medium">Instrucciones del Sistema para la IA</label>
                          <span className="text-[10px] text-[#00D4B3] bg-[#00D4B3]/10 px-2 py-0.5 rounded border border-[#00D4B3]/20">Modo Edición</span>
                      </div>
                      <textarea 
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="w-full h-48 bg-[#0F1419] border border-[#00D4B3]/30 rounded-xl p-4 text-sm text-gray-300 font-mono leading-relaxed focus:outline-none focus:border-[#00D4B3] transition-colors resize-none shadow-inner placeholder:text-gray-600"
                          placeholder={DEFAULT_PROMPT_PREVIEW}
                      />
                       <p className="text-xs text-gray-500">
                        <span className="text-[#00D4B3]">*</span> Asegúrate de solicitar una respuesta en formato JSON estrictamente válido.
                      </p>
                  </div>
              ) : (
                  <div className="bg-[#0F1419] border border-[#6C757D]/10 rounded-xl p-6 flex flex-col gap-4 group hover:border-[#00D4B3]/20 transition-colors cursor-default animate-in fade-in duration-300 relative overflow-hidden">
                       <div className="flex items-center gap-3 relative z-10">
                            <CheckCircle2 size={18} className="text-[#00D4B3]" />
                            <h4 className="text-[#00D4B3] font-bold text-sm">Configuración Optimizada</h4>
                       </div>
                       
                       <p className="text-[#94A3B8] text-sm leading-relaxed relative z-10">
                            Prompt optimizado para generar lecciones detalladas alineadas con el temario aprobado. Incluye la definición de objetivos de aprendizaje, criterios de éxito medibles y 4 componentes obligatorios por lección: Diálogo, Lectura, Quiz y Video, con validación de estructura JSON.
                       </p>

                       <div className="flex flex-wrap gap-2 relative z-10 mt-2">
                            {['Estructura JSON', 'Optimizado Gemini 2.0', 'Validación Pedagógica', 'Componentes Modulares'].map((tag, i) => (
                                <span key={i} className="text-[10px] bg-[#151A21] text-gray-400 border border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider">
                                    {tag}
                                </span>
                            ))}
                       </div>
                       
                       {/* Shield Icon Background Effect */}
                       <div className="absolute right-[-20px] top-[-20px] opacity-5">
                            <svg width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                       </div>
                  </div>
              )}
          </div>
      </div>

      <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={`
              w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden
              ${isGenerating 
                  ? 'bg-[#00D4B3]/20 text-[#00D4B3] cursor-wait border border-[#00D4B3]/20' 
                  : 'bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5'}
          `}
      >
          {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span>Generando Estructura Instruccional...</span>
              </>
          ) : (
              <>
                  <Play size={20} fill="currentColor" />
                  Generar Plan Instruccional
              </>
          )}
      </button>

      <div className="text-center">
          <p className="text-[#6C757D] text-xs">
              La generación puede tomar entre 30 a 60 segundos.
          </p>
      </div>

    </div>
  );
}
