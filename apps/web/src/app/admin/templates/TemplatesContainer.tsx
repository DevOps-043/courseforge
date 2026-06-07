"use client";

import React, { useState } from "react";
import { 
  Plus, 
  Search, 
  Video, 
  Layers, 
  Lock, 
  Globe, 
  Trash2, 
  CloudUpload, 
  CheckCircle2, 
  X, 
  Building2, 
  Loader2,
  FileCode,
  Bookmark
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  createTemplateAction, 
  acquireTemplateAction, 
  deleteTemplateAction,
  getTemplatesAction,
  getPublicTemplatesAction,
  type RemotionTemplate 
} from "@/domains/production/actions/templates.actions";
import { uploadWithSignedUrl } from "@/lib/storage-upload";

interface TemplatesContainerProps {
  initialTemplates: RemotionTemplate[];
  initialPublicTemplates: RemotionTemplate[];
}

export default function TemplatesContainer({ 
  initialTemplates, 
  initialPublicTemplates 
}: TemplatesContainerProps) {
  const [activeTab, setActiveTab] = useState<"mine" | "public">("mine");
  const [templates, setTemplates] = useState<RemotionTemplate[]>(initialTemplates);
  const [publicTemplates, setPublicTemplates] = useState<RemotionTemplate[]>(initialPublicTemplates);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryPoint, setEntryPoint] = useState("src/index.tsx");
  const [isPublic, setIsPublic] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState("🎨");
  
  // File upload state
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const emojis = ["🎨", "📊", "👤", "🎬", "📚", "🎮", "🌟", "💻"];

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const resMine = await getTemplatesAction();
      const resPublic = await getPublicTemplatesAction();
      if (resMine.success && resMine.templates) {
        setTemplates(resMine.templates);
      }
      if (resPublic.success && resPublic.templates) {
        setPublicTemplates(resPublic.templates);
      }
    } catch (err) {
      console.error("Error refreshing templates:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAcquire = async (templateId: string) => {
    setLoading(true);
    try {
      const result = await acquireTemplateAction(templateId);
      if (result.success) {
        alert("Plantilla adquirida con éxito.");
        await handleRefresh();
      } else {
        alert("Error al adquirir la plantilla: " + result.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar o dejar de usar esta plantilla?")) return;
    setLoading(true);
    try {
      const result = await deleteTemplateAction(templateId);
      if (result.success) {
        alert("Operación completada con éxito.");
        await handleRefresh();
      } else {
        alert("Error al realizar la operación: " + result.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsUploading(true);
    setUploadProgress(10);
    setUploadError("");

    try {
      let storagePath = "";
      
      // Simulate file upload progress if zip uploaded
      if (templateFile) {
        setUploadProgress(30);
        // Clean special characters from name
        const cleanName = name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        const path = `templates/${Date.now()}_${cleanName}.zip`;
        
        const uploadResult = await uploadWithSignedUrl(
          "production-assets",
          path,
          templateFile
        );
        
        setUploadProgress(70);
        storagePath = uploadResult.publicUrl;
      }

      setUploadProgress(90);

      const result = await createTemplateAction({
        name,
        description,
        entryPoint,
        isPublic,
        storagePath: storagePath || undefined,
        thumbnailUrl: selectedEmoji,
      });

      setUploadProgress(100);

      if (result.success) {
        setIsModalOpen(false);
        // Reset form
        setName("");
        setDescription("");
        setEntryPoint("src/index.tsx");
        setIsPublic(false);
        setSelectedEmoji("🎨");
        setTemplateFile(null);
        await handleRefresh();
      } else {
        setUploadError(result.error || "Error al registrar la plantilla");
      }
    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || "Error al subir el archivo");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const filteredMine = templates.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPublic = publicTemplates.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
            <Video className="text-[#00D4B3]" size={32} />
            Plantillas de Video (Remotion)
          </h1>
          <p className="text-gray-600 dark:text-[#94A3B8]">
            Gestiona las plantillas de Remotion para tu empresa o explora plantillas públicas de otras empresas.
          </p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#00D4B3] to-[#009688] hover:from-[#00E5C1] hover:to-[#00A896] text-white font-semibold rounded-xl shadow-lg shadow-[#00D4B3]/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={20} />
          Subir Plantilla
        </button>
      </div>

      {/* Tabs and Search */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-4 shadow-sm">
        {/* Navigation tabs */}
        <div className="flex bg-gray-100 dark:bg-[#0F1419] p-1.5 rounded-xl self-start">
          <button
            onClick={() => setActiveTab("mine")}
            className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all ${
              activeTab === "mine"
                ? "bg-white dark:bg-[#1A202C] text-[#00D4B3] shadow-md shadow-[#00D4B3]/5"
                : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Mis Plantillas ({templates.length})
          </button>
          <button
            onClick={() => setActiveTab("public")}
            className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all ${
              activeTab === "public"
                ? "bg-white dark:bg-[#1A202C] text-[#00D4B3] shadow-md shadow-[#00D4B3]/5"
                : "text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            Adquirir de otras empresas ({publicTemplates.length})
          </button>
        </div>

        {/* Search input */}
        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#94A3B8]" size={18} />
          <input 
            type="text" 
            placeholder="Buscar plantilla..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl py-2.5 pl-10 pr-4 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors placeholder-gray-400 dark:placeholder-gray-600"
          />
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="animate-spin text-[#00D4B3] mb-4" size={40} />
          <p className="text-gray-500 dark:text-[#94A3B8] font-medium">Sincronizando plantillas...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="wait">
            {activeTab === "mine" ? (
              filteredMine.map((tpl) => (
                <TemplateCard 
                  key={tpl.id}
                  tpl={tpl}
                  isMine={true}
                  onDelete={() => handleDelete(tpl.id)}
                  onAcquire={() => {}}
                />
              ))
            ) : (
              filteredPublic.map((tpl) => (
                <TemplateCard 
                  key={tpl.id}
                  tpl={tpl}
                  isMine={false}
                  onDelete={() => {}}
                  onAcquire={() => handleAcquire(tpl.id)}
                />
              ))
            )}
          </AnimatePresence>

          {((activeTab === "mine" && filteredMine.length === 0) || 
            (activeTab === "public" && filteredPublic.length === 0)) && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 border-dashed rounded-2xl">
              <Layers className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
              <p className="text-lg font-semibold text-gray-600 dark:text-gray-300">
                No se encontraron plantillas.
              </p>
              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                {activeTab === "mine" 
                  ? "Puedes subir una nueva plantilla para tu organización." 
                  : "No hay plantillas públicas de otras empresas disponibles para adquirir."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50" 
              onClick={() => !isUploading && setIsModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/25 rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="flex justify-between items-center p-6 border-b border-gray-100 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/50">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <CloudUpload className="text-[#00D4B3]" size={20} />
                  Subir Plantilla de Remotion
                </h3>
                <button 
                  type="button" 
                  disabled={isUploading}
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreateTemplate} className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    Nombre de la plantilla *
                  </label>
                  <input 
                    type="text" 
                    required
                    placeholder="Ej. Minimal Blue Slide"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isUploading}
                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    Descripción
                  </label>
                  <textarea 
                    rows={3}
                    placeholder="Describe los colores, fuentes y distribución de la plantilla de video."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isUploading}
                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      Punto de Entrada
                    </label>
                    <input 
                      type="text"
                      required 
                      value={entryPoint}
                      onChange={(e) => setEntryPoint(e.target.value)}
                      disabled={isUploading}
                      className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      Icono Pre-determinado
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {emojis.map(emoji => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setSelectedEmoji(emoji)}
                          disabled={isUploading}
                          className={`py-1.5 rounded-lg border text-sm transition-all ${
                            selectedEmoji === emoji 
                              ? "border-[#00D4B3] bg-[#00D4B3]/10" 
                              : "border-gray-200 dark:border-[#6C757D]/20 bg-transparent hover:bg-gray-50 dark:hover:bg-white/5"
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    Código de la Plantilla (.zip)
                  </label>
                  <div className="flex items-center justify-center w-full">
                    <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 dark:border-[#6C757D]/25 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-all ${templateFile ? "bg-green-500/5 border-green-500/30" : "bg-transparent"}`}>
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {templateFile ? (
                          <>
                            <FileCode className="w-8 h-8 text-green-500 mb-2" />
                            <p className="text-xs text-green-600 dark:text-green-400 font-semibold">{templateFile.name}</p>
                            <p className="text-[10px] text-gray-500">Haz clic para cambiar de archivo</p>
                          </>
                        ) : (
                          <>
                            <CloudUpload className="w-8 h-8 text-gray-400 mb-2" />
                            <p className="text-xs text-gray-500"><span className="font-semibold">Sube el bundle zip</span> o arrastra aquí</p>
                            <p className="text-[10px] text-gray-400">Solo archivos ZIP con código Remotion</p>
                          </>
                        )}
                      </div>
                      <input 
                        type="file" 
                        accept=".zip" 
                        className="hidden" 
                        disabled={isUploading}
                        onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                      />
                    </label>
                  </div>
                </div>

                {/* Share Option */}
                <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-[#0F1419]/50 border border-gray-100 dark:border-[#6C757D]/10 rounded-xl">
                  <div className="flex items-center gap-2">
                    {isPublic ? (
                      <Globe size={18} className="text-[#00D4B3]" />
                    ) : (
                      <Lock size={18} className="text-gray-400" />
                    )}
                    <div>
                      <p className="text-xs font-semibold text-gray-900 dark:text-white">Compartir plantilla</p>
                      <p className="text-[10px] text-gray-500">Permitir que otras empresas adquieran esta plantilla</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={isPublic} 
                      onChange={(e) => setIsPublic(e.target.checked)}
                      disabled={isUploading}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00D4B3]"></div>
                  </label>
                </div>

                {/* Error and Progress display */}
                {uploadError && (
                  <div className="p-3 text-xs bg-red-500/10 border border-red-500/25 text-red-500 rounded-lg">
                    {uploadError}
                  </div>
                )}

                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-semibold text-gray-500">
                      <span>Procesando y subiendo bundle...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-[#00D4B3] h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-[#6C757D]/10">
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-gray-200 dark:border-[#6C757D]/20 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-semibold text-sm text-gray-600 dark:text-slate-300 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUploading}
                    className="flex items-center gap-1.5 px-5 py-2 bg-[#00D4B3] hover:bg-[#00E5C1] disabled:bg-[#00D4B3]/40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="animate-spin" size={14} />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        Crear Plantilla
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function TemplateCard({ 
  tpl, 
  isMine, 
  onDelete, 
  onAcquire 
}: { 
  tpl: RemotionTemplate; 
  isMine: boolean; 
  onDelete: () => void; 
  onAcquire: () => void;
}) {
  const isGlobal = tpl.organization_id === null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 hover:border-[#00D4B3]/50 dark:hover:border-[#00D4B3]/50 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:shadow-[#00D4B3]/5 dark:hover:shadow-[#00D4B3]/3 transition-all duration-300 group flex flex-col justify-between"
    >
      <div className="p-6 space-y-4">
        {/* Card Header Emojis & Badges */}
        <div className="flex justify-between items-start">
          <div className="w-12 h-12 bg-gray-55/10 dark:bg-gray-800/60 rounded-xl flex items-center justify-center text-2xl shadow-inner group-hover:scale-110 transition-transform duration-300">
            {tpl.thumbnail_url || "🎨"}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            {isGlobal ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-[#1F5AF6]/10 text-[#1F5AF6] border border-[#1F5AF6]/20">
                Sistema (Global)
              </span>
            ) : isMine ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-[#00D4B3]/10 text-[#00D4B3] border border-[#00D4B3]/20">
                Mi Empresa
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center gap-1">
                <Building2 size={10} />
                {tpl.organization?.name || "Otra Empresa"}
              </span>
            )}

            {/* Visibility Badge */}
            {!isGlobal && isMine && (
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                {tpl.is_public ? (
                  <>
                    <Globe size={10} className="text-[#00D4B3]" />
                    Pública
                  </>
                ) : (
                  <>
                    <Lock size={10} />
                    Privada
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white mb-1 group-hover:text-[#00D4B3] transition-colors">
            {tpl.name}
          </h4>
          <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed line-clamp-3 min-h-[48px]">
            {tpl.description || "Sin descripción proporcionada."}
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-gray-50 dark:bg-[#0F1419]/50 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-[#6C757D]/5">
          <FileCode size={12} className="text-gray-500" />
          <span className="font-medium text-gray-500 truncate">Entry: {tpl.entry_point}</span>
        </div>
      </div>

      {/* Card Actions */}
      <div className="px-6 py-4 bg-gray-50/50 dark:bg-[#1E2329]/20 border-t border-gray-100 dark:border-[#6C757D]/5 flex justify-end items-center gap-2">
        {isMine ? (
          <>
            {!isGlobal && (
              <button
                onClick={onDelete}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                title="Eliminar plantilla"
              >
                <Trash2 size={16} />
              </button>
            )}
            {isGlobal && (
              <span className="text-[10px] text-gray-400 flex items-center gap-1 py-1 px-2">
                <Bookmark size={12} />
                Disponible
              </span>
            )}
          </>
        ) : (
          <button
            onClick={onAcquire}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg transition-all shadow-md shadow-purple-500/10 hover:scale-[1.02] active:scale-[0.98]"
          >
            Adquirir Plantilla
          </button>
        )}
      </div>
    </motion.div>
  );
}
