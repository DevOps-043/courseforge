# GO-ESP Design System & Dashboard Refactor

Este documento define los estándares de diseño y la propuesta de refactorización para el Dashboard de GO-ESP, manteniendo la identidad visual existente pero optimizando el uso del espacio y elevando la estética a un nivel "Premium".

## 1. Paleta de Colores (Consistente con `globals.css`)

Se mantienen estrictamente los colores definidos en el sistema actual, asegurando coherencia.

### Colores Base (Modo Oscuro - Principal)

- **Fondo Global**: `hsl(210 25% 8%)` → `#0F1419` (Negro azulado profundo)
- **Fondo Tarjetas**: `hsl(213 16% 14%)` → `#1E2329` (Gris azulado oscuro)
- **Bordes**: `hsl(213 16% 25%)` → `#2D3339`

### Colores de Acento & Estado

- **Primario (Azul)**: `hsl(215 90% 35%)` → Azul vibrante para botones principales y acciones.
- **Verde (Aprobado/Success)**: `hsl(160 84% 39%)` → `#10B981` (Emerald)
- **Naranja (Pendiente/Warning)**: `hsl(38 92% 50%)` → `#F59E0B` (Amber)
- **Rojo (Error/Escalado)**: `hsl(0 84.2% 60.2%)` → `#EF4444` (Red)
- **Teal (Detalles/Links)**: `hsl(171 100% 42%)` → `#00D4B3` (Sofía Teal)

---

## 2. Componentes UI (Reutilizables)

### 2.1 Botones

El diseño de botones debe ser consistente y jerárquico.

- **Primario**: Gradiente Azul (`--gradient-button-primary`). Bordes redondeados (`rounded-xl`). Sombra sutil color azul.
  - _Uso_: Acciones principales ("Nuevo Artefacto", "Generar", "Guardar").
- **Secundario**: Fondo transparente con borde `border-border`. Hover con `bg-secondary`.
  - _Uso_: Acciones secundarias ("Cancelar", "Ver detalles", filtros).
- **Ghost**: Sin fondo ni borde, solo texto hover.
  - _Uso_: Iconos de acción en tablas, enlaces menos importantes.

### 2.2 Tarjetas (Cards)

El estilo actual es muy plano. Elevaremos el diseño con "Microlayering".

- **Fondo**: `#1E2329` (o variable `--card`).
- **Borde**: 1px sólido color `border-white/10` (muy sutil).
- **Shadow**: `shadow-lg` para dar profundidad sobre el fondo negro.
- **Hover**: Efecto `translateY(-2px)` y aumento de sombra para interactividad.
- **Header de Tarjeta**: Separación sutil o simplemente más espacio (padding 24px).

### 2.3 Modales (Dialogs)

- **Backdrop**: `bg-black/80` con `backdrop-blur-sm` (desenfoque del fondo).
- **Contenedor**: Centrado, borde `border-border`, sombra `shadow-2xl`.
- **Animación**: `scale-in` suave (zoom in) al abrir.

### 2.4 Dropdowns & Menús

- **Estilo**: Flotantes, fondo `bg-popover`, borde `border-border`.
- **Items**: Hover `bg-accent/10 text-accent` para feedback claro.

---

## 3. Propuesta de Refactorización del Dashboard

El diseño actual desperdicia espacio horizontal y vertical. La nueva propuesta usa un layout de **"Grid de Alta Densidad"**.

### Problemas actuales:

1. **Tarjetas de Estadísticas (KPIs)**: Son demasiado anchas y bajas, dejan mucho espacio negro vacío.
2. **Acciones Rápidas**: Ocupa una fila entera innecesariamente.
3. **Escaneabilidad**: La información está dispersa.

### Nuevo Layout (Propuesta)

La estructura será de **3 Columnas** (Layout asimétrico 2/3 + 1/3) en pantallas grandes.

#### **Zona A: Panel Principal (Izquierda - 70% ancho)**

1.  **Header Compacto**: Título "Dashboard" + Botones de Acción Global ("Nuevo Artefacto") alineados a la derecha en la misma línea. _Elimina la necesidad de la sección dedicada "Acciones Rápidas"._
2.  **Grid de KPIs (Stat Cards)**:
    - 4 Tarjetas en una sola fila (grid-cols-4).
    - Diseño más cuadrado. Icono grande a la izquierda (con fondo de color tenue), Número gigante, Etiqueta pequeña abajo.
    - Borde de color (indicator) solo a la izquierda o arriba (como en el actual, pero más refinado).
3.  **Tabla de Artefactos Recientes**:
    - Ocupa el resto del espacio central.
    - Diseño de tabla limpia sin líneas verticales divisorias.
    - Badges de estado (Aprobado/Pendiente) con colores pasteles/transparente (`bg-green-500/20 text-green-400`).

#### **Zona B: Panel Lateral (Derecha - 30% ancho)**

1.  **Actividad Reciente (Timeline)**:
    - Lista vertical de eventos (logs).
    - Aprovecha la altura de la pantalla.
    - Cada item es compacto: Icono pequeño + Texto + "Hace 2h".
    - Fondo ligeramente más oscuro o separado visualmente.
2.  **Estado del Sistema / Cola QA**:
    - Pequeño resumen de la cola de QA si aplica.

### Comparativa de Espacio

| Diseño Actual                             | Diseño Propuesto                                                       |
| :---------------------------------------- | :--------------------------------------------------------------------- |
| KPIs ocupan 2 filas visuales (mucho aire) | KPIs en 1 fila compacta y elegante                                     |
| "Acciones Rápidas" es un bloque gigante   | Botones integrados en el Header (ahorro 100px vertical)                |
| Actividad y Artefactos compiten abajo     | Artefactos al centro (protagonista), Actividad a la derecha (contexto) |

## 4. Implementación CSS (Snippets para copiar)

Para lograr el look "Premium":

```css
/* Clase para el contenedor de Stats "Mejorado" */
.stat-card-premium {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 16px;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s ease;
}
.stat-card-premium:hover {
  border-color: hsl(var(--primary) / 0.5);
  transform: translateY(-2px);
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
}

/* Efecto Glass sutil para paneles si se desea */
.glass-panel {
  background: hsla(213, 16%, 14%, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
```

Esta estructura mantiene los colores exactos pero organiza la información de manera profesional y densa, típica de dashboards SaaS modernos.
