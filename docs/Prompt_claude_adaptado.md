Actúa como Senior Frontend Engineer.

OBJETIVO: Rediseñar el UI del dashboard GO-ESP-01 de "blanco plano" a "moderno y dinámico",
manteniendo intacta la lógica/funcionalidad. PRIORIDAD: extender el sistema de design tokens
existente (shadcn/ui) para que cualquier cambio de paleta sea global y sin tocar múltiples archivos.

STACK DETECTADO:
- Next.js 14+ (App Router)
- React + TypeScript
- Tailwind CSS (instalado y configurado)
- shadcn/ui (componentes en src/shared/components/ui/)
- Variables CSS en formato HSL (ya configuradas en globals.css)

RESTRICCIONES:
- NO cambies rutas, nombres de endpoints, ni el data fetching
- NO modifiques los componentes base de shadcn/ui (button.tsx, card.tsx, etc.)
- SÍ puedes extender estilos vía className o crear wrappers
- SÍ puedes añadir nuevas variables CSS al sistema existente

═══════════════════════════════════════════════════════════════════════════════════

0) EXTENDER DESIGN TOKENS (PASO CRÍTICO - PRIMERO)

   El proyecto ya tiene un sistema de tokens en src/app/globals.css usando shadcn/ui.
   EXTIENDE ese sistema, no lo reemplaces.

   A) Añadir tokens adicionales en globals.css (después de los existentes):
   ─────────────────────────────────────────────────────────────────────────

   @layer base {
     :root {
       /* === TOKENS EXISTENTES DE SHADCN (NO MODIFICAR) === */
       --background: 0 0% 100%;
       --foreground: 222.2 84% 4.9%;
       /* ... resto de tokens shadcn ... */

       /* === NUEVOS TOKENS PARA DISEÑO MODERNO === */

       /* Gradientes Hero */
       --gradient-hero: linear-gradient(135deg,
         hsl(222.2 84% 4.9%) 0%,
         hsl(222.2 84% 8%) 50%,
         hsl(221.2 83.2% 53.3%) 100%);

       /* Gradientes para componentes */
       --gradient-subtle: linear-gradient(135deg,
         hsl(0 0% 100%) 0%,
         hsl(210 40% 98%) 100%);
       --gradient-button-primary: linear-gradient(135deg,
         hsl(221.2 83.2% 53.3%) 0%,
         hsl(222.2 84% 4.9%) 100%);
       --gradient-icon-badge: linear-gradient(135deg,
         hsl(221.2 83.2% 53.3%) 0%,
         hsl(222.2 84% 4.9%) 100%);

       /* Gradientes semánticos para badges */
       --gradient-badge-success: linear-gradient(135deg,
         hsl(142 76% 90%) 0%,
         hsl(142 69% 79%) 100%);
       --gradient-badge-warning: linear-gradient(135deg,
         hsl(48 96% 89%) 0%,
         hsl(43 96% 70%) 100%);
       --gradient-badge-danger: linear-gradient(135deg,
         hsl(0 86% 87%) 0%,
         hsl(0 84% 81%) 100%);

       /* Colores semánticos adicionales */
       --success: 142 76% 36%;
       --success-foreground: 142 76% 20%;
       --warning: 38 92% 50%;
       --warning-foreground: 38 92% 20%;

       /* Sombras mejoradas */
       --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
       --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
       --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
       --shadow-blue: 0 10px 25px -5px hsla(221.2, 83.2%, 53.3%, 0.2);

       /* Radios mejorados */
       --radius-lg: 1rem;
       --radius-xl: 1.25rem;
     }

     .dark {
       /* === NUEVOS TOKENS PARA DARK MODE === */
       --gradient-hero: linear-gradient(135deg,
         hsl(222.2 84% 4.9%) 0%,
         hsl(222.2 84% 8%) 50%,
         hsl(217.2 91.2% 59.8%) 100%);

       --gradient-subtle: linear-gradient(135deg,
         hsl(222.2 84% 4.9%) 0%,
         hsl(217.2 32.6% 17.5%) 100%);
     }
   }

   B) Extender tailwind.config.js para usar los nuevos tokens:
   ─────────────────────────────────────────────────────────────

   // En theme.extend.colors, añadir:
   success: {
     DEFAULT: "hsl(var(--success))",
     foreground: "hsl(var(--success-foreground))",
   },
   warning: {
     DEFAULT: "hsl(var(--warning))",
     foreground: "hsl(var(--warning-foreground))",
   },

   // En theme.extend, añadir:
   boxShadow: {
     'blue': 'var(--shadow-blue)',
   },
   borderRadius: {
     'xl': 'var(--radius-xl)',
   },

