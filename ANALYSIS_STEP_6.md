# Análisis e Implementación del Paso 6: Generación de Materiales Visuales

## 1. Situación Actual
El sistema actual completa el **Paso 5 (Generación de Materiales)**, produciendo componentes de tipo:
- `VIDEO_THEORETICAL`
- `VIDEO_DEMO`
- `VIDEO_GUIDE`
- `DEMO_GUIDE`

Estos componentes contienen en su campo `content` (JSON) la estructura necesaria: `script` (guion) y `storyboard` (guion gráfico). Actualmente, el flujo se detiene aquí. No existe una interfaz para la **Fase 3.1 (Producción)** donde estos guiones se convierten en activos finales (Slides, Videos, Screencasts).

## 2. Objetivos del Paso 6
Implementar una interfaz "Producción Visual" que permita:
1.  **Visualizar** el Storyboard y Guion generado en el Paso 5.
2.  **Facilitar** la creación de Slides en Gamma (workflow manual).
3.  **Asistir** en la creación de B-roll (workflow mixto IA/Manual).
4.  **Guiar** la grabación de Screencasts (workflow manual).
5.  **Almacenar** los enlaces/archivos de los activos finales producidos (`slides_url`, `video_url`, etc.).

## 3. Propuesta de Implementación

### 3.1. Modelo de Datos (Backend)
Se requiere persistir los activos generados. Se propone añadir un campo `assets` a la tabla `material_components`.

**Schema Change:**
```sql
ALTER TABLE public.material_components ADD COLUMN assets jsonb DEFAULT '{}'::jsonb;
```

**Estructura del JSON `assets`:**
```typescript
interface MaterialAssets {
  slides_url?: string;      // URL de la presentación en Gamma/PDF
  b_roll_prompts?: string;  // Prompts generados para Flow (si aplica)
  video_url?: string;       // URL del video final (B-roll acumulado o final)
  screencast_url?: string;  // URL de la grabación de pantalla
  notes?: string;           // Notas de producción
}
```

### 3.2. Interfaz de Usuario (Frontend)
Se creará un nuevo contenedor `VisualProductionContainer` integrado en `ArtifactClientView` como el **Paso 6**.

**Características de la UI:**
- **Lista de Tareas de Producción**: Filtrar componentes que requieren producción visual (`VIDEO_*`, `DEMO_GUIDE`).
- **Vista de Detalle por Componente**:
    - **Panel Izquierdo**: Visualización del Script/Storyboard (solo lectura, referencia).
    - **Panel Derecho**: Herramientas de Producción.
        - **Sección Slides (Gamma)**:
            - Botón "Copiar Estructura para Gamma" (copia el texto del storyboard optimizado para pegar en Gamma).
            - Input "URL de Slides" (para guardar el link del resultado).
        - **Sección B-roll (Flow)**:
            - Vizualización de descripciones visuales del Storyboard.
            - Botón **"Generar Prompts para Flow"**: Llama a una `Server Action` que usa Gemini para transformar las descripciones del Storyboard en prompts detallados de video (estilo Midjourney/Runway/Flow).
            - Área de texto editable con los prompts generados.
            - Input "URL de Video B-roll".
        - **Sección Screencast**:
            - Guía paso a paso (basada en `DEMO_GUIDE` steps).
            - Input "URL de Screencast".

### 3.3. Integración con IA (Gemini)
Se implementará una nueva "Skill" o Prompt Template para la generación de prompts de video.
- **Entrada**: Segmentos del Storyboard (Visual Description + Mood).
- **Salida**: Prompts técnicos para herramientas de generación de video (Flow/Runway/VEO).

**Ejemplo de Prompt System**:
"Actúa como un experto en ingeniería de prompts para generación de video. Toma la siguiente descripción de escena de un storyboard educativo y genera un prompt detallado para una IA de video, especificando iluminación, estilo (fotorealista, cinemático), movimiento de cámara y sujeto..."

## 4. Plan de Trabajo

1.  **Base de Datos**: Ejecutar migración para campo `assets`.
2.  **Tipos**: Actualizar interfaces en TypeScript.
3.  **Backend**: Crear `generateBrollPromptsAction` usando el SDK de Gemini.
4.  **Frontend**:
    - Habilitar Paso 6 en `ArtifactClientView`.
    - Crear componente `VisualProductionContainer`.
    - Implementar lógica de UI (copiar, guardar, generar).

## 5. Análisis de Factibilidad
- **Gamma**: Al no tener API pública abierta/fácil, el enfoque "Copiar" + "Input de URL" es el correcto.
- **Gemini para Prompts**: Totalmente factible con la infraestructura actual.
- **Flow**: Asumimos uso manual (copiar prompts generados -> pegar en Flow).

Este enfoque cumple con el requerimiento de "hacerlo paso a paso" y respetar el flujo manual donde es necesario, pero potenciándolo con IA donde es posible (textos, prompts).
