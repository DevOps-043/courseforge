# Arquitectura de Cambio de Empresas Múltiples (Multi-Org Switching)

> **Propósito:** Documentar la lógica completa de selección y cambio de organizaciones múltiples en SofLIA-Learning, para replicar esta funcionalidad en CourseForge (CourseEngine).

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Modelo de Datos](#2-modelo-de-datos)
3. [Estado Global del Cliente (Zustand)](#3-estado-global-del-cliente-zustand)
4. [Hook Principal: useOrganization](#4-hook-principal-useorganization)
5. [Provider de Organizaciones](#5-provider-de-organizaciones)
6. [Componentes de UI](#6-componentes-de-ui)
7. [Flujo de Autenticación y Selección Post-Login](#7-flujo-de-autenticación-y-selección-post-login)
8. [Middleware de Rutas](#8-middleware-de-rutas)
9. [Rutas Dinámicas con orgSlug](#9-rutas-dinámicas-con-orgslug)
10. [Contexto de Organización en Server-Side](#10-contexto-de-organización-en-server-side)
11. [Filtrado de Datos por Organización](#11-filtrado-de-datos-por-organización)
12. [Branding Dinámico por Organización](#12-branding-dinámico-por-organización)
13. [Mapa de Archivos Clave](#13-mapa-de-archivos-clave)
14. [Flujos de Datos Completos](#14-flujos-de-datos-completos)
15. [Estado Actual de CourseForge](#15-estado-actual-de-courseforge)
16. [Plan de Implementación para CourseForge](#16-plan-de-implementación-para-courseforge)

---

## 1. Resumen Ejecutivo

SofLIA-Learning permite que un usuario pertenezca a **múltiples organizaciones** simultáneamente. La plataforma gestiona esto mediante:

- **Tabla `organization_users`** como tabla de junction (usuario ↔ organización)
- **Zustand Store** con persistencia en localStorage para el estado de la org activa
- **Rutas dinámicas** con pattern `/{orgSlug}/...` para scoping de contenido
- **Middleware** que valida membresía y redirige según roles
- **Página de selección** post-login cuando hay múltiples organizaciones
- **Dropdown switcher** en header para cambiar sin re-login

### Flujo Simplificado

```
Login → ¿Múltiples orgs? → Sí → Página de selección → /{orgSlug}/dashboard
                          → No → Auto-selección → /{orgSlug}/dashboard

En cualquier momento → Dropdown switcher → Cambiar org → /{nuevoSlug}/dashboard
```

---

## 2. Modelo de Datos

### Tabla `organizations`

```sql
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,  -- URL-friendly, lowercase
  logo_url        TEXT,
  brand_logo_url  TEXT,
  brand_color_primary TEXT,              -- Color hex para branding
  subscription_plan   TEXT,              -- 'team' | 'business' | 'enterprise'
  subscription_status TEXT,              -- 'active' | 'trial' | 'expired' | 'cancelled' | 'pending'
  is_active       BOOLEAN DEFAULT true,
  -- ... otros campos de configuración
);
```

### Tabla `organization_users` (Junction Table)

```sql
CREATE TABLE organization_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  user_id         UUID REFERENCES usuarios(id),
  role            TEXT NOT NULL,         -- 'owner' | 'admin' | 'member'
  status          TEXT DEFAULT 'active', -- 'active' | 'suspended' | 'pending' | 'rejected' | 'left'
  joined_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, organization_id)
);
```

### Relación

```
usuarios (1) ←→ (N) organization_users (N) ←→ (1) organizations
```

Un usuario puede pertenecer a N organizaciones, cada una con un rol y estado independiente.

### Tablas que Filtran por `organization_id`

Todas las tablas de contenido incluyen `organization_id` como columna:

- `user_course_enrollments`
- `user_lesson_progress`
- `user_quiz_submissions`
- `certificates`
- `study_plans`
- `cursos`, `modulos`, `lecciones`
- Y 30+ tablas más

---

## 3. Estado Global del Cliente (Zustand)

**Archivo:** `apps/web/src/core/stores/organizationStore.ts`

### Estado

```typescript
interface OrganizationState {
  currentOrganization: Organization | null;  // Org activa actual
  userOrganizations: Organization[];         // Todas las orgs del usuario
  isLoading: boolean;
  isHydrated: boolean;                       // Store cargado desde localStorage
}
```

### Tipo Organization

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  brandLogoUrl?: string | null;
  brandColorPrimary?: string | null;
  role: 'owner' | 'admin' | 'member';
  subscriptionPlan?: 'team' | 'business' | 'enterprise';
  subscriptionStatus?: 'active' | 'expired' | 'cancelled' | 'trial' | 'pending';
  isPlatformAdmin?: boolean;
}
```

### Acciones Principales

| Acción | Descripción |
|--------|-------------|
| `switchOrganization(orgIdOrSlug)` | Cambia la org activa por ID o slug |
| `setCurrentOrganization(org)` | Establece directamente la org activa |
| `setUserOrganizations(orgs)` | Actualiza la lista completa de orgs |
| `getOrganizationBySlug(slug)` | Busca org por slug en la lista |
| `getOrganizationById(id)` | Busca org por ID en la lista |
| `hasMultipleOrganizations()` | Retorna `true` si hay más de 1 org |
| `isOrgAdmin()` | Verifica si es owner/admin de la org activa |
| `clearOrganization()` | Limpia estado (logout) |

### Estrategia de Persistencia

```typescript
persist(
  (set, get) => ({ /* ... estado y acciones */ }),
  {
    name: 'organization-storage',
    // IMPORTANTE: Solo persiste id y slug, NO toda la data
    partialize: (state) => ({
      currentOrganization: state.currentOrganization
        ? { id: state.currentOrganization.id, slug: state.currentOrganization.slug }
        : null
    })
  }
)
```

**¿Por qué solo id y slug?** Evita datos obsoletos en localStorage. La data completa se re-fetcha desde el API al cargar la app.

---

## 4. Hook Principal: useOrganization

**Archivo:** `apps/web/src/core/hooks/useOrganization.ts`

Este hook es el **punto de acceso principal** para toda la lógica de organizaciones en componentes.

### Valores Retornados

```typescript
const {
  // Estado
  currentOrganization,        // Organization | null
  currentOrganizationId,      // string | null
  currentOrganizationSlug,    // string | null
  organizations,              // Organization[]
  isLoading,
  isHydrated,

  // Flags computados
  isB2B,                      // currentOrganization !== null
  isB2C,                      // currentOrganization === null
  canSwitch,                  // organizations.length > 1
  isOrgAdmin,                 // role === 'owner' || 'admin'
  isOrgOwner,                 // role === 'owner'
  isOrgMember,                // role === 'member'

  // Acciones
  switchOrganization,         // (orgIdOrSlug, navigate=true) → navega a /{slug}/dashboard
  switchOrganizationSilent,   // (orgIdOrSlug) → sin navegación
  navigateToOrgPath,          // (path) → router.push(/{slug}/{path})
  buildOrgPath,               // (path) → string /{slug}/{path}
  setCurrentOrganization,
  clearOrganization,
  getOrganizationBySlug,
  getOrganizationById,
} = useOrganization();
```

### Hooks Granulares (Performance)

Para evitar re-renders innecesarios, existen hooks específicos:

```typescript
useCurrentOrganizationId()       // Solo el ID
useCurrentOrganizationSlug()     // Solo el slug
useIsB2B()                       // Solo flag B2B
useCanSwitchOrganizations()      // Solo flag de cambio
```

---

## 5. Provider de Organizaciones

**Archivo:** `apps/web/src/core/providers/OrganizationProvider.tsx`

Envuelve toda la aplicación y sincroniza el estado del servidor con el cliente.

### Responsabilidades

1. **Fetch inicial:** Llama a `GET /api/users/organizations` al montar
2. **Sincronización:** Actualiza el Zustand store con las orgs recibidas
3. **Auto-selección desde URL:** Extrae `orgSlug` del pathname y selecciona la org correspondiente
4. **Manejo B2C:** Si el array está vacío, limpia el estado de org
5. **Revalidación:** Usa SWR con `revalidateOnReconnect: true`

### API Endpoint

**`GET /api/users/organizations`** — `apps/web/src/app/api/users/organizations/route.ts`

```typescript
// Flujo:
// 1. Verificar autenticación (SessionService.getCurrentUser())
// 2. Query: organization_users JOIN organizations
//    WHERE user_id = ? AND status = 'active' AND organizations.is_active = true
//    ORDER BY joined_at ASC
// 3. Transformar respuesta con role, subscription info, branding

// Response:
{
  success: true,
  organizations: [{
    id: "uuid",
    name: "Empresa X",
    slug: "empresa-x",
    logo_url: "https://...",
    brand_color_primary: "#0A2540",
    role: "admin",
    subscription_plan: "enterprise",
    subscription_status: "active"
  }]
}
```

---

## 6. Componentes de UI

### 6.1 OrganizationSwitcher (Dropdown)

**Archivo:** `apps/web/src/core/components/OrganizationSwitcher/OrganizationSwitcher.tsx`

| Prop | Tipo | Descripción |
|------|------|-------------|
| `variant` | `'default' \| 'compact' \| 'minimal'` | Estilo visual |
| `hideIfSingle` | `boolean` | Ocultar si solo hay 1 org |

**Comportamiento:**
- Muestra logo/inicial de la org, nombre y rol del usuario
- Dropdown con Radix UI Select + animaciones Framer Motion
- Al seleccionar: `switchOrganization(org.slug)` → navega a `/{org.slug}/dashboard`
- Solo se renderiza si el usuario tiene organizaciones
- Badges de rol: Propietario / Administrador / Miembro
- Checkmark visual en la org activa

### 6.2 UserDropdown (Menú de usuario)

**Archivo:** `apps/web/src/core/components/UserDropdown/UserDropdown.tsx`

- Sección "Mis Organizaciones" (solo si `isB2B`)
- Lista expandible con todas las orgs
- Cada org muestra: logo, nombre, badge de rol
- Org activa destacada en teal
- Click → `handleSwitchOrg(org.id)` → navega

### 6.3 Página de Selección Post-Login

**Archivo:** `apps/web/src/app/auth/select-organization/page.tsx`

| Caso | Acción |
|------|--------|
| 0 orgs | Redirige a `/dashboard` (usuario B2C) |
| 1 org | Auto-selecciona y redirige según rol |
| 2+ orgs | Muestra UI de selección con cards |

**Redirección según rol:**
- `owner` / `admin` → `/{org.slug}/business-panel/dashboard`
- `member` → `/{org.slug}/business-user/dashboard`

---

## 7. Flujo de Autenticación y Selección Post-Login

**Archivo:** `apps/web/src/features/auth/actions/login.ts`

### Flujo Completo

```
1. Usuario ingresa credenciales
2. Validación de email/password
3. ¿Tiene organizationId en el formulario? (login personalizado por org)
   → Sí: Verificar membresía + subscription activa
   → No: Login estándar
4. Crear/refrescar tokens (JWT + refresh_token)
5. Establecer cookies httpOnly seguras
6. Determinar redirección:
   a. Si es admin plataforma → /admin/dashboard
   b. Si es instructor → /instructor/dashboard
   c. Si tiene múltiples orgs → /auth/select-organization
   d. Si tiene 1 org:
      - owner/admin → /{slug}/business-panel/dashboard
      - member → /{slug}/business-user/dashboard
   e. Sin orgs → /dashboard (B2C)
```

### Login Personalizado por Organización

- URL: `/auth/{orgSlug}` (solo Enterprise)
- Valida que la org tenga subscription activa
- Verifica membresía del usuario
- Puede consumir tokens de invitación

---

## 8. Middleware de Rutas

**Archivo:** `apps/web/middleware.ts`

### Lógica Principal

```
1. Extraer orgSlug del primer segmento de la URL
2. Detectar rutas con scope de org:
   - /{orgSlug}/business-panel/* → Rutas de admin de empresa
   - /{orgSlug}/business-user/* → Rutas de empleado
3. Validar autenticación (cookies: refresh_token o session legacy)
4. Verificar membresía en organization_users
5. Verificar suspensión → Redirigir a /{orgSlug}/suspended si suspendido
6. Redirección post-login basada en roles y cantidad de orgs
```

### Decisiones de Redirección

```
¿Tiene múltiples orgs? → /auth/select-organization
¿Tiene 1 org?
  → owner/admin → /{slug}/business-panel/dashboard
  → member → /{slug}/business-user/dashboard
¿Tiene 0 orgs? → /dashboard (B2C)
```

---

## 9. Rutas Dinámicas con orgSlug

### Layout del Servidor

**Archivo:** `apps/web/src/app/[orgSlug]/layout.tsx`

Validación server-side para todas las rutas bajo `/{orgSlug}/`:

```
1. Extraer orgSlug de params
2. Verificar autenticación del usuario
3. Consultar organización por slug (is_active = true)
4. ¿Es admin de plataforma? → Acceso directo
5. Si no → Verificar membresía en organization_users
6. Todo OK → Renderizar OrganizationLayoutClient
7. No autenticado → /auth?redirect=/{orgSlug}/dashboard
8. Org no encontrada → 404
9. No es miembro → /dashboard?error=not_member
```

### Layout del Cliente (Sincronización)

**Archivo:** `apps/web/src/app/[orgSlug]/OrganizationLayoutClient.tsx`

```
1. Recibe prop organization del server
2. Llama setCurrentOrganization(org) → Zustand store
3. Si no está en userOrganizations → La agrega
4. Guarda en localStorage: 'last_organization_slug'
5. Envuelve con OrganizationStylesProvider
6. Provee contexto para todos los children
```

---

## 10. Contexto de Organización en Server-Side

**Archivo:** `apps/web/src/lib/auth/getOrganizationContext.ts`

Extrae el contexto de organización de requests del API.

### Fuentes (por prioridad)

1. Header `X-Organization-ID`
2. Header `X-Organization-Slug`
3. Query param `organizationId`
4. Query param `org`
5. Primer segmento de la URL (`/{orgSlug}/...`)

### Retorno

```typescript
interface OrganizationContext {
  organizationId: string | null;
  organizationSlug: string | null;
  role: 'owner' | 'admin' | 'member' | null;
  isB2B: boolean;
  isOrgAdmin: boolean;
}
```

---

## 11. Filtrado de Datos por Organización

### Helpers de Query

**Archivo:** `apps/web/src/lib/utils/organization-query.ts`

```typescript
// Agregar filtro de org a cualquier query de Supabase
withOrganizationFilter(query, organizationId)
// → .eq('organization_id', id) o .is('organization_id', null)

// Generar objeto para inserts
withOrganizationData(organizationId)
// → { organization_id: id | null }

// Extraer org ID de un request
extractOrganizationId(request, explicitId)
// → Prioridad: explícito > header > query param
```

### Patrón de Uso

```typescript
// En cualquier API route o server action:
const orgContext = await getOrganizationContext(request, userId);

let query = supabase.from('cursos').select('*');
query = withOrganizationFilter(query, orgContext.organizationId);

const { data } = await query;
```

---

## 12. Branding Dinámico por Organización

**Archivo:** `apps/web/src/features/business-panel/contexts/OrganizationStylesContext.tsx`

### Context Provider

```typescript
const { primaryColor, accentColor, orgSlug, orgName } = useOrganizationStyles();
```

- `primaryColor`: Proviene de `org.brand_color_primary`
- `accentColor`: Calculado automáticamente desde el primary
- Se usa para gradientes, botones y elementos de marca

---

## 13. Mapa de Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `core/stores/organizationStore.ts` | Estado Zustand con persistencia |
| `core/hooks/useOrganization.ts` | Hook principal para componentes |
| `core/providers/OrganizationProvider.tsx` | Fetch + sync de orgs desde API |
| `core/components/OrganizationSwitcher/` | Dropdown UI para cambiar org |
| `app/auth/select-organization/page.tsx` | Selector post-login multi-org |
| `app/api/users/organizations/route.ts` | API para obtener orgs del usuario |
| `app/[orgSlug]/layout.tsx` | Validación server-side de rutas org |
| `app/[orgSlug]/OrganizationLayoutClient.tsx` | Sync server → Zustand store |
| `middleware.ts` | Protección de rutas + org routing |
| `lib/auth/getOrganizationContext.ts` | Extracción de org context en APIs |
| `lib/organization-slug.ts` | Generación y validación de slugs |
| `lib/utils/organization-query.ts` | Helpers para queries filtradas |
| `features/auth/services/organization.service.ts` | Queries de org a DB |
| `features/business-panel/contexts/OrganizationStylesContext.tsx` | Branding dinámico |

---

## 14. Flujos de Datos Completos

### Carga Inicial de Página

```
1. Middleware valida auth + membresía org
2. Server layout verifica que org existe
3. OrganizationLayoutClient sincroniza al Zustand store
4. OrganizationProvider fetcha /api/users/organizations
5. Zustand store se hidrata desde localStorage
6. useOrganization() retorna org activa + lista
7. Componentes renderizan con contexto de org
```

### Cambio de Organización (Switch)

```
1. Usuario hace click en dropdown switcher
2. onClick → switchOrganization(slug)
3. Zustand store actualiza currentOrganization
4. Router navega a /{slug}/dashboard
5. Nuevo layout carga con nuevos params de org
6. OrganizationLayoutClient re-sincroniza
7. OrganizationProvider re-ejecuta fetch
8. Todos los componentes con useOrganization() se re-renderizan
```

### Estrategia de Persistencia

```
Cookies (httpOnly, Secure):
├── access_token (JWT)
├── refresh_token (hash)
└── aprende-y-aplica-session (legacy)

localStorage (Zustand persist):
├── organization-storage: { currentOrganization: { id, slug } }
└── last_organization_slug
```

---

## 15. Estado Actual de CourseForge

### Lo que YA existe

| Componente | Estado | Detalle |
|------------|--------|---------|
| `organizationStore.ts` (Zustand) | ✅ Parcial | Tiene `organizations[]` y `activeOrganizationId`, pero `switchOrganization()` es stub |
| JWT con org IDs | ✅ Implementado | `app_metadata.organization_ids[]` + `active_organization_id` |
| Cookies de org | ✅ Implementado | `cf_user_orgs` (JSON array), `cf_active_org` (single ID) |
| RLS policies | ✅ Implementado | Artifacts, model_settings, system_prompts filtran por org |
| Per-org settings | ✅ Implementado | Model settings y system prompts por organización |
| Org defaults trigger | ✅ Implementado | Auto-crea settings cuando se crea una org |
| Login fetch de orgs | ✅ Implementado | Lee `organization_users` de SofLIA al login |

### Lo que FALTA

| Componente | Estado | Impacto |
|------------|--------|---------|
| UI Dropdown switcher | ❌ No existe | Usuario no puede cambiar org sin re-login |
| Refresh de sesión al cambiar | ❌ No existe | JWT queda con la org original |
| Página de selección post-login | ❌ No existe | Toma la primera org automáticamente |
| Indicador de org activa en header | ❌ No existe | Usuario no sabe en qué org está |
| Re-generación de JWT | ❌ No existe | Necesario para que RLS funcione con nueva org |
| Filtrado consistente en todas las queries | ⚠️ Parcial | Algunas queries no filtran por org |

### Problema Actual

```
Usuario con orgs [EmpresaA, EmpresaB] hace login
  → JWT.active_organization_id = EmpresaA.id (primera)
  → cf_active_org cookie = EmpresaA.id
  → RLS filtra por EmpresaA
  → Contenido de EmpresaB queda BLOQUEADO/INVISIBLE
  → NO HAY FORMA de cambiar a EmpresaB sin re-login
```

---

## 16. Plan de Implementación para CourseForge

### Fase 1: Infraestructura de Cambio de Sesión (Backend)

**Prioridad:** Alta | **Complejidad:** Media

#### 1.1 Endpoint para regenerar JWT

Crear `POST /api/auth/switch-organization` que:

```typescript
// apps/web/src/app/api/auth/switch-organization/route.ts
// 1. Verificar que el usuario está autenticado (cf_access_token)
// 2. Recibir { organizationId } en el body
// 3. Verificar membresía: organization_users WHERE user_id AND organization_id AND status='active'
// 4. Generar NUEVO JWT con active_organization_id actualizado
// 5. Actualizar cookies: cf_access_token, cf_active_org
// 6. Retornar { success: true, organization: { id, name, slug, role } }
```

#### 1.2 Actualizar organizationStore.ts

Completar la función `switchOrganization()`:

```typescript
switchOrganization: async (organizationId: string) => {
  // 1. Llamar POST /api/auth/switch-organization
  // 2. Actualizar activeOrganizationId en store
  // 3. Recargar cookies (loadFromCookies)
  // 4. Retornar éxito/fallo
}
```

### Fase 2: Componentes de UI (Frontend)

**Prioridad:** Alta | **Complejidad:** Media

#### 2.1 Componente OrganizationSwitcher

Crear dropdown similar al de SofLIA-Learning:

```
Ubicación sugerida: apps/web/src/components/OrganizationSwitcher.tsx

Funcionalidad:
- Mostrar org activa (logo/inicial + nombre)
- Dropdown con lista de orgs disponibles
- Badge de rol por org
- Indicador visual de org activa
- Al seleccionar → llamar switchOrganization()
- Mostrar loading durante el cambio
- Refrescar la página/datos tras el cambio
```

#### 2.2 Integrar en Header/Sidebar

- Agregar OrganizationSwitcher en el layout principal del admin
- Mostrar solo si `organizations.length > 1`
- Posición: junto al nombre del usuario o en el sidebar

#### 2.3 Página de Selección Post-Login (Opcional)

Si hay múltiples orgs al login, mostrar selector antes de entrar al dashboard:

```
Ubicación: apps/web/src/app/select-organization/page.tsx

- Listar todas las orgs con cards
- Click en una → switchOrganization → redirect a /admin
- Si solo hay 1 org → auto-redirect (comportamiento actual)
```

### Fase 3: Consistencia de Filtrado de Datos

**Prioridad:** Alta | **Complejidad:** Baja

#### 3.1 Auditar todas las queries

Verificar que **todas** las queries a Supabase que tocan datos con `organization_id` incluyan el filtro:

```typescript
// Patrón correcto:
const activeOrgId = await getActiveOrganizationId();
query = query.eq('organization_id', activeOrgId);
```

**Tablas a auditar:**
- `artifacts` (ya filtrada ✅)
- `model_settings` (ya filtrada ✅)
- `system_prompts` (ya filtrada ✅)
- Cualquier tabla nueva que se agregue

#### 3.2 Actualizar RLS policies

Verificar que las RLS policies lean correctamente el `active_organization_id` del JWT actualizado.

### Fase 4: Mejoras de UX

**Prioridad:** Media | **Complejidad:** Baja

#### 4.1 Indicador persistente

Mostrar en el header el nombre/logo de la org activa de forma permanente.

#### 4.2 Transición suave

Al cambiar de org:
1. Mostrar overlay/spinner de transición
2. Invalidar caches de datos (SWR/React Query)
3. Recargar datos del dashboard con nueva org

#### 4.3 Persistencia de última org

Guardar en localStorage la última org seleccionada para auto-seleccionar al próximo login.

---

### Resumen de Esfuerzo Estimado por Fase

| Fase | Archivos Nuevos | Archivos Modificados | Descripción |
|------|----------------|---------------------|-------------|
| **Fase 1** | 1 (API route) | 1 (organizationStore) | Backend de switching |
| **Fase 2** | 2 (Switcher + Select page) | 2 (Layout + Login action) | UI components |
| **Fase 3** | 0 | Variable (auditoría) | Data consistency |
| **Fase 4** | 0 | 2-3 (Header + transitions) | UX polish |

### Orden Recomendado

```
Fase 1 → Fase 2.1 + 2.2 → Fase 3 → Fase 2.3 → Fase 4
```

La Fase 1 es **bloqueante** — sin el endpoint de regeneración de JWT, el cambio de org no funciona porque las RLS policies validan contra el JWT.