═══════════════════════════════════════════════════════════════════════════════════

1) COMPONENTES A CREAR/REFACTORIZAR (USANDO SISTEMA EXISTENTE)

   IMPORTANTE: No modifiques los archivos en src/shared/components/ui/.
   Crea NUEVOS componentes o usa className para extender estilos.

   A) DashboardHeader (CREAR: src/shared/components/DashboardHeader.tsx)
   ──────────────────────────────────────────────────────────────────────
   - Fondo: usar clase CSS con var(--gradient-hero)
   - Bordes redondeados: rounded-[20px], padding amplio, texto blanco
   - Añadir pseudo-elementos para "radial glow blobs" (azul y verde)
   - Usar Tailwind para responsive

   Ejemplo de implementación:
   ```tsx
   // src/shared/components/DashboardHeader.tsx
   export function DashboardHeader({ title, subtitle }: Props) {
     return (
       <div className="relative overflow-hidden rounded-[20px] p-8 text-white"
            style={{ background: 'var(--gradient-hero)' }}>
         {/* Glow blobs con pseudo-elementos */}
         <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl" />
         <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl" />

         <div className="relative z-10">
           <h1 className="text-3xl font-bold">{title}</h1>
           {subtitle && <p className="text-white/70 mt-2">{subtitle}</p>}
         </div>
       </div>
     )
   }
   ```

   B) MetricCard (CREAR: src/shared/components/MetricCard.tsx)
   ───────────────────────────────────────────────────────────
   - Fondo: style={{ background: 'var(--gradient-subtle)' }}
   - rounded-xl (16px), shadow-md
   - Borde: border border-primary/10 hover:border-primary/30
   - Icono badge 48px con var(--gradient-icon-badge)
   - Transición: transition-all duration-300 hover:-translate-y-1 hover:shadow-blue
   - Tipografía: valor text-5xl font-bold, label uppercase text-xs tracking-wide

   Ejemplo de implementación:
   ```tsx
   // src/shared/components/MetricCard.tsx
   import { cn } from '@/shared/lib/utils'
   import { LucideIcon } from 'lucide-react'

   interface MetricCardProps {
     icon: LucideIcon
     value: string | number
     label: string
     className?: string
   }

   export function MetricCard({ icon: Icon, value, label, className }: MetricCardProps) {
     return (
       <div
         className={cn(
           "rounded-xl p-5 border border-primary/10",
           "transition-all duration-300 hover:-translate-y-1",
           "hover:border-primary/30 hover:shadow-blue",
           className
         )}
         style={{
           background: 'var(--gradient-subtle)',
           boxShadow: 'var(--shadow-md)'
         }}
       >
         <div
           className="w-12 h-12 rounded-xl flex items-center justify-center text-white mb-4"
           style={{ background: 'var(--gradient-icon-badge)' }}
         >
           <Icon className="h-6 w-6" />
         </div>
         <p className="text-5xl font-bold text-foreground leading-tight">{value}</p>
         <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mt-2">
           {label}
         </p>
       </div>
     )
   }
   ```

   C) ArtifactCard mejorado (EXTENDER vía className en uso)
   ─────────────────────────────────────────────────────────
   El componente ya existe en src/domains/artifacts/components/ArtifactCard.tsx

   OPCIÓN 1: Añadir clases al Card existente en el componente:
   ```tsx
   <Card className="hover:bg-accent/50 transition-all duration-300
                   hover:translate-x-2 hover:shadow-blue
                   border-l-4 border-l-primary relative overflow-hidden
                   before:absolute before:top-0 before:left-0 before:right-0
                   before:h-[3px] before:bg-gradient-to-r before:from-primary
                   before:to-primary/50 before:opacity-0 hover:before:opacity-100
                   before:transition-opacity">
   ```

   OPCIÓN 2: Crear wrapper EnhancedArtifactCard que añade estilos

   Para los badges de estado, crear variantes en globals.css:
   ```css
   /* Añadir en globals.css después de @layer base */
   @layer components {
     .badge-approved {
       background: var(--gradient-badge-success);
       color: hsl(var(--success-foreground));
     }
     .badge-pending {
       background: var(--gradient-badge-warning);
       color: hsl(var(--warning-foreground));
     }
     .badge-escalated {
       background: var(--gradient-badge-danger);
       color: hsl(var(--destructive-foreground));
     }
   }
   ```

   D) Mejoras a Buttons (usar className, NO modificar button.tsx)
   ──────────────────────────────────────────────────────────────
   Añadir clases para efecto moderno cuando uses Button:
   ```tsx
   <Button
     className="bg-gradient-to-r from-primary to-primary/80
                shadow-blue hover:shadow-lg hover:-translate-y-0.5
                transition-all duration-300"
   >
   ```

   O crear variante en globals.css:
   ```css
   @layer components {
     .btn-gradient-primary {
       background: var(--gradient-button-primary);
       box-shadow: var(--shadow-blue);
       transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
     }
     .btn-gradient-primary:hover {
       box-shadow: var(--shadow-lg);
       transform: translateY(-2px);
     }
   }
   ```

   E) Mejoras a Inputs (usar className)
   ────────────────────────────────────
   ```tsx
   <Input
     className="bg-secondary/50 border-2 border-border rounded-xl
                focus:border-primary focus:ring-2 focus:ring-primary/10
                focus:-translate-y-0.5 transition-all duration-200"
   />
   ```

   F) SectionContainer (CREAR: src/shared/components/SectionContainer.tsx)
   ────────────────────────────────────────────────────────────────────────
   ```tsx
   export function SectionContainer({ title, children }: Props) {
     return (
       <div className="bg-card rounded-xl p-8 shadow-md border border-border/50">
         {title && (
           <h2 className="text-xl font-semibold mb-6 relative inline-block
                         after:absolute after:bottom-0 after:left-0
                         after:w-full after:h-1 after:bg-primary after:rounded">
             {title}
           </h2>
         )}
         {children}
       </div>
     )
   }
   ```

