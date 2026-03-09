# LMS – Daily Pulse | 07 Marzo 2026

**Estado:** 🟢/🟡 (Sistema funcional tras migración de rutas, resolviendo bloqueos de base de datos P0)

## 1. Reporte Diario (Versión Corta)

- **✅ Done hoy:**
  - Refactorización completa de la ruta `/constructor` a `/builder` (renombrado de folders y actualización de redirecciones).
  - Ajuste dinámico de `basePath` en componentes compartidos (`ArtifactsList`, `ArtifactClientView`) para soportar navegación fluida entre Admin y Builder.
  - **P0:** Corrección de restricción de clave foránea en la tabla `artifacts` que bloqueaba la creación para usuarios del Auth Bridge (migración `20260307160000_fix_user_fk_constraints.sql`).
  - Sincronización manual de secuencias de identidad para `model_settings`.
  - Pruebas de QA en **SofLIA Hub**: Reporte de detalles visuales, validaciones de prompt y funcionamientos informado a Fernando.
- **🧪 Ready for QA:**
  - Flujo de generación de artefactos bajo la nueva ruta `/builder`.
- **🚨 P0 abiertos:**
  - Debug de "Unauthorized (No User)" en Server Actions debido a la falta de la cookie `cf_access_token` en el contexto del servidor.
- **🔧 Foco siguiente:** Estabilización de la persistencia de sesión para el Auth Bridge.
- **⚠️ Bloqueo/Riesgo:** Inconsistencia en la persistencia de cookies entre entornos.
- **🧭 Acción requerida:** Ninguna inmediata más allá de la revisión de logs de auth.
- **🔗 Tablero + evidencia:** [Notion Link]

---

## 2. Resumen Extenso (Detalles Técnicos)

### Infraestructura y Refactorización de Rutas

Se realizó una limpieza profunda de las rutas para alinearlas con la nueva arquitectura del producto:

- **Carpeta `/builder`:** Se renombró físicamente la carpeta `/constructor` y se actualizaron todos los archivos internos para referenciar `/builder/artifacts` en lugar de `/constructor/artifacts`.
- **Componentes Agnosticos:** Se modificaron `ArtifactsList.tsx` y `ArtifactClientView.tsx` para aceptar un prop `basePath`. Esto permite que el mismo componente funcione tanto en el panel de administrador como en el del constructor, evitando enlaces rotos.
- **Navegación:** Se corrigieron los "Back buttons" y redirecciones automáticas tras la generación exitosa.

### Base de Datos y Autenticación (Bloqueos P0)

Se resolvieron varios problemas críticos detectados durante las pruebas:

- **Fkey Constraint:** Los usuarios autenticados mediante el Auth Bridge no podían crear registros porque la tabla `artifacts` exigía una relación con `auth.users` (donde estos usuarios no existen localmente). Se aplicó una migración para cambiar la referencia a `public.profiles`.
- **Model Settings Identity:** Se corrigió un error donde la inserción manual de registros rompió la secuencia de autoincremento de los IDs.
- **Auth Debugging:** Se implementó un sistema de trazabilidad en `session.ts` y `actions.ts` para rastrear el ciclo de vida del JWT. Se detectó que la cookie de acceso no se está propagando correctamente en las llamadas a Server Actions desde el lado del servidor.

### Pruebas SofLIA Hub (QA Adicional)

Fuera del roadmap directo de Notion, se realizaron pruebas de estrés y consistencia en el Hub:

- **Visual:** Ajustes en la jerarquía visual de los componentes de producción.
- **Validaciones de Prompt:** Se refinaron las validaciones para asegurar que los prompts de instrucción no generen contenido redundante.
- **Feedback:** Todos los hallazgos fueron comunicados directamente a Fernando para su integración.

---

_Reporte generado por Antigravity (Assistant)._
