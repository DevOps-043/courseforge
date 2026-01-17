'use client';

import Image from 'next/image';
import { Button } from '@/shared/components/Button';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#050B14] text-white selection:bg-[#00E5C0] selection:text-[#050B14] overflow-x-hidden font-sans">
      
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#1F5AF6]/10 rounded-full blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-[#00E5C0]/5 rounded-full blur-[150px]" />
      </div>

      {/* Navbar */}
      <nav className="fixed w-full z-50 top-0 left-0 border-b border-white/5 bg-[#050B14]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12">
               <Image src="/Icono.png" alt="Courseforge" fill className="object-contain" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">Courseforge</span>
          </div>

          {/* Right Action */}
          <div className="flex items-center gap-6">
            <Link 
              href="/login" 
              className="px-6 py-2.5 text-sm font-medium text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 pt-32 lg:pt-48 pb-20 max-w-7xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-24">
          
          {/* Left Content */}
          <div className="flex-1 space-y-10 text-center lg:text-left">
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight mb-6">
                Creación de Cursos <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00E5C0] to-[#1F5AF6]">
                  Automatizada con IA
                </span>
              </h1>

              <p className="text-lg text-gray-400 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Transforma tu conocimiento en experiencias educativas estructuradas. Courseforge utiliza inteligencia artificial avanzada para diseñar, desarrollar y optimizar tus cursos en minutos.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start"
            >
              <Button className="h-14 px-10 bg-[#1F5AF6] hover:bg-[#1a4bd3] text-white rounded-xl font-semibold text-lg shadow-lg shadow-[#1F5AF6]/20 transition-transform active:scale-95">
                Crear Curso Gratis
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </motion.div>

            {/* Metrics/Stats */}
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               transition={{ duration: 0.8, delay: 0.4 }}
               className="flex items-center gap-8 justify-center lg:justify-start pt-4 text-sm text-gray-500 font-medium"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00E5C0]" />
                Generación Instantánea
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00E5C0]" />
                 Estructura Pedagógica
              </div>
            </motion.div>

          </div>

          {/* Right Visual (3D Graphic) */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
            className="flex-1 w-full max-w-[600px]"
          >
            <div className="relative aspect-square animate-float-slow">
              {/* Main 3D Image */}
              <div className="relative z-10 w-full h-full flex items-center justify-center"> 
                 {/* Fallback visual if image fails */}
                 <Image 
                    src="/sofia_3d_network_logo.png" 
                    alt="AI Network" 
                    fill 
                    className="object-contain drop-shadow-2xl"
                    priority
                 />
              </div>

               {/* Floating Cards */}
               <motion.div 
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute -left-4 top-1/2 -translate-y-1/2 p-4 rounded-xl glass-card hidden md:block"
               >
                  <div className="flex items-center gap-3">
                     <div className="w-10 h-10 rounded-full bg-[#00E5C0] flex items-center justify-center text-black font-bold">
                        <CheckCircle2 className="w-6 h-6" />
                     </div>
                     <div>
                        <div className="text-xs text-gray-400">Eficiencia</div>
                        <div className="text-xl font-bold text-white">10x más rápido</div>
                     </div>
                  </div>
               </motion.div>

            </div>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