═══════════════════════════════════════════════════════════════════════════════════

2) ESTRUCTURA DE ARCHIVOS A CREAR/MODIFICAR

   MODIFICAR:
   ├── src/app/globals.css              (añadir nuevos tokens y clases @layer)
   ├── tailwind.config.js               (extender colors y shadows)
   ├── src/app/(dashboard)/page.tsx     (usar nuevos componentes)

   CREAR:
   ├── src/shared/components/
   │   ├── DashboardHeader.tsx          (hero con gradiente)
   │   ├── MetricCard.tsx               (KPI cards mejoradas)
   │   └── SectionContainer.tsx         (wrapper para secciones)

   OPCIONAL - Extender:
   ├── src/domains/artifacts/components/ArtifactCard.tsx (añadir clases)

═══════════════════════════════════════════════════════════════════════════════════

3) CÓMO CAMBIAR LA PALETA DE COLORES (SIN TOCAR COMPONENTES)

   ESCENARIO: Cambiar de "Tech Moderno (Azul)" a "Verdant (Verde y Turquesa)"

   SOLO EDITA src/app/globals.css, sección :root:

   ```css
   :root {
     /* Cambiar tokens primarios de shadcn */
     --primary: 160 84% 39%;              /* verde turquesa */
     --primary-foreground: 160 84% 98%;

     /* Cambiar gradientes */
     --gradient-hero: linear-gradient(135deg,
       hsl(160 84% 10%) 0%,
       hsl(160 84% 20%) 50%,
       hsl(174 72% 46%) 100%);

     --gradient-button-primary: linear-gradient(135deg,
       hsl(174 72% 46%) 0%,
       hsl(160 84% 20%) 100%);

     --gradient-icon-badge: linear-gradient(135deg,
       hsl(174 72% 46%) 0%,
       hsl(160 84% 20%) 100%);

     /* Cambiar sombra temática */
     --shadow-blue: 0 10px 25px -5px hsla(174, 72%, 46%, 0.2);
   }
   ```

   ✓ LISTO. Todo el dashboard ahora usa verde/turquesa automáticamente.
   ✓ No tocaste ni un archivo de componente.
   ✓ Los componentes shadcn siguen funcionando perfectamente.

═══════════════════════════════════════════════════════════════════════════════════

