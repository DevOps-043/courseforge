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

## Fase 2: Componentes de UI (Frontend) — EN PROGRESO

### 2.1 Componente `OrganizationSwitcher`
- **Archivo:** `apps/web/src/components/OrganizationSwitcher.tsx` (nuevo)
- **Estado:** EN PROGRESO

### 2.2 Integración en `SharedSidebarLayout`
- **Archivo:** `apps/web/src/components/layout/SharedSidebarLayout.tsx` (modificar)
- **Estado:** PENDIENTE

### 2.3 Página de selección post-login (opcional)
- **Estado:** PENDIENTE

---

## Fase 3: Consistencia de Filtrado de Datos — PENDIENTE

### 3.1 Auditar queries con `organization_id`
- **Estado:** PENDIENTE

### 3.2 Verificar RLS policies
- **Estado:** PENDIENTE

---

## Fase 4: Mejoras de UX — PENDIENTE

### 4.1 Indicador persistente de org activa
### 4.2 Transición suave al cambiar org
### 4.3 Persistencia de última org en localStorage

---

## Notas Técnicas

- **JWT Secret:** Usa `COURSEFORGE_JWT_SECRET` (env var) para firmar/verificar
- **RLS:** Las policies leen `active_organization_id` desde `current_setting('request.jwt.claims')::json->>'active_organization_id'`
- **Cookies:** `cf_access_token` (httpOnly), `cf_active_org` (httpOnly), `cf_user_orgs` (readable by client)
- **Errores pre-existentes:** Type errors en `scripts/` y `actions.ts` no relacionados con esta implementación
