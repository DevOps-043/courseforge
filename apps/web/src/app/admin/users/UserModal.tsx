
'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Mail, Shield, Save, Sparkles, Briefcase, Eye, EyeOff, Lock, ChevronDown } from 'lucide-react';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user?: any | null; 
  onSave?: (userData: any) => void;
}

export default function UserModal({ isOpen, onClose, user, onSave }: UserModalProps) {
  const isEdit = !!user;
  
  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastNameFather: '',
    lastNameMother: '',
    email: '',
    role: 'CONSTRUCTOR',
    username: '',
    password: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  
  // Custom Dropdown State
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  // Initialize form
  useEffect(() => {
    if (user) {
      setFormData({
        firstName: user.first_name || '',
        lastNameFather: user.last_name_father || '',
        lastNameMother: user.last_name_mother || '',
        email: user.email || '',
        role: user.platform_role || 'CONSTRUCTOR',
        username: user.username || '',
        password: '' // Don't fill password on edit
      });
    } else {
      setFormData({
        firstName: '',
        lastNameFather: '',
        lastNameMother: '',
        email: '',
        role: 'CONSTRUCTOR',
        username: '',
        password: ''
      });
    }
  }, [user, isOpen]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setIsRoleOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleRoleSelect = (role: string) => {
    setFormData(prev => ({ ...prev, role }));
    setIsRoleOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSave) onSave({ ...formData, id: user?.id });
    onClose();
  };

  // Preview Data
  const previewInitials = (formData.firstName?.[0] || formData.username?.[0] || 'U').toUpperCase();
  const previewName = formData.firstName && formData.lastNameFather
    ? `${formData.firstName} ${formData.lastNameFather}`
    : formData.username || 'Nuevo Usuario';
  
  const roleLabel = {
      'ADMIN': 'Administrador',
      'ARQUITECTO': 'Arquitecto',
      'CONSTRUCTOR': 'Constructor'
  }[formData.role] || formData.role;

  // Colors
  const primaryColor = '#0A2540';
  const accentColor = '#00D4B3';

  const roleOptions = [
    { value: 'CONSTRUCTOR', label: 'Constructor', desc: 'Permisos básicos para crear y ver contenido' },
    { value: 'ARQUITECTO', label: 'Arquitecto', desc: 'Diseño de estructuras y revisión de contenido' },
    { value: 'ADMIN', label: 'Administrador', desc: 'Control total de la plataforma y usuarios' },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-0">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Modal Box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
            className="relative w-full max-w-5xl bg-white dark:bg-[#0F1419] rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-white/10 flex flex-col md:flex-row min-h-[600px] transition-colors"
            style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}
          >
            {/* Left Panel - Preview */}
            <div 
              className="w-full md:w-80 p-8 flex flex-col items-center justify-center text-center relative overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${primaryColor} 0%, #06152a 100%)`
              }}
            >
              {/* Decorative background elements */}
              <div className="absolute top-0 left-0 w-full h-full">
                 <div className="absolute top-[-20%] left-[-20%] w-[200px] h-[200px] bg-[#00D4B3]/20 rounded-full blur-[80px]" />
                 <div className="absolute bottom-[-10%] right-[-10%] w-[150px] h-[150px] bg-[#1F5AF6]/20 rounded-full blur-[60px]" />
              </div>

              <div className="flex-1 flex flex-col items-center justify-center relative z-10 w-full">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.4 }}
                  className="relative mb-8"
                >
                  <div 
                    className="w-28 h-28 rounded-3xl flex items-center justify-center text-4xl font-bold text-white shadow-2xl ring-4 ring-[#ffffff]/5"
                    style={{
                      background: `linear-gradient(135deg, #2D3748 0%, #1A202C 100%)`,
                      boxShadow: `0 20px 40px -10px rgba(0,0,0,0.5)`
                    }}
                  >
                    <span className="bg-gradient-to-br from-white to-[#94A3B8] bg-clip-text text-transparent">
                      {previewInitials}
                    </span>
                  </div>
                  
                  {/* Badge animado */}
                  <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute -top-3 -right-3 w-10 h-10 rounded-xl flex items-center justify-center bg-[#151A21] border border-[#00D4B3]/30 shadow-lg shadow-[#00D4B3]/20"
                  >
                      <Sparkles className="w-5 h-5 text-[#00D4B3]" />
                  </motion.div>
                </motion.div>

                <div className="space-y-3 w-full">
                  <h3 className="text-2xl font-bold text-white truncate px-2">{previewName}</h3>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#00D4B3]/10 border border-[#00D4B3]/20">
                    <Shield size={12} className="text-[#00D4B3]" />
                    <span className="text-xs font-semibold text-[#00D4B3] uppercase tracking-wide">
                      {roleLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-sm text-[#94A3B8] px-4 py-2 rounded-lg bg-white/5 mx-auto max-w-full truncate">
                    <Mail size={14} />
                    <span className="truncate">{formData.email || 'correo@ejemplo.com'}</span>
                  </div>
                </div>
              </div>
              
              <div className="w-full relative z-10 pt-6 border-t border-white/5 text-xs text-[#6C757D]">
                  <p>Vista Previa del Perfil</p>
              </div>
            </div>

            {/* Right Panel - Form */}
            <div className="flex-1 flex flex-col bg-white dark:bg-[#151A21] relative transition-colors">
              
              {/* Header */}
              <div className="flex items-center justify-between p-8 border-b border-gray-100 dark:border-[#6C757D]/10">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{isEdit ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
                  <p className="text-sm text-gray-500 dark:text-[#94A3B8]">{isEdit ? 'Actualiza los permisos y datos del perfil.' : 'Completa la información para dar de alta un acceso.'}</p>
                </div>
                <button 
                  onClick={onClose}
                  className="p-2 text-gray-400 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              {/* Form Content */}
              <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto">
                    
                    {/* Name Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Nombre</label>
                            <div className="relative group">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors" size={18} />
                                <input
                                    name="firstName"
                                    value={formData.firstName}
                                    onChange={handleChange}
                                    placeholder="Ej. Sofia"
                                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                    required
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Apellido Paterno</label>
                            <div className="relative group">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors" size={18} />
                                <input
                                    name="lastNameFather"
                                    value={formData.lastNameFather}
                                    onChange={handleChange}
                                    placeholder="Ej. López"
                                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                    required
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                             <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Apellido Materno</label>
                             <div className="relative group">
                                 <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors" size={18} />
                                 <input
                                     name="lastNameMother"
                                     value={formData.lastNameMother}
                                     onChange={handleChange}
                                     placeholder="Ej. García"
                                     className="w-full pl-11 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                 />
                             </div>
                        </div>
                         <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Nombre de Usuario</label>
                            <div className="relative group">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] font-mono text-sm">@</div>
                                <input
                                    name="username"
                                    value={formData.username}
                                    onChange={handleChange}
                                    placeholder="usuario"
                                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Correo Electrónico</label>
                        <div className="relative group">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors" size={18} />
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="usuario@organizacion.com"
                                className="w-full pl-11 pr-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                required
                            />
                        </div>
                    </div>

                     {/* Password Field */}
                     {!isEdit && (
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Contraseña</label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors" size={18} />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder="••••••••"
                                    className="w-full pl-11 pr-12 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                                    required={!isEdit}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] hover:text-gray-600 dark:hover:text-white transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            <p className="text-[10px] text-gray-400 dark:text-[#6C757D] ml-1">Mínimo 8 caracteres, alfanumérico.</p>
                        </div>
                    )}

                    {/* Custom Dropdown for Role */}
                    <div className="space-y-2 relative" ref={roleDropdownRef}>
                        <label className="text-xs font-semibold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider ml-1">Rol de Plataforma</label>
                        <button
                            type="button"
                            onClick={() => setIsRoleOpen(!isRoleOpen)}
                            className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 flex items-center justify-between group hover:border-gray-300 dark:hover:border-[#6C757D]/40 transition-all"
                        >
                            <div className="flex items-center gap-3">
                                <Briefcase className="text-[#00D4B3]" size={18} />
                                <div>
                                    <span className="block text-sm font-medium text-gray-900 dark:text-white">
                                        {roleOptions.find(o => o.value === formData.role)?.label}
                                    </span>
                                </div>
                            </div>
                            <ChevronDown 
                                size={18} 
                                className={`text-gray-400 dark:text-[#6C757D] transition-transform duration-300 ${isRoleOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        <AnimatePresence>
                            {isRoleOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -10, scale: 0.98 }}
                                    transition={{ duration: 0.2 }}
                                    className="absolute top-full left-0 right-0 mt-2 rounded-xl bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 shadow-xl overflow-hidden z-50 py-1"
                                >
                                    {roleOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => handleRoleSelect(option.value)}
                                            className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-[#1E2329] transition-colors ${formData.role === option.value ? 'bg-[#00D4B3]/5' : ''}`}
                                        >
                                            <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center ${formData.role === option.value ? 'border-[#00D4B3]' : 'border-gray-300 dark:border-[#6C757D]/50'}`}>
                                                {formData.role === option.value && <div className="w-2 h-2 rounded-full bg-[#00D4B3]" />}
                                            </div>
                                            <div>
                                                <span className={`block text-sm font-medium ${formData.role === option.value ? 'text-[#00D4B3]' : 'text-gray-900 dark:text-white'}`}>
                                                    {option.label}
                                                </span>
                                                <span className="block text-xs text-gray-500 dark:text-[#94A3B8] leading-tight mt-0.5">
                                                    {option.desc}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                </form>
              </div>

              {/* Footer */}
              <div className="p-8 border-t border-gray-100 dark:border-[#6C757D]/10 flex justify-end gap-4 bg-gray-50 dark:bg-[#151A21] transition-colors">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-gray-500 dark:text-[#94A3B8] hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
                <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-[#00D4B3] to-[#1F5AF6] rounded-xl opacity-30 group-hover:opacity-60 blur transition duration-300"></div>
                    <button
                        type="submit"
                        form="user-form"
                        className="relative px-8 py-3 rounded-xl text-sm font-bold text-white dark:text-black flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
                        style={{
                            background: `linear-gradient(135deg, ${accentColor}, #22d3ee)`
                        }}
                    >
                        <Save size={18} />
                        <span>{isEdit ? 'Guardar Cambios' : 'Crear Usuario'}</span>
                    </button>
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
