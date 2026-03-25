# Task: Multi-Org Switching Implementation

> **Referencia:** `MULTI-ORG-SWITCHING-ARCHITECTURE.md`
> **Inicio:** 2026-03-24
> **Branch:** `feat/triple-GUI`

---

## Fase 1: Infraestructura de Cambio de Sesión (Backend) — COMPLETADA

### 1.1 Endpoint `POST /api/auth/switch-organization`
- **Archivo:** `apps/web/src/app/api/auth/switch-organization/route.ts` (nuevo)
- **Qué hace:**
  1. Verifica JWT actual desde cookie `cf_access_token` (jose `jwtVerify`)
  2. Valida que `organizationId` esté en `app_metadata.organization_ids` del JWT
  3. Obtiene datos de la org desde cookie `cf_user_orgs`
  4. Firma nuevo JWT con `active_organization_id` actualizado (jose `SignJWT`)
  5. Actualiza cookies: `cf_access_token` (nuevo JWT) + `cf_active_org` (nuevo ID)
  6. Retorna `{ success, organization: { id, name, slug, role } }`

### 1.2 Actualización de `organizationStore.ts`
- **Archivo:** `apps/web/src/core/stores/organizationStore.ts` (modificado)
- **Cambios:**
  - `switchOrganization()` ahora es `async` y llama a `POST /api/auth/switch-organization`
  - Nuevo estado `isSwitching` para loading states durante el cambio
  - Nuevo método `canSwitch()` — retorna `true` si `organizations.length > 1`

### 1.3 Actualización de `useAuth` hook
- **Archivo:** `apps/web/src/features/auth/hooks/useAuth.ts` (modificado)
- **Cambios:**
  - Expone `isSwitching` (boolean) para estados de carga en UI
  - Expone `canSwitch` (boolean) para mostrar/ocultar el switcher

---

## Fase 2: Componentes de UI (Frontend) — COMPLETADA

### 2.1 Componente `OrganizationSwitcher`
- **Archivo:** `apps/web/src/components/OrganizationSwitcher.tsx` (nuevo)
- **Estado:** COMPLETADO
- **Qué hace:**
  1. Lee `organizations`, `activeOrganizationId`, `isSwitching` desde `useOrganizationStore`
  2. Si solo hay 1 org → muestra label estático (sin dropdown)
  3. Si hay múltiples orgs → dropdown con lista, check en la activa, loading spinner al cambiar
  4. Al seleccionar otra org → llama `switchOrganization()` → `window.location.reload()` para refrescar datos
  5. `OrgAvatar` subcomponente: muestra `logo_url` o inicial con gradiente
  6. Soporta modo `collapsed` para sidebar colapsado
  7. Click-outside cierra el dropdown

### 2.2 Integración en `SharedSidebarLayout`
- **Archivo:** `apps/web/src/components/layout/SharedSidebarLayout.tsx` (modificado)
- **Estado:** COMPLETADO
- **Ubicación:** Entre el header (logo/título) y la navegación, separado con `border-b`
- **Comportamiento:** Solo visible cuando sidebar está expandido (`isOpen`)

### 2.3 Página de selección post-login (opcional)
- **Estado:** PENDIENTE (baja prioridad — el switcher en sidebar cubre el caso principal)

---

## Fase 3: Consistencia de Filtrado de Datos — COMPLETADA

### 3.1 Auditoría de queries — Gaps encontrados y corregidos

| Archivo | Función | Gap | Fix |
|---------|---------|-----|-----|
| `admin/artifacts/actions.ts` | `regenerateArtifactAction` | SELECT + UPDATE sin org filter | Añadido `.eq('organization_id', activeOrgId)` |
| `admin/artifacts/actions.ts` | `updateArtifactContentAction` | UPDATE sin org filter | Añadido `.eq('organization_id', activeOrgId)` |
| `admin/artifacts/actions.ts` | `updateArtifactStatusAction` | UPDATE sin org filter | Añadido `.eq('organization_id', activeOrgId)` |
| `admin/artifacts/[id]/page.tsx` | Page load | SELECT por ID, verificación post-fetch | Movido a filtro en query directamente |
| `admin/artifacts/[id]/publish/actions.ts` | `getPublicationData` | SELECT sin org filter | Añadido `.eq('organization_id', activeOrgId)` |
| `admin/profile/page.tsx` | Profile page | COUNT sin org filter | Añadido `.eq('organization_id', activeOrgId)` |

