# Reporte Extenso de Actividades - 06 de Marzo 2026

## 1. Seguridad y Control de Acceso al Panel de Administración

- **Sincronización de Usuarios al Login**: Se modificó el flujo de autenticación (`login/actions.ts`) para que, tras validar credenciales contra SofLIA, los datos del usuario se sincronicen automáticamente vía UPSERT en la tabla local `profiles` de CourseForge. El rol por defecto para nuevos usuarios es `CONSTRUCTOR`, y los roles existentes no se sobrescriben.
- **Restricción del Panel Admin**: Se actualizó `admin/layout.tsx` para que el acceso al panel administrativo dependa **exclusivamente** del `platform_role` local (`ADMIN`), eliminando la dependencia en los roles genéricos del puente de SofLIA (`cargo_rol`), los cuales eran demasiado permisivos y representaban un riesgo de seguridad.
- **Persistencia de Cambios de Rol**: Se creó el endpoint `POST /api/admin/users` (`route.ts`) y se conectó al componente `UsersTable.tsx` para que los cambios de rol realizados desde la interfaz de administración se guarden en la base de datos. Antes, los cambios se perdían al recargar la página.

## 2. Corrección del Botón de Sincronización de Videos (Paso de Publicar)

- **Diagnóstico**: Se identificó que el botón ⟳ ("Sincronizar desde Producción") solo actualizaba 1-2 lecciones de N. La causa raíz era que `syncVideoDuration()` utilizaba `document.createElement('video')` en el navegador, provocando fallos silenciosos por CORS en videos de Supabase Storage y saturación de conexiones simultáneas del browser.
- **Fix Aplicado en `PublicationClientView.tsx`**: Se reescribió `handleConfirmReset` para procesar los 3 tipos de video:
  - **YouTube/Vimeo**: Duración obtenida vía server action `fetchVideoMetadata` (secuencialmente, evitando rate-limiting).
  - **Videos Subidos (Supabase/MP4)**: Si producción ya guardó la duración (`auto_duration`), se utiliza directamente. Si es 0, se intenta detección client-side con timeout de 15 segundos.
  - Todas las lecciones se procesan secuencialmente y el estado se actualiza una sola vez al final.
- **`crossOrigin = 'anonymous'`**: Se agregó este atributo a todos los `createElement('video')` en 3 archivos (`PublicationClientView.tsx`, `ProductionAssetCard.tsx`, `VideoMappingList.tsx`) para que el navegador pueda cargar metadatos de Supabase Storage sin bloqueos CORS.

## 3. Planificación de Roles Superadmin y Admin de Empresa

- **Documento de Planificación**: Se creó `PLANNING_ROLES_SUPERADMIN.md` en la raíz del proyecto con la estructura técnica para la futura implementación de roles multi-nivel: Superadmin (dueño de la plataforma) y Admin de Empresa (cliente B2B). Incluye modificaciones a BD, flujos de creación de usuarios, y fases de implementación estimadas.

---

---

# Reporte Formato Corto Mensajería (LMS – Daily Pulse)

**LMS – Daily Pulse | 06 Marzo 2026**
**Estado:** 🟢 Estable | Se cerró una vulnerabilidad de acceso al panel admin y se reparó la sincronización masiva de videos.
**✅ Done hoy:** 3 (P0: Restricción de acceso admin por rol local, sincronización de usuarios al login. P1: Fix completo del botón de reset de videos/duraciones, soporte para videos subidos).
**🧪 Ready for QA:** Control de acceso admin basado en `platform_role`, persistencia de cambios de rol desde UI, sincronización completa de videos y duraciones en Publicar (YouTube, Vimeo, MP4/Supabase).
**🚨 P0 abiertos:** 1 — Requiere ejecución de SQL para desacoplar FK de `profiles` → `auth.users` antes de probar en staging.
**🔧 Foco siguiente:** Validar flujo completo de login → sync → admin con datos reales, probar botón ⟳ con artefactos de 5+ lecciones mixtas.
**⚠️ Bloqueo/Riesgo:** Ejecutar `ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey; ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey1;` en la BD de CourseForge.
**🧭 Acción requerida:** Confirmación de ejecución del SQL mencionado para habilitar la sincronización de usuarios desde SofLIA.
**🔗 Tablero + evidencia:** [URL_AL_TABLERO]
