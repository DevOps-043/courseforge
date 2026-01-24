'use client';

import { useState, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { loginAction } from './actions';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registered = searchParams.get('registered');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('identifier', identifier);
      formData.append('password', password);
      formData.append('rememberMe', rememberMe.toString());

      const res = await loginAction(null, formData);

      if (res?.error) {
        throw new Error(res.error);
      }
      
      router.push(res.redirectTo || '/dashboard'); 
      router.refresh(); 
    } catch (err: any) {
      console.error('Login failed', err);
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Bienvenido de nuevo</h1>
        <p className="text-gray-600 dark:text-[#94A3B8]">
          Inicia sesión para <span className="text-[#00D4B3]">continuar innovando y creando</span>
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Identifier Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-[#94A3B8] ml-1">Usuario o Correo</label>
          <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors">
              <Mail size={20} />
            </div>
            <input 
              type="text" 
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full bg-white dark:bg-[#0A0D12] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl py-3.5 pl-12 pr-4 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[#00D4B3] dark:focus:border-[#00D4B3]/50 focus:ring-1 focus:ring-[#00D4B3] dark:focus:ring-[#00D4B3]/50 transition-all"
              placeholder="tu@correo.com o username"
              required
            />
          </div>
        </div>

        {/* Password Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-[#94A3B8] ml-1">Contraseña</label>
          <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors">
              <Lock size={20} />
            </div>
            <input 
              type={showPassword ? "text" : "password"} 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white dark:bg-[#0A0D12] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl py-3.5 pl-12 pr-12 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-[#00D4B3] dark:focus:border-[#00D4B3]/50 focus:ring-1 focus:ring-[#00D4B3] dark:focus:ring-[#00D4B3]/50 transition-all"
              placeholder="••••••••"
              required
            />
            <button 
              type="button" 
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-[#6C757D] hover:text-gray-600 dark:hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>

        {/* Remember Me & Forgot Password */}
        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative flex items-center">
              <input 
                type="checkbox" 
                className="peer sr-only" 
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <div className="w-5 h-5 border-2 border-gray-300 dark:border-white/20 rounded bg-white dark:bg-[#0A0D12] peer-checked:bg-[#00D4B3] peer-checked:border-[#00D4B3] transition-all" />
              <div className="absolute inset-0 flex items-center justify-center text-[#0F1419] opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <span className="text-gray-600 dark:text-[#94A3B8] group-hover:text-gray-800 dark:group-hover:text-gray-300 transition-colors">Recordarme</span>
          </label>
          
          <button type="button" className="text-[#00D4B3] hover:text-[#00CDB0] transition-colors">
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        {/* Submit Button */}
        <button 
          type="submit" 
          disabled={isLoading}
          className="w-full bg-[#0A2540] hover:bg-[#0d2f4d] dark:bg-[#0A2540] dark:hover:bg-[#0d2f4d] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl shadow-lg shadow-[#0A2540]/25 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group border border-[#0A2540]"
        >
          {isLoading ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              Iniciar Sesión
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>

        {/* Register Link */}
        <div className="text-center mt-4 pt-2 border-t border-gray-100 dark:border-white/5">
            <p className="text-xs text-gray-500 dark:text-[#94A3B8]">
                ¿No tienes cuenta?{' '}
                <Link href="/register" className="text-[#00D4B3] hover:underline hover:text-[#00bda0] transition-colors">
                    Regístrate aquí
                </Link>
            </p>
        </div>

      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0F1419] flex items-center justify-center p-4 lg:p-10 font-sans selection:bg-[#00D4B3] selection:text-[#0F1419] overflow-hidden transition-colors duration-300">
      {/* Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#00D4B3]/5 dark:bg-[#0A2540]/20 rounded-full blur-[120px]" />
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 dark:bg-[#00D4B3]/5 rounded-full blur-[120px]" />
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
                alt="CourseGen Network" 
                fill
                className="object-contain drop-shadow-2xl"
                priority
              />
            </motion.div>
        </div>

        {/* Right Column: Login Form */}
        <div className="w-full flex justify-center lg:justify-start order-2 lg:order-2">
          {/* Card Bg: White (Light) / #1E2329 (Dark) */}
          <div className="w-full max-w-md bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-[#6C757D]/20 rounded-2xl p-6 sm:p-8 lg:p-12 shadow-xl dark:shadow-2xl mx-auto lg:mx-0 transition-colors duration-300">
            <Suspense fallback={<div className="text-gray-600 dark:text-white text-center">Cargando formulario...</div>}>
              <LoginContent />
            </Suspense>
          </div>
        </div>

      </div>
    </div>
  );
}
