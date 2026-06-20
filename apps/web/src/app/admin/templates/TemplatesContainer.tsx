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
  AlertTriangle,
  PlayCircle,
  Pencil,
  History,
  Check,
  Ban,
  Calendar,
  User,
  ShieldCheck,
  FileText
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  createTemplateAction, 
  updateTemplateAction,
  acquireTemplateAction, 
  deleteTemplateAction,
  getTemplatesAction,
  getPublicTemplatesAction,
  getTemplateVersionsAction,
  approveTemplateVersionAction,
  approveTemplateVersionForSandboxAction,
  rejectTemplateVersionAction,
  createTemplateVersionAction,
  createTemplateBundleUploadPathAction,
  type RemotionTemplate,
  type RemotionTemplateVersion
} from "@/domains/production/actions/templates.actions";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import {
  DEFAULT_TEMPLATE_RENDER_CONFIG,
  createTemplateConfigSchemaDefinition,
  parseTemplateRenderConfig,
  type TemplateRenderConfig,
} from "@/remotion/template-config";

interface TemplatesContainerProps {
  initialTemplates: RemotionTemplate[];
  initialPublicTemplates: RemotionTemplate[];
  initialUserRole?: string | null;
}

export default function TemplatesContainer({
  initialTemplates,
  initialPublicTemplates,
  initialUserRole = null,
}: TemplatesContainerProps) {
  const [activeTab, setActiveTab] = useState<"mine" | "public">("mine");
  const [templates, setTemplates] = useState<RemotionTemplate[]>(initialTemplates);
  const [publicTemplates, setPublicTemplates] = useState<RemotionTemplate[]>(initialPublicTemplates);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RemotionTemplate | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryPoint, setEntryPoint] = useState("src/index.tsx");
  const [compositionId, setCompositionId] = useState("full-slides");
  const [isPublic, setIsPublic] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState("🎨");
  const [templateConfig, setTemplateConfig] = useState<TemplateRenderConfig>(DEFAULT_TEMPLATE_RENDER_CONFIG);
  
  // File upload state
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const [userRole] = useState<string | null>(initialUserRole);

  // Versions state
  const [selectedVersionTemplate, setSelectedVersionTemplate] = useState<RemotionTemplate | null>(null);
  const [versions, setVersions] = useState<RemotionTemplateVersion[]>([]);
  const [isVersionsModalOpen, setIsVersionsModalOpen] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectingVersionId, setRejectingVersionId] = useState<string | null>(null);
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [isUploadingNewVersion, setIsUploadingNewVersion] = useState(false);
  const [uploadingNewVersionProgress, setUploadingNewVersionProgress] = useState(0);
  const [uploadingNewVersionError, setUploadingNewVersionError] = useState("");

  const handleViewVersions = async (template: RemotionTemplate) => {
    setSelectedVersionTemplate(template);
    setIsVersionsModalOpen(true);
    setLoadingVersions(true);
    try {
      const res = await getTemplateVersionsAction(template.id);
      if (res.success && res.versions) {
        setVersions(res.versions);
      } else {
        alert("Error al cargar versiones: " + res.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  };

  const refreshVersions = async (templateId: string) => {
    setLoadingVersions(true);
    try {
      const res = await getTemplateVersionsAction(templateId);
      if (res.success && res.versions) {
        setVersions(res.versions);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleApproveVersion = async (versionId: string) => {
    if (!confirm("¿Estás seguro de que deseas aprobar esta versión como artefacto auditable? El ZIP no se ejecutará hasta habilitar una aprobación de sandbox separada.")) return;
    setLoadingVersions(true);
    try {
      const res = await approveTemplateVersionAction(versionId);
      if (res.success) {
        alert("Versión aprobada como artefacto auditable.");
        if (selectedVersionTemplate) {
          await refreshVersions(selectedVersionTemplate.id);
          await handleRefresh();
        }
      } else {
        alert("Error al aprobar versión: " + res.error);
      }
    } catch (err: any) {
      alert(err.message || "Error");
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleRejectVersion = async (versionId: string) => {
    if (!rejectionReason.trim()) {
      alert("Por favor, especifica un motivo de rechazo.");
      return;
    }
    setLoadingVersions(true);
    try {
      const res = await rejectTemplateVersionAction(versionId, rejectionReason);
      if (res.success) {
        alert("Versión rechazada.");
        setRejectingVersionId(null);
        setRejectionReason("");
        if (selectedVersionTemplate) {
          await refreshVersions(selectedVersionTemplate.id);
          await handleRefresh();
        }
      } else {
        alert("Error al rechazar versión: " + res.error);
      }
    } catch (err: any) {
      alert(err.message || "Error");
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleEnableSandboxVersion = async (versionId: string) => {
    if (!confirm("¿Habilitar esta versión para ejecución en sandbox? Solo tendrá efecto si el runner externo está configurado y EXTERNAL_TEMPLATE_SANDBOX_ENABLED está activo.")) return;
    setLoadingVersions(true);
    try {
      const res = await approveTemplateVersionForSandboxAction(versionId);
      if (res.success) {
        alert("Versión habilitada para sandbox.");
        if (selectedVersionTemplate) {
          await refreshVersions(selectedVersionTemplate.id);
          await handleRefresh();
        }
      } else {
        alert("Error al habilitar sandbox: " + res.error);
      }
    } catch (err: any) {
      alert(err.message || "Error");
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleUploadNewVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVersionFile || !selectedVersionTemplate) return;

    setIsUploadingNewVersion(true);
    setUploadingNewVersionProgress(20);
    setUploadingNewVersionError("");

    try {
      const uploadPath = await createTemplateBundleUploadPathAction({
        templateId: selectedVersionTemplate.id,
        fileName: newVersionFile.name,
      });

      if (!uploadPath.success || !uploadPath.bucket || !uploadPath.path) {
        throw new Error(uploadPath.error || "No se pudo preparar la ruta segura del bundle");
      }
      
      const uploadResult = await uploadWithSignedUrl(
        uploadPath.bucket,
        uploadPath.path,
        newVersionFile,
        {
          purpose: "template-bundle",
          contentType: newVersionFile.type,
          fileSizeBytes: newVersionFile.size,
          upsert: false,
        },
      );
      
      setUploadingNewVersionProgress(60);
      
      const res = await createTemplateVersionAction(
        selectedVersionTemplate.id,
        `${uploadPath.bucket}/${uploadResult.path}`,
        newVersionFile.name
      );

      setUploadingNewVersionProgress(100);

      if (res.success) {
        setNewVersionFile(null);
        await refreshVersions(selectedVersionTemplate.id);
        await handleRefresh();
      } else {
        setUploadingNewVersionError(res.error || "Error al subir versión");
      }
    } catch (err: any) {
      console.error(err);
      setUploadingNewVersionError(err.message || "Error al subir versión");
    } finally {
      setIsUploadingNewVersion(false);
      setUploadingNewVersionProgress(0);
    }
  };

  const emojis = ["🎨", "📊", "👤", "🎬", "📚", "🎮", "🌟", "💻"];
  const isEditing = Boolean(editingTemplate);

  const compositionOptions = [
    {
      id: "full-slides",
      label: "Slides completas",
      description: "El visual principal ocupa toda la pantalla; el avatar aparece como apoyo si existe.",
    },
    {
      id: "split-avatar",
      label: "Slides + avatar",
      description: "Divide la pantalla entre el material visual y el avatar.",
    },
    {
      id: "avatar-focus",
      label: "Avatar protagonista",
      description: "Prioriza el avatar y usa slides o B-roll como contexto visual.",
    },
  ];

  const resetTemplateForm = () => {
    setName("");
    setDescription("");
    setEntryPoint("src/index.tsx");
    setCompositionId("full-slides");
    setIsPublic(false);
    setSelectedEmoji("🎨");
    setTemplateConfig(DEFAULT_TEMPLATE_RENDER_CONFIG);
    setTemplateFile(null);
    setUploadError("");
    setUploadProgress(0);
    setEditingTemplate(null);
  };

  const openCreateModal = () => {
    resetTemplateForm();
    setIsModalOpen(true);
  };

  const openEditModal = (template: RemotionTemplate) => {
    setEditingTemplate(template);
    setName(template.name);
    setDescription(template.description || "");
    setEntryPoint(template.entry_point || "src/index.tsx");
    setCompositionId(template.render_composition_id || template.composition_id || "full-slides");
    setIsPublic(template.is_public);
    setSelectedEmoji(template.thumbnail_url || "🎨");
    setTemplateConfig(parseTemplateRenderConfig(template.default_config));
    setTemplateFile(null);
    setUploadError("");
    setUploadProgress(0);
    setIsModalOpen(true);
  };

  const updateTemplateConfigField = <K extends keyof TemplateRenderConfig>(
    key: K,
    value: TemplateRenderConfig[K],
  ) => {
    setTemplateConfig((current) => parseTemplateRenderConfig({ ...current, [key]: value }));
  };

  const getTemplateSaveErrorMessage = (error?: string) => {
    if (!error) return "Error al registrar la plantilla";
    if (error === "Unauthorized" || error === "No autorizado") {
      return "Tu sesion expiro o no esta disponible. Recarga la pagina e inicia sesion de nuevo si el problema continua.";
    }
    return error;
  };

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

  const handleSaveTemplate = async (e: React.FormEvent) => {
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
        const uploadPath = await createTemplateBundleUploadPathAction({
          fileName: templateFile.name,
        });

        if (!uploadPath.success || !uploadPath.bucket || !uploadPath.path) {
          throw new Error(uploadPath.error || "No se pudo preparar la ruta segura del bundle");
        }
        
        const uploadResult = await uploadWithSignedUrl(
          uploadPath.bucket,
          uploadPath.path,
          templateFile,
          {
            purpose: "template-bundle",
            contentType: templateFile.type,
            fileSizeBytes: templateFile.size,
            upsert: false,
          },
        );
        
        setUploadProgress(70);
        storagePath = `${uploadPath.bucket}/${uploadResult.path}`;
      }

      setUploadProgress(90);

      const templatePayload = {
        name,
        description,
        entryPoint,
        compositionId,
        isPublic,
        defaultConfig: templateConfig,
        configSchema: createTemplateConfigSchemaDefinition(),
        storagePath: storagePath || editingTemplate?.storage_path || undefined,
        originalFileName: templateFile ? templateFile.name : undefined,
        thumbnailUrl: selectedEmoji,
      };

      const result = editingTemplate
        ? await updateTemplateAction(editingTemplate.id, templatePayload)
        : await createTemplateAction(templatePayload);

      setUploadProgress(100);

      if (result.success) {
        setIsModalOpen(false);
        resetTemplateForm();
        await handleRefresh();
      } else {
        setUploadError(getTemplateSaveErrorMessage(result.error));
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
  const selectedComposition = compositionOptions.find((option) => option.id === compositionId);

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
          onClick={openCreateModal}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#00D4B3] to-[#009688] hover:from-[#00E5C1] hover:to-[#00A896] text-white font-semibold rounded-xl shadow-lg shadow-[#00D4B3]/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus size={20} />
          Crear Plantilla
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
                  onEdit={() => openEditModal(tpl)}
                  onAcquire={() => {}}
                  onViewVersions={() => handleViewVersions(tpl)}
                />
              ))
            ) : (
              filteredPublic.map((tpl) => (
                <TemplateCard 
                  key={tpl.id}
                  tpl={tpl}
                  isMine={false}
                  onDelete={() => {}}
                  onEdit={() => {}}
                  onAcquire={() => handleAcquire(tpl.id)}
                  onViewVersions={() => {}}
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
              className="fixed inset-x-3 top-3 bottom-3 z-50 mx-auto flex w-auto max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#6C757D]/25 dark:bg-[#151A21] sm:inset-x-6 sm:top-6 sm:bottom-6"
            >
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 bg-gray-50/50 p-5 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/50 sm:p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <CloudUpload className="text-[#00D4B3]" size={20} />
                  {isEditing ? "Editar Plantilla de Remotion" : "Crear Plantilla de Remotion"}
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

              <form onSubmit={handleSaveTemplate} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
                  <div className="flex items-start gap-3 rounded-xl border border-[#00D4B3]/20 bg-[#00D4B3]/10 p-4 text-sm text-gray-700 dark:text-slate-200">
                    <PlayCircle size={18} className="mt-0.5 shrink-0 text-[#00D4B3]" />
                    <div className="space-y-1">
                      <p className="font-semibold text-gray-900 dark:text-white">Como funciona hoy</p>
                      <p className="text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                        Configura un preset dinamico seguro sobre composiciones internas. Si adjuntas un ZIP, quedara guardado como referencia/versionado y no se ejecutara hasta la fase de bundles externos aprobados.
                      </p>
                    </div>
                  </div>

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
                    Composicion interna para render
                  </label>
                  <select
                    value={compositionId}
                    onChange={(event) => setCompositionId(event.target.value)}
                    disabled={isUploading}
                    className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-[#00D4B3]/50 transition-colors"
                  >
                    {compositionOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label} ({option.id})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    {selectedComposition?.description || "Esta es la plantilla que Remotion ejecuta hoy al ensamblar."}
                  </p>
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

                <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/40">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Configuracion visual dinamica
                    </p>
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      Estos valores se aplican tanto en la previsualizacion como en el render final.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Acento
                      <input type="color" value={templateConfig.accentColor} onChange={(event) => updateTemplateConfigField("accentColor", event.target.value)} disabled={isUploading} className="h-10 w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-[#6C757D]/20 dark:bg-[#151A21]" />
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Fondo
                      <input type="color" value={templateConfig.backgroundColor} onChange={(event) => updateTemplateConfigField("backgroundColor", event.target.value)} disabled={isUploading} className="h-10 w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-[#6C757D]/20 dark:bg-[#151A21]" />
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Superficie
                      <input type="color" value={templateConfig.surfaceColor} onChange={(event) => updateTemplateConfigField("surfaceColor", event.target.value)} disabled={isUploading} className="h-10 w-full rounded-lg border border-gray-200 bg-white p-1 dark:border-[#6C757D]/20 dark:bg-[#151A21]" />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Transicion
                      <select value={templateConfig.transitionType} onChange={(event) => updateTemplateConfigField("transitionType", event.target.value as TemplateRenderConfig["transitionType"])} disabled={isUploading} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-[#6C757D]/20 dark:bg-[#151A21] dark:text-white">
                        <option value="fade">Fade</option>
                        <option value="slide">Slide</option>
                        <option value="none">Sin transicion</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Posicion avatar
                      <select value={templateConfig.avatarPosition} onChange={(event) => updateTemplateConfigField("avatarPosition", event.target.value as TemplateRenderConfig["avatarPosition"])} disabled={isUploading} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-[#6C757D]/20 dark:bg-[#151A21] dark:text-white">
                        <option value="bottom-right">Abajo derecha</option>
                        <option value="bottom-left">Abajo izquierda</option>
                        <option value="top-right">Arriba derecha</option>
                        <option value="top-left">Arriba izquierda</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Fondo sin assets
                      <select value={templateConfig.backgroundStyle} onChange={(event) => updateTemplateConfigField("backgroundStyle", event.target.value as TemplateRenderConfig["backgroundStyle"])} disabled={isUploading} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-[#6C757D]/20 dark:bg-[#151A21] dark:text-white">
                        <option value="gradient">Gradiente</option>
                        <option value="solid">Solido</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Tamano avatar ({Math.round(templateConfig.avatarScale * 100)}%)
                      <input type="range" min="0.16" max="0.36" step="0.01" value={templateConfig.avatarScale} onChange={(event) => updateTemplateConfigField("avatarScale", Number(event.target.value))} disabled={isUploading} className="w-full accent-[#00D4B3]" />
                    </label>
                    <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">
                      Apoyo visual ({Math.round(templateConfig.supportStripHeight * 100)}%)
                      <input type="range" min="0.16" max="0.34" step="0.01" value={templateConfig.supportStripHeight} onChange={(event) => updateTemplateConfigField("supportStripHeight", Number(event.target.value))} disabled={isUploading} className="w-full accent-[#00D4B3]" />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

                {true && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                    Código de la Plantilla (.zip)
                  </label>
                  <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      ZIP opcional como referencia avanzada. No se ejecuta codigo externo en esta fase; el render usa la composicion interna seleccionada.
                    </span>
                  </div>
                  <div className="flex items-center justify-center w-full">
                    <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 dark:border-[#6C757D]/25 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-all ${templateFile ? "bg-green-500/5 border-green-500/30" : "bg-transparent"}`}>
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {templateFile ? (
                          <>
                            <FileCode className="w-8 h-8 text-green-500 mb-2" />
                            <p className="text-xs text-green-600 dark:text-green-400 font-semibold">{templateFile?.name}</p>
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
                )}

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
                </div>

                {/* Footer Buttons */}
                <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-100 bg-white p-4 dark:border-[#6C757D]/10 dark:bg-[#151A21] sm:flex-row sm:justify-end sm:px-6">
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
                    className="flex items-center justify-center gap-1.5 px-5 py-2 bg-[#00D4B3] hover:bg-[#00E5C1] disabled:bg-[#00D4B3]/40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="animate-spin" size={14} />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        {isEditing ? "Guardar Cambios" : "Crear Plantilla"}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Versions Modal */}
      <AnimatePresence>
        {isVersionsModalOpen && selectedVersionTemplate && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50" 
              onClick={() => !isUploadingNewVersion && setIsVersionsModalOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="fixed inset-x-3 top-3 bottom-3 z-50 mx-auto flex w-auto max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#6C757D]/25 dark:bg-[#151A21] sm:inset-x-6 sm:top-6 sm:bottom-6"
            >
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-100 bg-gray-50/50 p-5 dark:border-[#6C757D]/10 dark:bg-[#0F1419]/50 sm:p-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <History className="text-[#00D4B3]" size={20} />
                    Versiones de {selectedVersionTemplate.name}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-[#94A3B8] mt-1">
                    Sube y administra los bundles ZIP de Remotion. Los revisores autorizados pueden auditar y aprobar versiones.
                  </p>
                </div>
                <button 
                  type="button" 
                  disabled={isUploadingNewVersion}
                  onClick={() => setIsVersionsModalOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Content */}
              <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
                
                {/* Upload New Version Form */}
                <form onSubmit={handleUploadNewVersion} className="bg-gray-50 dark:bg-[#0F1419]/40 border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-4 space-y-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <CloudUpload size={16} className="text-[#00D4B3]" />
                    Subir nueva versión (.zip)
                  </h4>
                  <div className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                      <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 dark:border-[#6C757D]/25 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-white/5 transition-all ${newVersionFile ? "bg-green-500/5 border-green-500/30" : "bg-transparent"}`}>
                        <div className="flex flex-col items-center justify-center pt-4 pb-4">
                          {newVersionFile ? (
                            <>
                              <FileCode className="w-6 h-6 text-green-500 mb-1" />
                              <p className="text-xs text-green-600 dark:text-green-400 font-semibold truncate max-w-xs">{newVersionFile.name}</p>
                              <p className="text-[10px] text-gray-500">{(newVersionFile.size / (1024 * 1024)).toFixed(2)} MB - Clic para cambiar</p>
                            </>
                          ) : (
                            <>
                              <CloudUpload className="w-6 h-6 text-gray-400 mb-1" />
                              <p className="text-xs text-gray-500"><span className="font-semibold">Seleccionar ZIP</span> o arrastra aquí</p>
                            </>
                          )}
                        </div>
                        <input 
                          type="file" 
                          accept=".zip" 
                          className="hidden" 
                          disabled={isUploadingNewVersion}
                          onChange={(e) => {
                            setNewVersionFile(e.target.files?.[0] || null);
                            setUploadingNewVersionError("");
                          }}
                        />
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={!newVersionFile || isUploadingNewVersion}
                      className="w-full sm:w-auto h-12 flex items-center justify-center gap-2 px-6 bg-gradient-to-r from-[#00D4B3] to-[#009688] hover:from-[#00E5C1] hover:to-[#00A896] disabled:from-gray-100 disabled:to-gray-150 dark:disabled:from-gray-800 dark:disabled:to-gray-850 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all"
                    >
                      {isUploadingNewVersion ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          {uploadingNewVersionProgress}%
                        </>
                      ) : (
                        "Subir Versión"
                      )}
                    </button>
                  </div>

                  {uploadingNewVersionError && (
                    <div className="p-3 text-xs bg-red-500/10 border border-red-500/25 text-red-500 rounded-lg">
                      {uploadingNewVersionError}
                    </div>
                  )}
                </form>

                {/* Versions List */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <History size={16} className="text-gray-500" />
                    Historial de Versiones
                  </h4>

                  {loadingVersions ? (
                    <div className="flex flex-col items-center justify-center py-10">
                      <Loader2 className="animate-spin text-[#00D4B3] mb-2" size={24} />
                      <p className="text-xs text-gray-500">Cargando historial...</p>
                    </div>
                  ) : versions.length === 0 ? (
                    <div className="text-center py-10 border border-dashed border-gray-200 dark:border-[#6C757D]/10 rounded-2xl">
                      <p className="text-sm text-gray-500">No hay versiones registradas aún para esta plantilla.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {versions.map((version) => {
                        const report = version.validation_report || {};
                        const hasErrors = Array.isArray(report.errors) && report.errors.length > 0;
                        const hasWarnings = Array.isArray(report.warnings) && report.warnings.length > 0;
                        const fileCount = report.info?.fileCount || 0;
                        const unzippedSize = report.info?.unzippedSize || 0;
                        const dependencies = report.info?.dependencies || {};
                        const dependencyKeys = Object.keys(dependencies);

                        const canReview = userRole !== null && ["ADMIN", "ARQUITECTO", "SUPERADMIN"].includes(userRole);
                        const isActive = selectedVersionTemplate.storage_path === version.storage_path;

                        return (
                          <div 
                            key={version.id} 
                            className={`flex flex-col gap-4 p-5 rounded-2xl border transition-all duration-200 ${
                              isActive
                                ? "bg-[#00D4B3]/5 dark:bg-[#00D4B3]/3 border-[#00D4B3]/30 shadow-md shadow-[#00D4B3]/2"
                                : version.status === "APPROVED" 
                                  ? "bg-green-500/5 dark:bg-green-500/3 border-green-500/10" 
                                  : version.status === "REJECTED"
                                    ? "bg-red-500/5 dark:bg-red-500/3 border-red-500/10"
                                    : "bg-white dark:bg-[#1A202C]/40 border-gray-150 dark:border-[#6C757D]/10"
                            }`}
                          >
                            {/* Version Header */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-gray-900 dark:text-white text-base">
                                    Versión {version.version_number}
                                  </span>
                                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${
                                    version.status === "APPROVED"
                                      ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400 border-green-200 dark:border-green-500/20"
                                      : version.status === "REJECTED"
                                        ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 border-red-200 dark:border-red-500/20"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20"
                                  }`}>
                                    {version.status === "APPROVED" ? "Aprobada" : version.status === "REJECTED" ? "Rechazada" : "Pendiente"}
                                  </span>
                                  {isActive && (
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-[#00D4B3]/15 text-[#00D4B3] border border-[#00D4B3]/35 flex items-center gap-1 animate-pulse">
                                      <CheckCircle2 size={10} />
                                      Activa
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-gray-400 font-mono truncate max-w-sm sm:max-w-md md:max-w-lg" title={version.bundle_hash || ""}>
                                  SHA-256: {version.bundle_hash || "No disponible"}
                                </p>
                              </div>

                              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-[#94A3B8]">
                                <span className="flex items-center gap-1.5">
                                  <Calendar size={13} />
                                  {new Date(version.created_at).toLocaleDateString()}
                                </span>
                                <span className="flex items-center gap-1.5" title={version.created_by_profile?.email || ""}>
                                  <User size={13} />
                                  {version.created_by_profile?.first_name || version.created_by_profile?.username || version.created_by_profile?.email || "Sistema"}
                                </span>
                              </div>
                            </div>

                            {/* Validation / Audit Info */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50/70 dark:bg-[#0F1419]/30 p-4 rounded-xl border border-gray-200/50 dark:border-[#6C757D]/5 text-xs">
                              <div>
                                <h5 className="font-semibold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                                  <FileText size={13} className="text-[#00D4B3]" />
                                  Detalles del Bundle
                                </h5>
                                <ul className="space-y-1 text-gray-600 dark:text-slate-400 font-mono text-[11px]">
                                  <li className="truncate">Nombre: {version.original_file_name || "Desconocido"}</li>
                                  <li>Tamaño: {(unzippedSize / (1024 * 1024)).toFixed(2)} MB (descomprimido)</li>
                                  <li>Archivos: {fileCount}</li>
                                  <li>Punto de entrada: {version.entry_point || "No especificado"}</li>
                                </ul>
                              </div>

                              <div>
                                <h5 className="font-semibold text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
                                  <ShieldCheck size={13} className="text-[#00D4B3]" />
                                  Auditoría Estática
                                </h5>
                                <div className="space-y-2">
                                  {hasErrors ? (
                                    <div className="text-red-500 flex items-start gap-1.5">
                                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                      <div className="flex-1 font-mono text-[10px] max-h-24 overflow-y-auto space-y-1">
                                        {report.errors.map((err: string, i: number) => <div key={i} className="leading-tight">• {err}</div>)}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-green-500 flex items-center gap-1.5">
                                      <CheckCircle2 size={14} />
                                      <span>Sin errores de seguridad</span>
                                    </div>
                                  )}

                                  {hasWarnings && (
                                    <div className="text-amber-500 flex items-start gap-1.5 mt-1 border-t border-gray-200/40 dark:border-gray-800/40 pt-1">
                                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                      <div className="flex-1 font-mono text-[10px] max-h-24 overflow-y-auto space-y-1">
                                        {report.warnings.map((warn: string, i: number) => <div key={i} className="leading-tight">• {warn}</div>)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Dependencies & Manifest Expandable Details */}
                              <div className="col-span-1 md:col-span-2 pt-3 border-t border-gray-200/60 dark:border-gray-800/60">
                                <details className="group">
                                  <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-[#00D4B3] dark:hover:text-[#00D4B3] select-none flex items-center gap-1 outline-none">
                                    <span className="transition-transform duration-200 group-open:rotate-90 text-[9px]">▶</span>
                                    Ver Manifiesto y Dependencias
                                  </summary>
                                  <div className="mt-3 pl-3 border-l-2 border-gray-200 dark:border-gray-800 space-y-3">
                                    {version.manifest ? (
                                      <div>
                                        <p className="font-semibold text-gray-700 dark:text-slate-300 text-[10px] mb-1">Manifiesto (courseforge-remotion-template.json):</p>
                                        <pre className="p-2 bg-gray-100 dark:bg-[#0F1419] rounded-lg text-[10px] text-gray-600 dark:text-slate-400 overflow-x-auto max-w-full font-mono">
                                          {JSON.stringify(version.manifest, null, 2)}
                                        </pre>
                                      </div>
                                    ) : (
                                      <p className="text-gray-400 italic text-[10px]">Manifiesto no disponible.</p>
                                    )}

                                    <div>
                                      <p className="font-semibold text-gray-700 dark:text-slate-300 text-[10px] mb-1">
                                        Dependencias detectadas ({dependencyKeys.length}):
                                      </p>
                                      {dependencyKeys.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2 bg-gray-100 dark:bg-[#0F1419] rounded-lg text-[10px] font-mono text-gray-600 dark:text-slate-400">
                                          {dependencyKeys.map((dep) => (
                                            <div key={dep} className="truncate" title={`${dep}: ${dependencies[dep]}`}>
                                              <span className="text-gray-400">#</span> {dep} <span className="text-[#00D4B3]">{dependencies[dep]}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-gray-400 italic text-[10px]">Ninguna dependencia declarada en package.json.</p>
                                      )}
                                    </div>
                                  </div>
                                </details>
                              </div>
                            </div>

                            {/* Rejection Details */}
                            {version.status === "REJECTED" && (
                              <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-700 dark:text-red-400 space-y-1 animate-in fade-in duration-200">
                                <p className="font-bold flex items-center gap-1.5">
                                  <Ban size={14} />
                                  Rechazada por {version.rejected_by_profile?.first_name || version.rejected_by_profile?.username || version.rejected_by_profile?.email || "Revisor"}
                                </p>
                                {version.rejection_reason && (
                                  <p className="italic pl-5 leading-normal">Motivo: "{version.rejection_reason}"</p>
                                )}
                              </div>
                            )}

                            {/* Approval Details */}
                            {version.status === "APPROVED" && (
                              <div className="space-y-2">
                                <div className="p-3.5 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5 animate-in fade-in duration-200">
                                  <Check size={14} className="shrink-0" />
                                  <span className="font-medium">
                                    Aprobada para auditoria por {version.approved_by_profile?.first_name || version.approved_by_profile?.username || version.approved_by_profile?.email || "Revisor"}
                                  </span>
                                </div>
                                {canReview && (
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => handleEnableSandboxVersion(version.id)}
                                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-purple-500/30 text-purple-600 hover:bg-purple-500/10 rounded-lg transition-all"
                                      title="Habilita esta version para que el worker pueda intentar el runner sandbox externo cuando el feature flag este activo"
                                    >
                                      <ShieldCheck size={13} />
                                      Habilitar sandbox
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {version.status === "APPROVED_FOR_SANDBOX" && (
                              <div className="p-3.5 bg-purple-500/10 border border-purple-500/20 rounded-xl text-xs text-purple-700 dark:text-purple-300 flex items-center gap-1.5 animate-in fade-in duration-200">
                                <ShieldCheck size={14} className="shrink-0" />
                                <span className="font-medium">
                                  Habilitada para sandbox externo. El render solo usara esta ruta si el feature flag esta activo.
                                </span>
                              </div>
                            )}

                            {/* Review Action Controls */}
                            {version.status === "PENDING_REVIEW" && (
                              <div className="flex flex-col gap-3 pt-2 border-t border-gray-100 dark:border-gray-800/40">
                                {canReview ? (
                                  <>
                                    {rejectingVersionId === version.id ? (
                                      <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                                        <label className="block text-[11px] font-semibold text-red-500 uppercase tracking-wider">
                                          Motivo de rechazo *
                                        </label>
                                        <textarea
                                          value={rejectionReason}
                                          onChange={(e) => setRejectionReason(e.target.value)}
                                          placeholder="Especifica detalladamente la razón del rechazo para informar al equipo de desarrollo..."
                                          className="w-full text-xs p-3 bg-gray-50 dark:bg-[#0F1419] border border-red-500/30 rounded-xl focus:outline-none focus:border-red-500/60 dark:text-white resize-none h-20"
                                        />
                                        <div className="flex justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setRejectingVersionId(null);
                                              setRejectionReason("");
                                            }}
                                            className="px-4 py-2 text-xs border border-gray-200 dark:border-[#6C757D]/25 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-all font-semibold"
                                          >
                                            Cancelar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleRejectVersion(version.id)}
                                            className="px-4 py-2 text-xs bg-red-600 hover:bg-red-500 text-white font-semibold rounded-lg transition-all"
                                          >
                                            Confirmar Rechazo
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() => setRejectingVersionId(version.id)}
                                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-red-500/30 text-red-600 hover:bg-red-500/10 rounded-lg transition-all"
                                        >
                                          <Ban size={13} />
                                          Rechazar
                                        </button>
                                        <button
                                          type="button"
                                          disabled={hasErrors}
                                          onClick={() => handleApproveVersion(version.id)}
                                          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#00D4B3] hover:bg-[#00E5C1] disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed text-white rounded-lg transition-all"
                                          title={hasErrors ? "No se puede aprobar una versión con errores de validación" : "Aprobar versión como artefacto auditable; no habilita ejecución externa"}
                                        >
                                          <Check size={13} />
                                          Aprobar revisión
                                        </button>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-[11px] text-gray-400 italic bg-gray-50/55 dark:bg-[#0F1419]/20 p-2 rounded-lg text-center">
                                    Esperando revisión por un administrador o arquitecto.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex shrink-0 justify-end border-t border-gray-100 bg-white p-4 dark:border-[#6C757D]/10 dark:bg-[#151A21] sm:px-6">
                <button
                  type="button"
                  onClick={() => setIsVersionsModalOpen(false)}
                  className="px-5 py-2.5 border border-gray-200 dark:border-[#6C757D]/20 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-semibold text-sm text-gray-600 dark:text-slate-300 transition-colors"
                >
                  Cerrar
                </button>
              </div>
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
  onEdit,
  onAcquire,
  onViewVersions 
}: { 
  tpl: RemotionTemplate; 
  isMine: boolean; 
  onDelete: () => void; 
  onEdit: () => void;
  onAcquire: () => void;
  onViewVersions: () => void;
}) {
  const isGlobal = tpl.organization_id === null;
  const isExternalPending = tpl.render_mode === "EXTERNAL_BUNDLE_PENDING";
  const hasExternalReference = tpl.render_mode === "INTERNAL_WITH_EXTERNAL_REFERENCE";
  const isSandboxReady = tpl.render_mode === "EXTERNAL_SANDBOX_READY";

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
            <span
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                isSandboxReady
                  ? "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300"
                  : isExternalPending
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : hasExternalReference
                    ? "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    : "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300"
              }`}
              title={tpl.render_status_label}
            >
              {isExternalPending ? <AlertTriangle size={10} /> : <PlayCircle size={10} />}
              {isSandboxReady ? "Sandbox habilitado" : tpl.storage_path ? "ZIP referencia" : "Renderizable ahora"}
            </span>
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

        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
          isSandboxReady
            ? "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300"
            : isExternalPending
            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-gray-100 bg-gray-50 text-gray-500 dark:border-[#6C757D]/5 dark:bg-[#0F1419]/50 dark:text-gray-400"
        }`}>
          {isExternalPending ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <PlayCircle size={13} className="mt-0.5 shrink-0" />}
          <span>{tpl.render_status_label}</span>
        </div>
      </div>

      {/* Card Actions */}
      <div className="px-6 py-4 bg-gray-50/50 dark:bg-[#1E2329]/20 border-t border-gray-100 dark:border-[#6C757D]/5 flex justify-end items-center gap-2">
        {isMine ? (
          <>
            {!isGlobal && (
              <button
                onClick={onViewVersions}
                className="p-2 text-gray-400 hover:text-[#00D4B3] hover:bg-[#00D4B3]/10 rounded-lg transition-all"
                title="Administrar versiones y bundles"
              >
                <Layers size={16} />
              </button>
            )}
            {!isGlobal && (
              <button
                onClick={onEdit}
                className="p-2 text-gray-400 hover:text-[#00D4B3] hover:bg-[#00D4B3]/10 rounded-lg transition-all"
                title="Editar plantilla"
              >
                <Pencil size={16} />
              </button>
            )}
            {!isGlobal && (
              <button
                onClick={onDelete}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                title="Eliminar plantilla"
              >
                <Trash2 size={16} />
              </button>
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
