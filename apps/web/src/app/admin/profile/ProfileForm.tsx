'use client';

import { useState } from 'react';
import { User, Mail, Shield, Camera, Save, Loader2, Lock, Eye, EyeOff, Calendar, CheckCircle2, Phone, MapPin, FileCode, Key } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

import { updateProfile, updatePassword } from './actions';

export default function ProfileForm({ user, profile, artifactCount }: { user: any, profile: any, artifactCount: number }) {
  const [isLoading, setIsLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'general' | 'security'>('general');
  
  // Profile State
  const [formData, setFormData] = useState({
    firstName: profile?.first_name || '',
    lastNameFather: profile?.last_name_father || '',
    lastNameMother: profile?.last_name_mother || '',
    username: profile?.username || '',
  });

  // Password State
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPasswordData({ ...passwordData, [e.target.name]: e.target.value });
  };

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    const result = await updateProfile(formData);
    
    setIsLoading(false);
    if (result.error) {
        toast.error(result.error);
    } else {
        toast.success("Perfil actualizado correctamente");
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
        toast.error("Las contraseñas no coinciden");
        return;
    }

    setIsLoading(true);
    const result = await updatePassword(passwordData);
    setIsLoading(false);

    if (result.error) {
        toast.error(result.error);
    } else {
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        toast.success("Contraseña actualizada correctamente");
    }
  };

  // Boxed Input Component mimicking the reference design
  const BoxInput = ({ label, icon: Icon, readOnly = false, ...props }: any) => (
    <div className={`bg-gray-50 dark:bg-[#151A21] border border-gray-200 dark:border-white/5 rounded-2xl p-4 flex flex-col gap-2 transition-all group ${readOnly ? 'opacity-60' : 'focus-within:border-[#00D4B3] focus-within:ring-1 focus-within:ring-[#00D4B3]/20 dark:focus-within:border-[#00D4B3]/50 dark:focus-within:bg-[#1A2029]'}`}>
       <div className="flex items-center gap-2">
           {Icon && <Icon size={14} className={`text-gray-400 dark:text-slate-600 ${!readOnly && 'group-focus-within:text-[#00D4B3]'} transition-colors`} />}
           <span className={`text-xs text-gray-500 dark:text-slate-500 font-medium ${!readOnly && 'group-focus-within:text-[#00D4B3]'} transition-colors`}>{label}</span>
       </div>
       <input 
         {...props}
         readOnly={readOnly}
         className={`w-full bg-transparent text-sm pl-1 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-700 focus:outline-none font-medium ${readOnly ? 'cursor-not-allowed text-gray-400 dark:text-slate-400' : ''}`}
       />
    </div>
  );

  return (
      <div className="space-y-8 pb-20 animate-in fade-in zoom-in duration-500">
        
        {/* HERO HEADER SECTION */}
        <div className="relative w-full bg-white dark:bg-gradient-to-r dark:from-[#12161C] dark:to-[#0A0D11] border border-gray-200 dark:border-white/5 rounded-3xl p-8 overflow-hidden shadow-xl shadow-black/5 dark:shadow-2xl">
             {/* Background glow effects */}
             <div className="absolute top-0 right-0 w-2/3 h-full bg-[#00D4B3]/5 blur-3xl pointer-events-none" />
             <div className="absolute bottom-0 left-0 w-1/3 h-2/3 bg-blue-500/5 blur-3xl pointer-events-none" />

             <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center gap-8">
                 {/* Avatar */}
                 <div className="relative group shrink-0">
                     <div className="w-32 h-32 rounded-3xl bg-gray-100 dark:bg-[#1A2029] border border-gray-200 dark:border-white/5 flex items-center justify-center text-4xl font-bold text-gray-400 dark:text-slate-300 shadow-xl group-hover:border-[#00D4B3]/30 transition-colors">
                        {profile?.first_name?.[0] || user?.email?.[0]?.toUpperCase()}
                     </div>
                     <button className="absolute -bottom-3 -right-3 bg-[#00D4B3] text-white dark:text-black p-2.5 rounded-xl hover:scale-110 transition-transform shadow-lg shadow-[#00D4B3]/20 cursor-pointer border border-white dark:border-transparent">
                        <Camera size={18} />
                     </button>
                 </div>

                 {/* User Info */}
                 <div className="flex-1 space-y-3">
                     <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                            {formData.firstName} {formData.lastNameFather}
                        </h1>
                        <p className="text-gray-500 dark:text-slate-400 font-medium flex items-center gap-2 mt-1">
                            <Shield size={14} className="text-[#00D4B3]" /> 
                            {profile?.platform_role === 'ADMIN' ? 'CTO / Director(a) de Tecnología' : 'Miembro de Plataforma'}
                        </p>
                     </div>

                     <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-slate-500 font-medium pt-2">
                        <span className="flex items-center gap-2">
                             <Calendar size={14} />
                             Miembro desde {new Date(user.created_at || Date.now()).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                        <span className="flex items-center gap-2 text-emerald-500 dark:text-green-400">
                             <CheckCircle2 size={14} />
                             Email verificado
                        </span>
                     </div>
                 </div>

                 {/* Stats Cards (Right side) */}
                     <div className="bg-gray-50 dark:bg-[#151A21] border border-gray-100 dark:border-white/5 rounded-2xl p-4 text-center min-w-[110px] hover:bg-gray-100 dark:hover:bg-[#1A2029] transition-colors cursor-default">
                        <FileCode size={20} className="mx-auto text-[#00D4B3] mb-2" />
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{artifactCount}</div>
                        <div className="text-[10px] text-gray-500 dark:text-slate-500 uppercase tracking-wider font-semibold">Artefactos</div>
                     </div>
             </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex items-center gap-2 mt-8">
             <button 
                onClick={() => setActiveSection('general')}
                className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 border ${activeSection === 'general' ? 'bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20' : 'bg-transparent border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-white dark:hover:bg-white/5'}`}
             >
                <User size={16} /> Información Personal
             </button>
             <button 
                onClick={() => setActiveSection('security')}
                className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 border ${activeSection === 'security' ? 'bg-[#00D4B3]/10 text-[#00D4B3] border-[#00D4B3]/20' : 'bg-transparent border-transparent text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-white dark:hover:bg-white/5'}`}
             >
                <Shield size={16} /> Seguridad
             </button>
        </div>

        {/* CONTENT AREA */}
        <AnimatePresence mode='wait'>
            {activeSection === 'general' ? (
                 <motion.form 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleSubmitProfile}
                    className="space-y-6"
                 >
                    {/* Grid Layout Inputs */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <BoxInput label="Nombre" name="firstName" value={formData.firstName} onChange={handleProfileChange} icon={User} />
                        <BoxInput label="Apellido" name="lastNameFather" value={formData.lastNameFather} onChange={handleProfileChange} icon={User} />
                        <BoxInput label="Nombre de Usuario" name="username" value={formData.username} onChange={handleProfileChange} icon={User} prefix="@" />
                    </div>

                    {/* Floating Save Button */}
                     <div className="fixed bottom-6 right-8 z-50">
                        <button 
                            type="submit" 
                            disabled={isLoading}
                            className="flex items-center gap-3 bg-white dark:bg-[#0F1419] hover:bg-gray-50 dark:hover:bg-[#151A21] text-gray-900 dark:text-white border border-gray-200 dark:border-[#00D4B3]/30 px-6 py-3 rounded-xl font-medium shadow-2xl shadow-black/10 dark:shadow-black/50 transition-all hover:-translate-y-1 hover:border-[#00D4B3]"
                        >
                             {isLoading ? <Loader2 size={18} className="animate-spin text-[#00D4B3]" /> : <Save size={18} className="text-[#00D4B3]" />}
                             <span className="text-sm">Guardar cambios</span>
                        </button>
                    </div>

                 </motion.form>
            ) : (
                <motion.div
                    key="security"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="w-full"
                >
                     <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-white/5 rounded-3xl p-8 backdrop-blur-sm relative overflow-hidden shadow-sm">
                        
                        <div className="flex items-start justify-between mb-8 relative z-10">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Cambiar Contraseña</h3>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Asegúrate de usar una contraseña segura.</p>
                            </div>
                            <div className="p-3 bg-gray-100 dark:bg-white/5 rounded-xl text-[#00D4B3]">
                                <Key size={24} />
                            </div>
                        </div>

                         <form onSubmit={handleSubmitPassword} className="space-y-6 relative z-10 w-full">
                            <BoxInput 
                                label="Contraseña Actual" 
                                type={showPassword ? "text" : "password"}
                                name="currentPassword" 
                                value={passwordData.currentPassword} 
                                onChange={handlePasswordChange} 
                                icon={Lock} 
                            />
                            
                            <div className="grid grid-cols-2 gap-4">
                                <BoxInput 
                                    label="Nueva Contraseña" 
                                    type={showPassword ? "text" : "password"}
                                    name="newPassword" 
                                    value={passwordData.newPassword} 
                                    onChange={handlePasswordChange} 
                                    icon={Lock} 
                                />
                                <BoxInput 
                                    label="Confirmar" 
                                    type={showPassword ? "text" : "password"}
                                    name="confirmPassword" 
                                    value={passwordData.confirmPassword} 
                                    onChange={handlePasswordChange} 
                                    icon={Lock} 
                                />
                            </div>

                            <div className="flex items-center justify-between pt-4">
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-xs text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white flex items-center gap-2 transition-colors">
                                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                    {showPassword ? 'Ocultar caracteres' : 'Mostrar caracteres'}
                                </button>
                                
                                <button 
                                    type="submit" 
                                    disabled={isLoading}
                                    className="bg-[#00D4B3] hover:bg-[#00bda0] text-white dark:text-black px-6 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-lg shadow-[#00D4B3]/20"
                                >
                                    {isLoading ? 'Actualizando...' : 'Actualizar Clave'}
                                </button>
                            </div>
                         </form>
                     </div>
                </motion.div>
            )}
        </AnimatePresence>
      </div>
  );
}
