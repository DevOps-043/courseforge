
# Estado del Módulo de Publicación (Paso 7: Publicar)

Este documento detalla el estado actual de la implementación de la vista de publicación y configuración final del curso antes de su envío a Soflia.

## ✅ Funcionalidades Implementadas

### 1. Gestión de Datos del Curso
- **Formulario de Metadatos**: Interfaz para editar Categoría, Nivel, Email del Instructor, Slug del curso y Precio.
- **Carga de Portada (Thumbnail)**: 
  - Soporte para Drag & Drop.
  - Subida directa a Supabase Storage (bucket `thumbnails`).
  - Previsualización inmediata de la imagen cargada.
  - Validación de tamaño de archivo (Max 5MB).

### 2. Mapeo y Sincronización de Videos
- **Detección Automática**: El sistema escanea los materiales generados en pasos anteriores (Paso 5/6) para pre-llenar URLs de video de YouTube o Vimeo.
- **Sincronización Inteligente de Duración**:
  - **Auto-Sync al Cargar**: Al abrir la página, el sistema verifica automáticamente los videos de YouTube/Vimeo. Si detecta duraciones inválidas (00:00) o desactualizadas, obtiene la duración real vía oEmbed/Scraping y **guarda la corrección automáticamente** en la base de datos.
  - **Botón de Sincronización Manual**: Permite actualizar la duración de un video específico bajo demanda.
  - **Formateo**: Manejo visual de tiempos en formato `MM:SS`.

### 3. Interfaz y UX (Experiencia de Usuario)
- **Modo Oscuro Completo**: Todos los componentes (inputs, modales, alertas, textos) están adaptados para temas claro y oscuro con alto contraste.
- **Modal de Confirmación**: Se reemplazó el `confirm()` nativo por un componente `ConfirmationModal` estilizado para acciones destructivas (Reset).
- **Notificaciones**: Feedback visual mediante `Sonner` (Toasts) para guardar borrador, errores y sincronizaciones exitosas.
- **Validación de Estado**:
  - Panel de alerta que indica qué datos faltan para poder publicar (ej. "Falta email instructor").
  - Botón "Enviar a Soflia" deshabilitado hasta cumplir todos los requisitos.

### 4. Persistencia y Backend
- **Guardado de Borrador**: Acción de servidor (`savePublicationDraft`) funcional que persiste el estado completo en la tabla `publication_requests` como JSONB.
- **Resiliencia**: Solución de problemas de concurrencia y errores de cliente Supabase en Server Actions.

---

## 🚧 Pendiente / Próximos Pasos (Fase 3)

### 1. Integración Real con Soflia
- **Estado Actual**: La función `publishToSoflia` es un placeholder (simulacro).
- **Requerimiento**: Implementar la llamada API real al endpoint de importación de Soflia (`POST /api/courses/import` en el sistema destino) para crear el curso, módulos y lecciones remotamente.

### 2. Validaciones Avanzadas
- **Unicidad de Slug**: Verificar si el slug ya existe en Soflia antes de permitir el envío.
- **Instructor**: Validar que el email del instructor realmente exista en la base de datos de usuarios de Soflia.

### 3. Optimización de Videos
- **Soporte Transcoding**: Actualmente se asume que los videos directos (MP4) son accesibles públicamente. En el futuro podría requerirse subir los videos a una CDN propia si no están alojados externamente.

---
**Última Actualización**: 28 Enero 2026