4) EJEMPLO DE INTEGRACIÓN EN DASHBOARD PAGE

   Archivo: src/app/(dashboard)/page.tsx

   ```tsx
   'use client'

   import Link from 'next/link'
   import { Sparkles, FileText, ClipboardCheck, CheckCircle, AlertCircle } from 'lucide-react'
   import { Button } from '@/shared/components/ui/button'
   import { DashboardHeader } from '@/shared/components/DashboardHeader'
   import { MetricCard } from '@/shared/components/MetricCard'
   import { SectionContainer } from '@/shared/components/SectionContainer'
   import { useArtifactStats, ArtifactList } from '@/domains/artifacts'

   export default function DashboardPage() {
     const { stats, loading } = useArtifactStats()

     return (
       <div className="space-y-6">
         {/* Hero Header con gradiente */}
         <DashboardHeader
           title="Dashboard"
           subtitle="Resumen de tu actividad de generación de artefactos"
         />

         {/* Stats Cards con nuevo diseño */}
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
           <MetricCard
             icon={FileText}
             value={stats.total}
             label="Total Generados"
           />
           <MetricCard
             icon={ClipboardCheck}
             value={stats.pending_qa}
             label="Pendientes QA"
             className="border-l-4 border-l-warning"
           />
           <MetricCard
             icon={CheckCircle}
             value={stats.approved}
             label="Aprobados"
             className="border-l-4 border-l-success"
           />
           <MetricCard
             icon={AlertCircle}
             value={stats.escalated}
             label="Escalados"
             className="border-l-4 border-l-destructive"
           />
         </div>

         {/* Acciones Rápidas */}
         <SectionContainer title="Acciones Rápidas">
           <div className="flex gap-4 flex-wrap">
             <Button asChild className="btn-gradient-primary">
               <Link href="/generate">
                 <Sparkles className="mr-2 h-4 w-4" />
                 Generar Nuevo Artefacto
               </Link>
             </Button>
             <Button variant="outline" asChild>
               <Link href="/artifacts">
                 <FileText className="mr-2 h-4 w-4" />
                 Ver Todos los Artefactos
               </Link>
             </Button>
           </div>
         </SectionContainer>

         {/* Artefactos Recientes */}
         <SectionContainer title="Artefactos Recientes">
           <ArtifactList />
         </SectionContainer>
       </div>
     )
   }
   ```

═══════════════════════════════════════════════════════════════════════════════════

5) ACCESIBILIDAD Y CALIDAD

   - Mantener contraste: los tokens HSL de shadcn ya cumplen WCAG AA
   - Estados focus: ya manejados por shadcn, solo añadir ring-primary/10 extra
   - prefers-reduced-motion (añadir en globals.css):
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after {
         animation-duration: 0.01ms !important;
         transition-duration: 0.01ms !important;
       }
     }
     ```
   - Responsive: usar clases Tailwind existentes (grid, flex, gap)

═══════════════════════════════════════════════════════════════════════════════════

6) ENTREGABLES FINALES

   Al terminar, proporciona:

   a) Lista de archivos modificados/creados:
      - src/app/globals.css (MODIFICADO - añadidos tokens y clases)
      - tailwind.config.js (MODIFICADO - extendido colors/shadows)
      - src/shared/components/DashboardHeader.tsx (NUEVO)
      - src/shared/components/MetricCard.tsx (NUEVO)
      - src/shared/components/SectionContainer.tsx (NUEVO)
      - src/app/(dashboard)/page.tsx (ACTUALIZADO - usa nuevos componentes)

   b) Mapeo de componentes:
      - Hero Header → DashboardHeader (usa --gradient-hero)
      - KPI Cards → MetricCard (usa --gradient-subtle + --gradient-icon-badge)
      - Artifacts → ArtifactCard (extendido vía className)
      - Botones → Button + className="btn-gradient-primary"
      - Secciones → SectionContainer (wrapper con título subrayado)

   c) Notas de compatibilidad:
      - ✓ Tokens HSL compatibles con shadcn/ui
      - ✓ Tailwind extendido correctamente
      - ✓ Dark mode soportado (añadir tokens en .dark{})
      - ✓ No se modificaron componentes base de shadcn

   d) Guía de mantenimiento:
      "Para cambiar paleta global:
       1. Edita src/app/globals.css, sección :root
       2. Modifica --primary y --gradient-* variables
       3. No necesitas tocar componentes
       4. Cambios aplican instantáneamente"

═══════════════════════════════════════════════════════════════════════════════════

COMIENZA AHORA.
