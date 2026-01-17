'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login({ email, password });
      router.push('/dashboard');
    } catch (error) {
      console.error('Login failed', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    // Background Dark #0F1419 based on Design System (Mode Dark Main)
    <div className="min-h-screen bg-[#0F1419] flex items-center justify-center p-4 lg:p-10 font-sans selection:bg-[#00D4B3] selection:text-[#0F1419] overflow-hidden">
      
      {/* Background Ambient Glows */}
      <div className="fixed inset-0 pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#0A2540]/20 rounded-full blur-[120px]" />
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#00D4B3]/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-7xl px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center justify-items-center relative z-10">
        
        {/* Left Column: Visual 3D Logo 
            Visible on lg screens mostly, on smaller screens simpler or smaller.
            Centered on all screens now.
        */}
        <div className="w-full flex justify-center lg:justify-end order-1 lg:order-1 mb-8 lg:mb-0">
            <motion.div
               animate={{ y: [-15, 15, -15] }}
               transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
               className="relative w-[280px] h-[280px] sm:w-[350px] sm:h-[350px] lg:w-[500px] lg:h-[500px]"
            >
              <Image 
                src="/sofia_3d_network_logo.png" 
                alt="Courseforge Network" 
                fill
                className="object-contain drop-shadow-2xl"
                priority
              />
            </motion.div>
        </div>

        {/* Right Column: Login Form 
            Centered content, responsive width
        */}
        <div className="w-full flex justify-center lg:justify-start order-2 lg:order-2">
          {/* Card Bg: #1E2329 (Secondary Dark), Border: #6C757D (Grey Medium) subtle */}
          <div className="w-full max-w-md bg-[#1E2329] border border-[#6C757D]/20 rounded-2xl p-6 sm:p-8 lg:p-12 shadow-2xl mx-auto lg:mx-0">
            
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-white mb-2">Bienvenido de nuevo</h1>
              <p className="text-[#94A3B8]">
                Inicia sesión para <span className="text-[#00D4B3]">continuar innovando y creando</span>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Email Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#E9ECEF] ml-1">Correo electrónico</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors">
                    <Mail size={20} />
                  </div>
                  {/* Input Bg: Lighter than card? Or darker #0A0D12? using #0A0D12 for input bg */}
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#0A0D12] border border-[#6C757D]/30 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                    placeholder="tu@correo.com"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#E9ECEF] ml-1">Contraseña</label>
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6C757D] group-focus-within:text-[#00D4B3] transition-colors">
                    <Lock size={20} />
                  </div>
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0A0D12] border border-[#6C757D]/30 rounded-xl py-3.5 pl-12 pr-12 text-white placeholder-[#6C757D] focus:outline-none focus:border-[#00D4B3] focus:ring-1 focus:ring-[#00D4B3] transition-all"
                    placeholder="••••••••"
                    required
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6C757D] hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input type="checkbox" className="peer sr-only" />
                    {/* Checkbox color logic: Checked bg #00D4B3 (Aqua) */}
                    <div className="w-5 h-5 border-2 border-[#6C757D]/50 rounded bg-[#0A0D12] peer-checked:bg-[#00D4B3] peer-checked:border-[#00D4B3] transition-all" />
                    <div className="absolute inset-0 flex items-center justify-center text-[#0F1419] opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-[#94A3B8] group-hover:text-[#E9ECEF] transition-colors">Recordarme</span>
                </label>
                
                <button type="button" className="text-[#00D4B3] hover:text-[#00B59C] transition-colors">
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              {/* Submit Button - Primary Color #0A2540? Wait, primary button in dark mode often needs pop. 
                  Design system says: "Botones Primarios: Azul Profundo #0A2540, Texto Blanco". 
                  BUT in Login (Dark Mode), blue might be low contrast on dark bg. 
                  Let's check the reference image provided by user... 
                  The user said "no utilizas los grises... ni el color de los botones".
                  Looking at the reference image uploaded by user: The button is a dark blue. 
                  In SOFIA_DESIGN_SYSTEM.md -> Primary Button: #0A2540.
                  However, on a #1E2329 card, #0A2540 is very similar.
                  Let's stick to the Design System explicitly: #0A2540 for primary button background. 
                  Actually, wait, #1F5AF6 was the previous blue.
                  The doc says "Azul Profundo - #0A2540 -> Botones primarios".
                  Let's try that exact color.
              */}
              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full bg-[#0A2540] hover:bg-[#0d2f4d] border border-[#0A2540] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl shadow-lg shadow-[#0A2540]/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 group"
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

            </form>

            {/* Separator & Social (Optional, but kept for layout balance if needed, or remove if user asked "no sso")
                User said: "obviamente no pongas lo de sso ni lo de registrse".
                Removing SSO section and Register link.
            */}
            
          </div>
        </div>

      </div>
    </div>
  );
}
