"use client";

import Image from "next/image";
import { Button } from "@/shared/components/Button";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0F1419] text-white selection:bg-[#00D4B3] selection:text-[#0F1419] overflow-x-hidden font-sans">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#0A2540]/20 rounded-full blur-[150px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-[#00D4B3]/5 rounded-full blur-[150px]" />
      </div>

      {/* Navbar */}
      <nav className="fixed w-full z-50 top-0 left-0 border-b border-white/5 bg-[#0F1419]/80 backdrop-blur-md">
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
            <span className="text-2xl font-bold tracking-tight text-white">
              CourseGen
            </span>
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
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00D4B3] to-[#10B981]">
                  Automatizada con IA
                </span>
              </h1>

              <p className="text-lg text-[#94A3B8] max-w-xl mx-auto lg:mx-0 leading-relaxed">
                Transforma tu conocimiento en experiencias educativas
                estructuradas. CourseGen utiliza inteligencia artificial
                avanzada para diseñar, desarrollar y optimizar tus cursos en
                minutos.
              </p>
            </motion.div>

            {/* CTA Button REMOVED as per user request */}

            {/* Metrics/Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex items-center gap-8 justify-center lg:justify-start pt-4 text-sm text-[#6C757D] font-medium"
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

              {/* Floating Cards REMOVED as per user request */}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
