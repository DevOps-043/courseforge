
"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/shared/components/Button";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Sun, Moon, Monitor } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Theme toggle cycle: System -> Dark -> Light -> System
  // This ensures that if a user starts on System (often Light), the first click goes Dark (visible change).


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0F1419] text-gray-900 dark:text-white selection:bg-[#00D4B3] selection:text-[#0F1419] overflow-x-hidden font-sans transition-colors duration-300">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#00D4B3]/10 dark:bg-[#0A2540]/20 rounded-full blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 dark:bg-[#00D4B3]/5 rounded-full blur-[150px]" />
      </div>

      {/* Navbar */}
      <nav className="fixed w-full z-50 top-0 left-0 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-[#0F1419]/80 backdrop-blur-md transition-colors duration-300">
        <div className="w-full px-8 lg:px-12 h-20 flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12">
              <Image
                src="/Logo.png"
                alt="CourseGen"
                fill
                className="object-contain"
              />
            </div>
            <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              CourseGen
            </span>
          </div>

          {/* Right Action */}
          <div className="flex items-center gap-4">
             {/* Theme Toggle */}
             {mounted ? (
                <button
                    type="button"
                    onClick={() => {
                        if (theme === 'system') setTheme('dark');
                        else if (theme === 'dark') setTheme('light');
                        else setTheme('system');
                    }}
                    className="p-2.5 rounded-lg text-gray-500 dark:text-gray-400 bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 border border-gray-200 dark:border-white/10 transition-all relative z-50 cursor-pointer"
                    title={`Tema: ${theme === 'light' ? 'Claro' : theme === 'dark' ? 'Oscuro' : 'Sistema'}`}
                    aria-label="Cambiar tema"
                >
                    {theme === 'light' ? (
                        <SunWrapper />
                    ) : theme === 'dark' ? (
                        <MoonWrapper />
                    ) : (
                        <MonitorWrapper />
                    )}
                </button>
             ) : (
                 <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/5" /> 
             )}

            <Link
              href="/login"
              className="px-6 py-2.5 text-sm font-medium text-gray-700 dark:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg transition-all"
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
              <h1 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight mb-6 text-gray-900 dark:text-white">
                Creación de Cursos <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00D4B3] to-[#10B981]">
                  Automatizada con IA
                </span>
              </h1>

              <p className="text-lg text-gray-600 dark:text-[#94A3B8] max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Transforma tu conocimiento en experiencias educativas
                estructuradas. CourseGen utiliza inteligencia artificial
                avanzada para diseñar, desarrollar y optimizar tus cursos en
                minutos.
              </p>
            </motion.div>

            {/* Metrics/Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex items-center gap-8 justify-center lg:justify-start pt-4 text-sm text-gray-500 dark:text-[#6C757D] font-medium"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00D4B3]" />
                Generación Instantánea
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#00D4B3]" />
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
                  src="/Logo.png"
                  alt="AI Network"
                  fill
                  className="object-contain drop-shadow-2xl"
                  priority
                />
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}

// Simple wrappers to avoid icon flicker or potential issues if needed, strictly optional but cleaner in JSX
const SunWrapper = () => <Sun size={20} className="text-yellow-500" />;
const MoonWrapper = () => <Moon size={20} className="text-blue-500" />;
const MonitorWrapper = () => <Monitor size={20} className="text-[#00D4B3]" />;
