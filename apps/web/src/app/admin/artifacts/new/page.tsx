'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Upload, ArrowRight, BookOpen, Users, Target, Settings, ChevronDown, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { generateArtifactAction } from '../actions';

export default function NewArtifactPage() {
  const [mode, setMode] = useState<'ai' | 'import'>('ai');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
      title: '',
      description: '',
      targetAudience: '',
      expectedResults: '',
      courseId: ''
  });

  const router = useRouter();

  const handleGenerate = async () => {
      setIsLoading(true);
      try {
        const result = await generateArtifactAction({
            title: formData.title,
            description: formData.description,
            targetAudience: formData.targetAudience,
            expectedResults: formData.expectedResults,
            courseId: formData.courseId
        });

        if (result.success) {
            // Redirect to artifacts list (later to detail view)
            router.push('/admin/artifacts');
        } else {
            console.error(result.error);
            alert('Error generando el artefacto: ' + result.error);
        }
      } catch (error) {
          console.error(error);
          alert('Ocurrió un error inesperado.');
      } finally {
        setIsLoading(false);
      }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="bg-linear-to-r from-[#0A2540] to-[#151A21] rounded-2xl p-8 border border-[#1F5AF6]/20 relative overflow-hidden">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#1F5AF6]/10 rounded-full blur-[80px] pointer-events-none translate-x-1/3 -translate-y-1/3" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#00D4B3]/5 rounded-full blur-[60px] pointer-events-none -translate-x-1/3 translate-y-1/3" />
        
        <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#00D4B3] mb-2 font-medium text-sm tracking-wide uppercase">
                <Sparkles size={16} />
                <span>Generador de Contenido con IA</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 font-sans">Generar Nuevo Artefacto</h1>
            <p className="text-[#94A3B8] max-w-2xl text-lg">
                Crea un nuevo curso utilizando Inteligencia Artificial o importa contenido existente para comenzar.
                Nuestra IA estructurará tus ideas en un formato pedagógico completo.
            </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Main Form */}
          <div className="lg:col-span-2 space-y-8">
              
              {/* Mode Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ModeCard 
                      active={mode === 'ai'} 
                      onClick={() => setMode('ai')}
                      icon={<Sparkles className="text-[#00D4B3]" size={24} />}
                      title="Crear con IA"
                      description="Estructurado y Preciso. Genera desde cero."
                  />
                  <ModeCard 
                      active={mode === 'import'} 
                      onClick={() => setMode('import')}
                      icon={<Upload className="text-[#1F5AF6]" size={24} />}
                      title="Importar Existente"
                      description="Pega contenido completo o sube archivos."
                  />
              </div>

              {/* Form Container */}
              <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6 md:p-8 shadow-xl">
                  {mode === 'ai' ? (
                      <div className="space-y-6">
                        
                        {/* Title Input */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-white flex items-center gap-2">
                                <BookOpen size={16} className="text-[#00D4B3]" />
                                Tema o Título del Curso
                            </label>
                            <input 
                                type="text" 
                                placeholder="Ej. Curso Completo de Python para Data Science"
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-3.5 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3]/50 focus:ring-1 focus:ring-[#00D4B3]/20 transition-all font-medium"
                                value={formData.title}
                                onChange={e => setFormData({...formData, title: e.target.value})}
                            />
                        </div>

                        {/* Description Textarea */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-white flex justify-between items-center">
                                <span>Idea Principal y Descripción</span>
                                <span className="text-xs text-[#6C757D]">{formData.description.length}/1000</span>
                            </label>
                            <textarea 
                                placeholder="Describe de qué trata el curso en detalle... Por ejemplo: 'Un curso introductorio para enseñar Python a analistas financieros, enfocándose en librerías como Pandas y visualización de datos...'"
                                className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-3.5 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3]/50 focus:ring-1 focus:ring-[#00D4B3]/20 transition-all min-h-[160px] resize-none leading-relaxed"
                                value={formData.description}
                                onChange={e => setFormData({...formData, description: e.target.value})}
                                maxLength={1000}
                            />
                        </div>

                        {/* Two Columns Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-white flex items-center gap-2">
                                    <Users size={16} className="text-[#F59E0B]" />
                                    Público Objetivo
                                </label>
                                <input 
                                    type="text" 
                                    placeholder="Ej. Principiantes, Gerentes..."
                                    className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-3 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3]/50 transition-all"
                                    value={formData.targetAudience}
                                    onChange={e => setFormData({...formData, targetAudience: e.target.value})}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-white flex items-center gap-2">
                                    <Target size={16} className="text-[#10B981]" />
                                    Resultados Esperados
                                </label>
                                <input 
                                    type="text" 
                                    placeholder="Ej. Crear primera app web..."
                                    className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-xl px-4 py-3 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3]/50 transition-all"
                                    value={formData.expectedResults}
                                    onChange={e => setFormData({...formData, expectedResults: e.target.value})}
                                />
                            </div>
                        </div>

                        {/* Advanced Config Toggle */}
                        <div className="pt-4 border-t border-[#6C757D]/10">
                            <button 
                                onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                                className="flex items-center gap-2 text-sm text-[#94A3B8] hover:text-white transition-colors"
                            >
                                <Settings size={16} />
                                Configuración Avanzada
                                <ChevronDown size={14} className={`transform transition-transform ${isAdvancedOpen ? 'rotate-180' : ''}`} />
                            </button>
                            
                            {isAdvancedOpen && (
                                <motion.div 
                                    initial={{ height: 0, opacity: 0 }} 
                                    animate={{ height: 'auto', opacity: 1 }}
                                    className="pt-4"
                                >
                                    <div className="space-y-2">
                                        <label className="text-xs uppercase tracking-wider text-[#6C757D] font-bold">ID del Curso (Opcional)</label>
                                        <input 
                                            type="text" 
                                            placeholder="#1. MARKETING-101"
                                            className="w-full bg-[#0F1419] border border-[#6C757D]/20 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#00D4B3]/30"
                                            value={formData.courseId}
                                            onChange={e => setFormData({...formData, courseId: e.target.value})}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </div>

                      </div>
                  ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                          <Upload size={48} className="text-[#6C757D] mb-4" />
                          <h3 className="text-white font-medium mb-2">Construcción en Proceso</h3>
                          <p className="text-[#94A3B8] max-w-md">La funcionalidad de importación estará disponible pronto. Por favor usa la generación con IA.</p>
                      </div>
                  )}
              </div>



          </div>

          {/* Right Column: Inspiration / Sidebar */}
          <div className="lg:col-span-1 space-y-6">
              
              <div className="bg-[#151A21] border border-[#6C757D]/10 rounded-2xl p-6">
                  <h3 className="text-[#00D4B3] font-bold text-sm tracking-wider uppercase mb-4 flex items-center gap-2">
                      <Sparkles size={14} />
                      Plantillas de Inspiración
                  </h3>
                  <p className="text-xs text-[#94A3B8] mb-6">Usa estas plantillas para ver cómo estructurar un buen prompt:</p>

                  <div className="space-y-4">
                      <TemplateCard 
                          title="Liderazgo Moderno"
                          description="Liderazgo transformacional para gerentes."
                          onClick={() => setFormData({
                              ...formData, 
                              title: "Liderazgo Moderno para Gerentes TI", 
                              description: "Un curso enfocado en desarrollar habilidades blandas para líderes técnicos, cubriendo empatía, comunicación asertiva y gestión de conflictos en equipos remotos.",
                              targetAudience: "Gerentes de Ingeniería, Tech Leads",
                              expectedResults: "Mejorar retención de talento y velocidad de entrega"
                          })}
                      />
                      <TemplateCard 
                          title="Comunicación Remota"
                          description="Comunicación efectiva en equipos distribuidos."
                          onClick={() => setFormData({
                              ...formData, 
                              title: "Comunicación Asertiva en Entornos Remotos", 
                              description: "Estrategias para mejorar la comunicación asíncrona y síncrona en equipos globales. Uso de herramientas como Slack y Zoom efectivamente.",
                              targetAudience: "Equipos remotos, Project Managers",
                              expectedResults: "Reducción de reuniones innecesarias"
                          })}
                      />
                      <TemplateCard 
                          title="Productividad Personal"
                          description="Gestión de tiempo y energía."
                          onClick={() => setFormData({
                              ...formData, 
                              title: "Productividad y Gestión del Tiempo", 
                              description: "Técnicas avanzadas de time-blocking y gestión de energía para profesionales con alta carga cognitiva.",
                              targetAudience: "Profesionales, Emprendedores",
                              expectedResults: "Aumento del 20% en output diario"
                          })}
                      />
                  </div>
              </div>

              <div className="bg-[#0A2540]/50 border border-[#1F5AF6]/10 rounded-2xl p-6">
                  <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-[#1F5AF6]/20 flex items-center justify-center text-[#1F5AF6] shrink-0">
                          <CheckCircle2 size={20} />
                      </div>
                      <div>
                          <h4 className="text-white font-medium text-sm mb-1">Calidad Garantizada</h4>
                          <p className="text-xs text-[#94A3B8]">
                              Nuestro agente de QA revisará automáticamente la estructura generada para asegurar coherencia pedagógica antes de aprobarla.
                          </p>
                      </div>
                  </div>
              </div>

               {/* Action Button (Moved Here) */}
               <div className="pt-4 sticky top-6">
                   <button 
                        onClick={handleGenerate}
                        disabled={isLoading || !formData.description}
                        className={`
                            relative w-full overflow-hidden group px-6 py-4 rounded-2xl font-bold font-sans shadow-2xl flex items-center justify-center gap-3 transition-all duration-300 transform
                            ${isLoading || !formData.description 
                                ? 'bg-[#00D4B3]/10 text-[#00D4B3]/30 cursor-not-allowed border border-[#00D4B3]/10' 
                                : 'bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-lg shadow-[#00D4B3]/25 hover:shadow-[#00D4B3]/40 hover:-translate-y-0.5'
                            }
                        `}
                   >
                        {/* Shimmer Effect for active state */}
                        {!isLoading && formData.description && (
                            <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-linear-to-r from-transparent via-white/10 to-transparent" />
                        )}

                        {isLoading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Generando...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={20} className={`${formData.description ? 'group-hover:animate-pulse' : ''}`} />
                                <span className="text-lg">Generar Estructura</span>
                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                   </button>
              </div>

          </div>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, description }: any) {
    return (
        <button 
            onClick={onClick}
            className={`
                relative p-6 rounded-2xl border text-left transition-all duration-300 w-full group
                ${active 
                    ? 'bg-[#151A21] border-[#1F5AF6] shadow-lg shadow-[#1F5AF6]/10' 
                    : 'bg-[#151A21]/50 border-[#6C757D]/10 hover:border-[#6C757D]/30 hover:bg-[#151A21]'
                }
            `}
        >
            <div className={`mb-4 w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${active ? 'bg-[#1F5AF6]/10' : 'bg-[#1E2329]'}`}>
                {icon}
            </div>
            <h3 className={`font-bold text-lg mb-1 transition-colors ${active ? 'text-white' : 'text-[#E9ECEF]'}`}>{title}</h3>
            <p className="text-sm text-[#94A3B8]">{description}</p>
            
            {active && (
                <div className="absolute top-4 right-4 text-[#1F5AF6]">
                    <CheckCircle2 size={20} />
                </div>
            )}
        </button>
    )
}

function TemplateCard({ title, description, onClick }: any) {
    return (
        <button 
            onClick={onClick}
            className="w-full text-left p-4 rounded-xl bg-[#0F1419] border border-[#6C757D]/10 hover:border-[#00D4B3]/30 hover:shadow-lg hover:shadow-[#00D4B3]/5 transition-all group"
        >
            <h4 className="text-white font-medium text-sm mb-1 group-hover:text-[#00D4B3] transition-colors">{title}</h4>
            <p className="text-xs text-[#94A3B8]">{description}</p>
        </button>
    )
}
