Actúa como Senior Frontend Engineer. 

OBJETIVO: rediseñar el UI del dashboard GO-ESP-01 de "blanco plano" a "moderno y dinámico", 
manteniendo intacta la lógica/funcionalidad. PRIORIDAD: usar un sistema de design tokens 
centralizado para que cualquier cambio de paleta sea global y sin tocar múltiples archivos.

STACK: asume Next.js + React + Tailwind (si no existe Tailwind, no lo instales: usa CSS global / CSS modules). 
No cambies rutas, nombres de endpoints, ni el data fetching; solo UI.

═══════════════════════════════════════════════════════════════════════════════════

0) DESIGN TOKENS CENTRALIZADOS (PASO CRÍTICO - PRIMERO)
   
   Crea un sistema escalable de colores que permita cambios globales sin editar componentes:

   OPCIÓN A (Recomendado): CSS Variables + Archivo de Configuración
   ─────────────────────────────────────────────────────────────
   a) Crea /styles/tokens.css con variables CSS organizadas por categoría:
   
      /* Color Palette */
      :root {
        /* Primary & Neutral */
        --token-primary: #1F2937;
        --token-primary-dark: #111827;
        --token-primary-light: #374151;
        --token-secondary: #3B82F6;
        --token-secondary-light: #60A5FA;
        --token-secondary-lighter: #DBEAFE;
        
        /* Semantic Colors */
        --token-success: #10B981;
        --token-success-light: #D1FAE5;
        --token-success-lighter: #A7F3D0;
        --token-warning: #F59E0B;
        --token-warning-light: #FEF3C7;
        --token-warning-lighter: #FCD34D;
        --token-danger: #EF4444;
        --token-danger-light: #FECACA;
        --token-danger-lighter: #FCA5A5;
        
        /* Backgrounds */
        --token-bg-primary: #F9FAFB;
        --token-bg-secondary: #F3F4F6;
        --token-bg-tertiary: #FFFFFF;
        
        /* Borders */
        --token-border-light: #E5E7EB;
        --token-border-lighter: #F3F4F6;
        
        /* Text */
        --token-text-primary: #1F2937;
        --token-text-secondary: #6B7280;
        --token-text-tertiary: #9CA3AF;
        
        /* Semantic Shadows */
        --token-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        --token-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        --token-shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        --token-shadow-blue: 0 10px 25px -5px rgba(59, 130, 246, 0.2);
      }
      
      /* Gradients (nombradas para fácil cambio) */
      :root {
        --gradient-hero: linear-gradient(135deg, #1F2937 0%, #111827 50%, #3B82F6 100%);
        --gradient-subtle: linear-gradient(135deg, #FFFFFF 0%, #F9FAFB 100%);
        --gradient-badge-success: linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%);
        --gradient-badge-warning: linear-gradient(135deg, #FEF3C7 0%, #FCD34D 100%);
        --gradient-badge-danger: linear-gradient(135deg, #FECACA 0%, #FCA5A5 100%);
        --gradient-button-primary: linear-gradient(135deg, #3B82F6 0%, #1F2937 100%);
        --gradient-icon-badge: linear-gradient(135deg, #3B82F6 0%, #1F2937 100%);
      }

   b) Crea /config/colors.ts (TypeScript) para acceso programático:
   
      export const COLORS = {
        primary: '#1F2937',
        primaryDark: '#111827',
        secondary: '#3B82F6',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        bg: {
          primary: '#F9FAFB',
          secondary: '#F3F4F6',
          card: '#FFFFFF',
        },
        text: {
          primary: '#1F2937',
          secondary: '#6B7280',
          tertiary: '#9CA3AF',
        },
      } as const;

      export const GRADIENTS = {
        hero: 'linear-gradient(135deg, #1F2937 0%, #111827 50%, #3B82F6 100%)',
        buttonPrimary: 'linear-gradient(135deg, #3B82F6 0%, #1F2937 100%)',
        // ... resto de gradientes
      } as const;

   c) En globals.css, importa /styles/tokens.css primero:
      @import './tokens.css';
      /* resto de estilos globales */

   VENTAJA: cambiar --token-primary en un único lugar actualiza TODO el sitio.

═══════════════════════════════════════════════════════════════════════════════════

1) COMPONENTES UI A CREAR/REFACTORIZAR (USANDO TOKENS)

A) DashboardHeader / Hero
   - Fondo: var(--gradient-hero)
   - Bordes 20px, padding amplio, texto blanco
   - Añade 2 "radial glow blobs" (azul y verde) con pseudo-elementos (before/after)
   - Mantén responsive.

B) MetricCard (KPI Cards)
   - Fondo: var(--gradient-subtle), radius 16px, shadow: var(--token-shadow-md)
   - Borde: 1px solid rgba(59, 130, 246, 0.1); hover: rgba(59, 130, 246, 0.3)
   - "halo" radial azul (var(--token-secondary)) con pseudo-elemento en esquina superior derecha
   - Icono badge 48px con background: var(--gradient-icon-badge)
   - Tipografía: valor grande (≈48px, bold, color: var(--token-text-primary)), label uppercase