**Queries ya correctas (no requirieron cambios):**
- `admin/artifacts/page.tsx` — lista artefactos con org filter
- `admin/page.tsx` — conteo dashboard con org filter
- `admin/library/actions.ts` — búsqueda de materiales con org filter
- `admin/settings/actions.ts` — model_settings y system_prompts con org filter
- `architect/artifacts/page.tsx` — lista con org filter
- `builder/artifacts/page.tsx` — lista con org filter
- `api/lia/route.ts` — model_settings con org filter

**Nota sobre Netlify Functions:** Usan `SUPABASE_SERVICE_ROLE_KEY` que bypasea RLS. Operan sobre artifact IDs ya validados en la capa de aplicación.

### 3.2 Auditoría RLS — Migración creada

**Archivo:** `supabase/migrations/20260325000001_add_org_rls_child_tables.sql`

**Tablas aseguradas:**

| Tabla | Antes | Después |
|-------|-------|---------|
| `syllabus` | Sin RLS | RLS via `artifacts.organization_id` |
| `instructional_plans` | RLS permisivo (`USING (true)`) | RLS via `artifacts.organization_id` |
| `curation` | Sin RLS | RLS via `artifacts.organization_id` |
| `curation_rows` | Sin RLS | RLS via `curation → artifacts.organization_id` |
| `materials` | Sin RLS | RLS via `artifacts.organization_id` |
| `material_lessons` | Sin RLS | RLS via `materials → artifacts.organization_id` |
| `material_components` | Sin RLS | RLS via `material_lessons → materials → artifacts.organization_id` |
| `publication_requests` | Sin RLS | RLS via `artifacts.organization_id` |

**Helper function creada:** `public.get_active_org_id()` — extrae `active_organization_id` del JWT con fallback a `app_metadata`.

**Backward compatibility:** Todas las policies permiten `organization_id IS NULL` para artefactos legacy pre-multitenancy.

---

## Fase 4: Mejoras de UX — COMPLETADA

### 4.1 Indicador persistente de org activa
- **Estado:** COMPLETADO
- Sidebar colapsado muestra `OrgAvatar` con tooltip (nombre de la org al hover)
- Sidebar expandido muestra nombre + rol + chevron

### 4.2 Transición suave al cambiar org
- **Estado:** COMPLETADO
- Overlay fullscreen con `createPortal` al `document.body` (z-index 9999)
- Spinner + mensaje "Cambiando a **OrgName**..." con backdrop blur
- Se muestra hasta que `window.location.reload()` completa el cambio

### 4.3 Persistencia de última org en localStorage
- **Estado:** COMPLETADO
- Key: `cf_last_org` en localStorage
- `OrganizationSwitcher` escribe al cambiar org activa (`useEffect`)
- `organizationStore.loadFromCookies()` lee como fallback: cookie > localStorage > primera org
- Validación: si el ID guardado no existe en la lista del usuario, se ignora

---

## Notas Técnicas

- **JWT Secret:** Usa `COURSEFORGE_JWT_SECRET` (env var) para firmar/verificar
- **RLS:** Las policies leen `active_organization_id` desde `current_setting('request.jwt.claims')::json->>'active_organization_id'`
- **Cookies:** `cf_access_token` (httpOnly), `cf_active_org` (httpOnly), `cf_user_orgs` (readable by client)
- **Errores pre-existentes:** Type errors en `scripts/` y `actions.ts` no relacionados con esta implementación
