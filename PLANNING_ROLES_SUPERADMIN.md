# Planificación de Roles: Superadmin y Admins de Empresa en CourseForge

## Contexto Actual

CourseForge delega la autenticación principal (credenciales) a **SofLIA**, pero gestiona los permisos operativos internos a través de la tabla local `profiles`. Con el cambio reciente, la plataforma respeta el campo `platform_role` (`ADMIN`, `ARQUITECTO`, `CONSTRUCTOR`) para el acceso.

Sin embargo, en el futuro, cuando CourseForge soporte a múltiples empresas (clientes B2B), surgirá la necesidad de tener dos niveles de administración bien definidos y separados:

1. **Superadmin (Dueño de la Plataforma CourseForge):** Tiene acceso absoluto a todas las organizaciones (empresas), usuarios, métricas globales, configuración de modelos de IA y facturación/logs de todo el sistema.
2. **Admin de Empresa (Dueño u Operador del Cliente):** Tiene control administrativo **únicamente sobre su organización** (`organization_id`). Puede crear constructores y arquitectos, pero solo dentro de su propia empresa (aislamiento de datos o multi-tenancy).

---

## 1. Modificaciones Propuestas a la Base de Datos

### Tabla `profiles`

El `platform_role` actual es un `ENUM` de aplicación. Podemos mejorarlo o añadir una bandera booleana para los super administradores.

- **Opción A (Recomendada):** Agregar `SUPERADMIN` al ENUM `app_role` existente (`SUPERADMIN`, `ADMIN`, `ARQUITECTO`, `CONSTRUCTOR`).
- **Opción B:** Añadir un campo booleano `is_superadmin BOOLEAN DEFAULT FALSE`.

El esquema de la tabla `profiles` ya posee los campos correctos para conectar con la empresa:

```sql
organization_id uuid REFERENCES organizations(id),
organization_role text, -- Opcional, pero útil
```

### Tabla `organizations`

Asegurarse de que cada empresa que se da de alta en CourseForge tenga su registro aquí. El Superadmin será el único encargado de dar de alta una nueva `Organization`.

### Row Level Security (RLS)

Para garantizar la separación de datos entre empresas:

- Los **Superadmins** deben eludir las restricciones de RLS (acceso a cualquier `organization_id`).
- Los **Admins**, **Arquitectos** y **Constructores** deben tener políticas RLS estrictas: `organization_id = auth.jwt() -> 'app_metadata' ->> 'active_organization_id'`.

---

## 2. Flujo B2B: Creación de Usuarios

Uno de los principales desafíos es que los usuarios primero nacen en la base de datos maestra (SofLIA) para el Single Sign-On.

### El Flujo de Creación Ideal:

#### A. Creación de una Empresa y su Admin (Acción Exclusiva del Superadmin)

1. El Superadmin ingresa a `/admin/organizations` en CourseForge.
2. Llena los datos de la nueva empresa ("Acme Corp").
3. Crea al "Admin de Empresa" (ej: admin@acme.com) desde un formulario especial.
4. **Alerta Arquitectónica:** CourseForge debe comunicarse a través de un backend seguro (**Supabase Edge Function** o un endpoint del servidor) con la base de datos de SofLIA para crear la cuenta de SSO y asignarle su contraseña inicial.
5. Inmediatamente, CourseForge crea el registro espejo en su tabla local `profiles` con `platform_role = 'ADMIN'` y el `organization_id` de Acme Corp.

#### B. Creación de Constructores (Acción del Admin de Empresa)

1. El Admin de Empresa ingresa a su panel `/admin/users`. (El UI debe estar restringido mediante RLS y backend para solo ver a los empleados de su empresa).
2. Hace clic en "Nuevo Usuario".
3. Al formulario de creación interno se le inyecta automáticamente el `organization_id` del Admin en sesión.
4. El backend se encarga de crear al empleado en SofLIA y luego reflejarlo en `profiles` con el rol adecuado (`CONSTRUCTOR` o `ARQUITECTO`).

---

## 3. Plan de Desarrollo e Implementación

Para ejecutar esto, las tareas se pueden organizar en las siguientes fases (Epics):

### Fase 1: Esquema de Datos y RLS (Backend Core)

- Ampliar el ENUM de Supabase `app_role` para incluir `SUPERADMIN`.
- Cargar un script de migración para las Políticas RLS de todas las tablas clave (`artifacts`, `materials`, `profiles`).
- _Criterio de éxito:_ La BD deniega el acceso cruzado si dos usuarios pertenecen a diferente `organization_id`, excepto para el Superadmin.

### Fase 2: APIs de Sincronización Bidi-reccional

- Crear endpoints en CourseForge (`/api/admin/organizations`, `/api/admin/users`) con permisos a nivel API (`if (role !== 'SUPERADMIN') return 403`).
- Establecer en el servidor de CourseForge un cliente de conexión a la base de datos de SofLIA.
- _Criterio de éxito:_ Al crear un usuario en el Admin B2B de CourseForge, se refleja exitosamente en la BD remota de SofLIA con su contraseña encriptada.

### Fase 3: Dashboard Multi-nivel

- Crear un layout `SuperadminLayout` (`/superadmin/`) reservado para la vista global B2B, gestión de organizaciones y configuraciones globales (como `model_settings`).
- Modificar el actual `/admin/` para que actúe como el **Panel del Admin de Empresa**. Eliminar botones o vistas que afecten globalmente a la plataforma.
- _Criterio de éxito:_ Un usuario `SUPERADMIN` ve el listado completo de "Empresas", mientras que un usuario `ADMIN` solo ve a los "Usuarios" y "Artefactos" de su misma organización.

### Fase 4: Auth Context y Active Organization

- Asegurarse de que el puente JWT ya inyecta los `organization_ids` y el `active_organization_id` correctamente desde SofLIA.
- Propagar este contexto al estado global en el Frontend (`organizationStore.ts`) para filtrados en UI.

---

## Resumen de Complejidad

- **Dificultad:** Alta.
- **Riesgo:** Alto en temas de seguridad y visualización de datos cruzada. (El RLS debe probarse de forma exhaustiva).
- **Dependencia clave:** Las credenciales y Service Roles compartidos entre el servidor que aloja CourseForge y la BD de SofLIA para creación y orquestación remota de usuarios.