C) ArtifactCard
   - Card: background: var(--token-bg-tertiary), radius 16px, padding 20px
   - Borde izquierdo 4px (var(--token-secondary)); hover: var(--token-success)
   - Top bar 3px con gradiente que aparece en hover
   - Hover: translateX(8px) + box-shadow: var(--token-shadow-blue)
   - Status badges (usar variables semánticas):
     aprobado: background: var(--gradient-badge-success), color: #065F46
     pendiente: background: var(--gradient-badge-warning), color: #92400E
     escalado: background: var(--gradient-badge-danger), color: #7F1D1D
   - Footer: border-top 1px var(--token-border-lighter), color: var(--token-text-secondary)

D) Buttons
   - Primary: background: var(--gradient-button-primary), radius 10px, 
     box-shadow: var(--token-shadow-blue), hover: lift + ripple
   - Secondary: background: transparent, border: 2px solid var(--token-secondary),
     color: var(--token-secondary), hover: background: rgba(59,130,246,0.1)

E) Inputs / Textareas
   - Background: var(--token-bg-secondary), border: 2px solid var(--token-border-light), 
     radius 12px, placeholder: color: var(--token-text-tertiary)
   - Focus: border: 2px solid var(--token-secondary), ring: rgba(59, 130, 246, 0.1), 
     translateY(-2px)

F) Sidebar + NavItem
   - Sidebar: background: linear-gradient(180deg, var(--token-bg-primary) 0%, 
     var(--token-bg-secondary) 100%), border-right: 1px solid var(--token-border-light)
   - NavItem hover: background: rgba(59, 130, 246, 0.1)
   - NavItem active: background: var(--gradient-button-primary), color: white
   - Indicador: barra 3px solid var(--token-secondary) con animación scaleY

G) Section Container
   - Card: background: var(--token-bg-tertiary), radius 16px, padding 32px, 
     box-shadow: var(--token-shadow-md), border: 1px solid var(--token-border-lighter)
   - SectionTitle: subrayado con pseudo-elemento (línea: 4px, color: var(--token-secondary))

═══════════════════════════════════════════════════════════════════════════════════

2) ESTRUCTURA DE CARPETAS RECOMENDADA

styles/
  ├── tokens.css          (todas las variables CSS)
  ├── globals.css         (reset + importa tokens)
  └── components.module.css (si necesitas CSS modules específicos)

config/
  └── colors.ts           (exporta colores para componentes dinámicos)

components/
  ├── DashboardHeader.tsx
  ├── MetricCard.tsx
  ├── ArtifactCard.tsx
  ├── Button.tsx
  ├── Input.tsx
  ├── Sidebar.tsx
  └── SectionContainer.tsx

═══════════════════════════════════════════════════════════════════════════════════

3) CÓMO CAMBIAR LA PALETA DE COLORES (SIN TOCAR COMPONENTES)

ESCENARIO: El cliente quiere cambiar de "Tech Moderno (Azul)" a "Verdant (Verde y Turquesa)"

SOLO EDITA /styles/tokens.css:

