'use client';

import { useState, useEffect } from 'react';
import { Save, AlertTriangle, CheckCircle2, MessageSquareCode } from 'lucide-react';
import { SystemPrompt, UpdateSystemPromptDTO } from '../types';
import { getSystemPromptsAction, updateSystemPromptAction } from '../../../app/admin/settings/actions';

export function SystemPromptsManager() {
    const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
    const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Edit state
    const [content, setContent] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        loadPrompts();
    }, []);

    useEffect(() => {
        if (selectedPromptId) {
            const prompt = prompts.find(p => p.id === selectedPromptId);
            if (prompt) {
                setContent(prompt.content);
                setMessage(null);
            }
        }
    }, [selectedPromptId, prompts]);

    const loadPrompts = async () => {
        setLoading(true);
        const res = await getSystemPromptsAction();
        if (res.success && res.prompts) {
            setPrompts(res.prompts);
            if (res.prompts.length > 0 && !selectedPromptId) {
                setSelectedPromptId(res.prompts[0].id);
            }
        }
        setLoading(false);
    };

    const handleSave = async () => {
        if (!selectedPromptId) return;

        setSaving(true);
        setMessage(null);

        const updateDTO: UpdateSystemPromptDTO = {
            id: selectedPromptId,
            content: content
        };

        const res = await updateSystemPromptAction(updateDTO);

        if (res.success && res.prompt) {
            // Update local state
            setPrompts(prev => prev.map(p => p.id === selectedPromptId ? res.prompt! : p));
            setMessage({ type: 'success', text: 'Prompt actualizado correctamente.' });
            
            // Clear message after 3 seconds
            setTimeout(() => setMessage(null), 3000);
        } else {
            setMessage({ type: 'error', text: res.error || 'Error al guardar.' });
        }
        setSaving(false);
    };

    const selectedPrompt = prompts.find(p => p.id === selectedPromptId);

    if (loading) {
        return <div className="p-8 text-center text-gray-500">Cargando prompts...</div>;
    }

    if (prompts.length === 0) {
        return (
             <div className="p-8 text-center border mr-6 rounded-xl border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
                <AlertTriangle className="mx-auto h-8 w-8 text-yellow-500 mb-2" />
                <p className="text-gray-500 dark:text-gray-400">No hay prompts de sistema configurados en la base de datos.</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden flex flex-col md:flex-row min-h-[500px] shadow-sm">
            {/* Sidebar List */}
            <div className="w-full md:w-64 border-r border-gray-200 dark:border-[#6C757D]/10 bg-gray-50 dark:bg-[#0F1419]/50 flex flex-col">
                <div className="p-4 border-b border-gray-200 dark:border-[#6C757D]/10">
                    <h3 className="text-sm font-bold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">Prompts Disponibles</h3>
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-1">
                    {prompts.map(prompt => (
                        <button
                            key={prompt.id}
                            onClick={() => setSelectedPromptId(prompt.id)}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                selectedPromptId === prompt.id 
                                    ? 'bg-[#00D4B3]/10 text-[#00D4B3] shadow-sm' 
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200'
                            }`}
                        >
                            <div className="truncate">{prompt.code}</div>
                            <div className="text-xs opacity-60 truncate font-normal mt-0.5">{prompt.description || 'Sin descripción'}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 flex flex-col bg-white dark:bg-[#151A21]">
                {selectedPrompt ? (
                    <>
                        <div className="p-4 border-b border-gray-200 dark:border-[#6C757D]/10 flex justify-between items-center bg-white dark:bg-[#0F1419]/30">
                           <div>
                                <h3 className="text-gray-900 dark:text-white font-semibold flex items-center gap-2">
                                    <MessageSquareCode size={18} className="text-[#00D4B3]" />
                                    {selectedPrompt.code} v{selectedPrompt.version}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-[#94A3B8] mt-0.5">{selectedPrompt.description}</p>
                           </div>
                           <div className="flex items-center gap-3">
                                {/* Status Message */}
                                {message && (
                                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium animate-in fade-in slide-in-from-right-2 ${
                                        message.type === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                    }`}>
                                        {message.type === 'success' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                                        {message.text}
                                    </div>
                                )}
                                
                                <button 
                                    onClick={handleSave}
                                    disabled={saving}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                        saving 
                                            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                            : 'bg-[#00D4B3] text-white dark:text-black hover:bg-[#00D4B3]/90 shadow-lg shadow-[#00D4B3]/10'
                                    }`}
                                >
                                    {saving ? (
                                        <><span>Guardando...</span></>
                                    ) : (
                                        <><Save size={16} /><span>Guardar</span></>
                                    )}
                                </button>
                           </div>
                        </div>

                        <div className="flex-1 p-0 relative">
                             <textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                className="w-full h-full bg-white dark:bg-[#0F1419] text-gray-900 dark:text-gray-300 font-mono text-sm p-6 resize-none focus:outline-none focus:ring-1 focus:ring-[#00D4B3]/30 leading-relaxed"
                                spellCheck={false}
                                placeholder="Escribe aquí el contenido del prompt..."
                            />
                        </div>
                        <div className="px-4 py-2 bg-gray-50 dark:bg-[#0F1419] border-t border-gray-200 dark:border-[#6C757D]/10 text-xs text-gray-500 dark:text-[#94A3B8] flex justify-between">
                            <span>Markdown soportado</span>
                            <span>Última actualización: {new Date(selectedPrompt.updated_at).toLocaleDateString()}</span>
                        </div>
                    </>
                ) : (
                     <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                        <MessageSquareCode size={48} className="mb-4 opacity-20" />
                        <p>Selecciona un prompt para editar</p>
                    </div>
                )}
            </div>
        </div>
    );
}
