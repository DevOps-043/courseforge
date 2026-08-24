'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { Button } from '@/shared/components/Button';

export default function RegisterPage() {
  const router = useRouter();
  
  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastNameFather: '',
    lastNameMother: '',
    username: '',
    email: '',
    password: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al registrarse');
      }

      // Success! Redirect
      router.push('/login?registered=true');

    } catch (error: unknown) {
      setError(getErrorMessage(error, 'Error al registrarse'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--engine-canvas)] flex items-center justify-center p-4 lg:p-10 font-sans selection:bg-[var(--engine-accent)] selection:text-[var(--engine-canvas)] overflow-hidden">
      {/* Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[var(--engine-primary)]/20 rounded-full blur-[120px]" />
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[var(--engine-accent)]/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-7xl px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center justify-items-center relative z-10">
        
        {/* Left Column: Visual 3D Logo */}
        <div className="w-full flex justify-center lg:justify-end order-1 lg:order-1 mb-8 lg:mb-0">
            <motion.div
               animate={{ y: [-15, 15, -15] }}
               transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
               className="relative w-[280px] h-[280px] sm:w-[350px] sm:h-[350px] lg:w-[500px] lg:h-[500px]"
            >
              <Image 
                src="/Logo.png" 
                alt="SofLIA - Engine Network" 
                fill
                className="object-contain drop-shadow-2xl"
                priority
              />
            </motion.div>
        </div>

        {/* Right Column: Register Form */}
        <div className="w-full flex justify-center lg:justify-start order-2 lg:order-2">
          <div className="w-full max-w-lg bg-[var(--engine-surface-hover)] border border-[var(--engine-muted)]/20 rounded-2xl p-6 sm:p-8 lg:p-10 shadow-2xl mx-auto lg:mx-0">
            
            <div className="mb-6 text-center">
              <h1 className="text-3xl font-bold text-white mb-2">Crear Cuenta</h1>
              <p className="text-[var(--engine-text-muted)]">
                Únete para <span className="text-[var(--engine-accent)]">comenzar a construir</span>
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-4">
              
              {/* Nombres y Apellidos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Nombre</label>
                    <input 
                        type="text" 
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleChange}
                        className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 px-4 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                        placeholder="Tu Nombre"
                        required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Username</label>
                    <input 
                        type="text" 
                        name="username"
                        value={formData.username}
                        onChange={handleChange}
                        className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 px-4 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                        placeholder="@usuario"
                        required
                    />
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Apellido Paterno</label>
                    <input 
                        type="text" 
                        name="lastNameFather"
                        value={formData.lastNameFather}
                        onChange={handleChange}
                        className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 px-4 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                        placeholder="Paterno"
                        required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Apellido Materno</label>
                    <input 
                        type="text" 
                        name="lastNameMother"
                        value={formData.lastNameMother}
                        onChange={handleChange}
                        className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 px-4 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                        placeholder="Materno"
                        required
                    />
                  </div>
              </div>

              {/* Email Input */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Correo electrónico</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--engine-muted)] group-focus-within:text-[var(--engine-accent)] transition-colors">
                    <Mail size={18} />
                  </div>
                  <input 
                    type="email" 
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 pl-10 pr-4 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                    placeholder="tu@correo.com"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--engine-text-muted)] ml-1">Contraseña</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--engine-muted)] group-focus-within:text-[var(--engine-accent)] transition-colors">
                    <Lock size={18} />
                  </div>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full bg-[#0A0D12] border border-[var(--engine-muted)]/20 rounded-xl py-3 pl-10 pr-10 text-white placeholder-gray-600 focus:outline-none focus:border-[var(--engine-accent)]/50 focus:ring-1 focus:ring-[var(--engine-accent)]/50 transition-all text-sm"
                    placeholder="••••••••"
                    required
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--engine-muted)] hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <Button 
                    type="submit" 
                    disabled={isLoading}
                    className="w-full bg-[var(--engine-primary)] hover:bg-[#0d2f4d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-[var(--engine-primary)]/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group border border-[var(--engine-primary)]"
                >
                    {isLoading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                    <>
                        Registrarse
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                    )}
                </Button>
              </div>

              <div className="text-center mt-4">
                  <p className="text-xs text-[var(--engine-text-muted)]">
                      ¿Ya tienes cuenta?{' '}
                      <Link href="/login" className="text-[var(--engine-accent)] hover:underline hover:text-[var(--engine-accent-hover)] transition-colors">
                          Iniciar Sesión
                      </Link>
                  </p>
              </div>

            </form>

          </div>
        </div>

      </div>
    </div>
  );
}