:root {
  /* Cambio 1: Primarios */
  --token-primary: #065F46;        /* verde oscuro */
  --token-primary-dark: #064E3B;
  --token-secondary: #14B8A6;      /* turquesa */
  --token-secondary-light: #2DD4BF;
  
  /* Cambio 2: Semánticos */
  --token-success: #10B981;
  /* ... resto igual */
  
  /* Cambio 3: Gradientes */
  --gradient-hero: linear-gradient(135deg, #065F46 0%, #064E3B 50%, #14B8A6 100%);
  --gradient-button-primary: linear-gradient(135deg, #14B8A6 0%, #065F46 100%);
  /* ... resto */
}

✓ LISTO. Todo el dashboard ahora usa verde/turquesa automáticamente.
✓ No tocaste ni un archivo de componente.
✓ Puedes revertir en 30 segundos.

═══════════════════════════════════════════════════════════════════════════════════

4) INTEGRACIÓN EN COMPONENTES

Ejemplo (MetricCard.tsx):

export const MetricCard = ({ icon, value, label }) => (
  <div className="metric-card">
    <div className="metric-icon-badge">
      {icon}
    </div>
    <h3 className="metric-value">{value}</h3>
    <p className="metric-label">{label}</p>
  </div>
);

Ejemplo (MetricCard.module.css o en globals.css):

.metric-card {
  background: var(--gradient-subtle);
  border-radius: 16px;
  border: 1px solid rgba(59, 130, 246, 0.1);
  padding: 20px;
  box-shadow: var(--token-shadow-md);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.metric-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: var(--token-shadow-blue);
  transform: translateY(-4px);
}

.metric-icon-badge {
  background: var(--gradient-icon-badge);
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  margin-bottom: 16px;
}

.metric-value {
  font-size: 48px;
  font-weight: 700;
  color: var(--token-text-primary);
  line-height: 1.2;
}

.metric-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--token-text-secondary);
  text-transform: uppercase;
  margin-top: 8px;
}

═══════════════════════════════════════════════════════════════════════════════════

5) ACCESIBILIDAD Y CALIDAD

- Contraste suficiente: texto primario (color: var(--token-text-primary)) sobre fondos claros ✓
- Estados focus: outline: 2px solid var(--token-secondary) ✓
- prefers-reduced-motion:
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
- Responsive: grid auto-fit; no overflow; padding relativo ✓

═══════════════════════════════════════════════════════════════════════════════════

6) ENTREGABLES FINALES

Al terminar, proporciona:

a) Lista de archivos creados/modificados
   - /styles/tokens.css (NUEVO - el corazón del sistema)
   - /config/colors.ts (NUEVO)
   - /components/DashboardHeader.tsx (CREADO/ACTUALIZADO)
   - /components/MetricCard.tsx (CREADO/ACTUALIZADO)
   - ... [resto de componentes]
   - /pages/dashboard.tsx (ACTUALIZADO - usa nuevos componentes)
   - /styles/globals.css (ACTUALIZADO - importa tokens.css)

b) Breve explicación de mapeo:
   - Hero Header → DashboardHeader (usa --gradient-hero + pseudo-elementos)
   - KPI Cards → MetricCard (usa --gradient-subtle + --gradient-icon-badge)
   - Artifacts → ArtifactCard (usa variables semánticas para status)
   - Botones → Button (usa --gradient-button-primary)
   - Inputs → Input (usa --token-bg-secondary + focus con --token-secondary)
   - Sidebar → Sidebar (usa --token-bg-primary/secondary + indicador activo)

c) Notas de compatibilidad:
   - ✓ CSS Variables funcionan con cualquier nombre de clase (Tailwind o CSS modules)
   - ✓ Si usas Tailwind, puedes extender theme.colors en tailwind.config.js con vars()
   - ✓ Fallback: si faltan vars CSS, se aplican colores hardcoded de respuesta

d) BONUS - Guía de mantenimiento:
   "Para cambiar paleta global en el futuro: edita /styles/tokens.css, 
    líneas X-Y. No necesitas tocar componentes. Los cambios aplican instantáneamente."

═══════════════════════════════════════════════════════════════════════════════════

COMIENZA AHORA.