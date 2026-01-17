# Documentacion de Desarrollo GO-ESP-01

## Resumen del Proyecto

GO-ESP-01 es una aplicacion web para la generacion automatizada de artefactos educativos (cursos de liderazgo) usando IA. El sistema permite generar, validar y revisar contenido educativo a traves de un pipeline automatizado.

---

## Stack Tecnologico

| Tecnologia | Version | Proposito |
|------------|---------|-----------|
| Next.js | 14.1.0 | Framework React con App Router |
| React | 18.2.0 | UI Library |
| TypeScript | 5.3.3 | Tipado estatico |
| Tailwind CSS | 3.4.1 | Estilos |
| Radix UI | - | Componentes accesibles |
| Supabase | 2.39.3 | Backend (Auth, DB, Realtime) |
| Zod | 3.22.4 | Validacion de schemas |
| React Hook Form | 7.50.1 | Manejo de formularios |
| Zustand | 4.5.0 | Estado global |

---

## Arquitectura del Proyecto

```
src/
├── app/                      # Next.js App Router
│   ├── (auth)/              # Grupo de rutas de autenticacion
│   │   ├── login/
│   │   └── signup/
│   ├── (dashboard)/         # Grupo de rutas del dashboard
│   │   ├── page.tsx         # Dashboard principal (/)
│   │   ├── generate/        # Generar artefactos (/generate)
│   │   ├── artifacts/       # Lista de artefactos (/artifacts)
│   │   │   └── [id]/        # Detalle de artefacto (/artifacts/:id)
│   │   ├── qa/              # Cola de QA (/qa)
│   │   │   └── [id]/        # Revisar artefacto (/qa/:id)
│   │   └── layout.tsx       # Layout con Sidebar
│   ├── layout.tsx           # Layout raiz
│   └── globals.css          # Estilos globales
│
├── domains/                  # Logica de negocio por dominio
│   ├── auth/                # Autenticacion
│   │   ├── components/      # LoginForm, SignUpForm
│   │   ├── hooks/           # useAuth
│   │   ├── services/        # auth.service.ts
│   │   └── index.ts         # Barrel export
│   │
│   ├── artifacts/           # Artefactos generados
│   │   ├── components/      # ArtifactCard, ArtifactList, ArtifactViewer
│   │   ├── hooks/           # useArtifacts, useArtifact, useArtifactStats
│   │   ├── services/        # artifacts.service.ts
│   │   ├── types/           # artifact.types.ts
│   │   └── index.ts
│   │
│   └── generation/          # Generacion con IA
│       ├── components/      # GenerationForm, PipelineProgress
│       ├── hooks/           # usePipelineProgress
│       ├── services/        # generation.service.ts
│       ├── types/           # generation.types.ts
│       └── index.ts
│
├── shared/                   # Codigo compartido
│   ├── components/
│   │   ├── ui/              # Componentes base (Button, Card, Input, etc.)
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   ├── lib/
│   │   ├── supabase/        # Cliente Supabase (client.ts, server.ts)
│   │   └── utils.ts         # Utilidades (cn para classnames)
│   └── types/
│       └── database.types.ts # Tipos de la base de datos
│
└── middleware.ts             # Middleware de Next.js
```

---

## Patron de Desarrollo por Dominio

Cada dominio sigue esta estructura:

```
domains/{nombre}/
├── components/     # Componentes React del dominio
├── hooks/          # Custom hooks del dominio
├── services/       # Logica de negocio y llamadas API
├── types/          # Tipos TypeScript del dominio
└── index.ts        # Barrel export para importaciones limpias
```

### Ejemplo de uso:
```typescript
// En lugar de:
import { ArtifactCard } from '@/domains/artifacts/components/ArtifactCard'
import { useArtifacts } from '@/domains/artifacts/hooks/useArtifacts'

// Se usa:
import { ArtifactCard, useArtifacts } from '@/domains/artifacts'
```

---

## Modelo de Datos

### Artifact (Artefacto)

```typescript
interface Artifact {
  id: string
  run_id: string | null
  course_id: string | null
  idea_central: string              // Input del usuario
  nombres: string[]                 // 3 nombres generados
  objetivos: string[]               // 3-5 objetivos de aprendizaje
  descripcion: {
    texto: string
    publico_objetivo: string
    beneficios: string
    estructura_general: string
    diferenciador: string
  }
  state: ArtifactState
  validation_report: ValidationReport | null
  semantic_result: SemanticResult | null
  auto_retry_count: number
  iteration_count: number
  generation_metadata: object
  created_by: string | null
  created_at: string
  updated_at: string
}
```

### Estados del Artefacto

```typescript
type ArtifactState =
  | 'DRAFT'          // Borrador inicial
  | 'GENERATING'     // Generando con IA
  | 'VALIDATING'     // Validando estructura
  | 'READY_FOR_QA'   // Listo para revision humana
  | 'APPROVED'       // Aprobado
  | 'REJECTED'       // Rechazado
  | 'ESCALATED'      // Requiere intervencion manual
```

### Maquina de Estados

```
DRAFT → GENERATING → VALIDATING → READY_FOR_QA → APPROVED
                         ↓              ↓
                    ESCALATED      REJECTED
                         ↓              ↓
                    (retry) ←──────────┘
```

---

## Flujo de Generacion

### 1. Usuario ingresa idea central
```
/generate → GenerationForm → generationService.startGeneration()
```

### 2. Pipeline de generacion (simulado)
```typescript
// generation.service.ts
async startGeneration(input) {
  // 1. Crear artefacto en estado GENERATING
  const artifact = await artifactsService.create({
    idea_central: input.ideaCentral,
    state: 'GENERATING'
  })

  // 2. Simular generacion (3 segundos)
  setTimeout(async () => {
    // Generar nombres, objetivos, descripcion
    await artifactsService.update(artifact.id, {
      state: 'VALIDATING',
      nombres: [...],
      objetivos: [...],
      descripcion: {...}
    })

    // 3. Simular validacion (2 segundos mas)
    await artifactsService.update(artifact.id, {
      state: 'READY_FOR_QA',
      validation_report: {...},
      semantic_result: {...}
    })
  }, 3000)
}
```

### 3. Progreso en tiempo real
```typescript
// usePipelineProgress.ts
// Polling cada 2 segundos para simular realtime
const interval = setInterval(fetchState, 2000)
```

---

## Componentes UI

Basados en shadcn/ui con Radix UI:

| Componente | Archivo | Uso |
|------------|---------|-----|
| Button | `ui/button.tsx` | Botones con variantes |
| Card | `ui/card.tsx` | Contenedores con header/content |
| Input | `ui/input.tsx` | Campos de texto |
| Textarea | `ui/textarea.tsx` | Areas de texto |
| Label | `ui/label.tsx` | Etiquetas de formulario |
| Badge | `ui/badge.tsx` | Etiquetas de estado |
| Progress | `ui/progress.tsx` | Barra de progreso |
| Tabs | `ui/tabs.tsx` | Navegacion por pestanas |
| Separator | `ui/separator.tsx` | Lineas divisoras |

---

## Rutas de la Aplicacion

| Ruta | Archivo | Descripcion |
|------|---------|-------------|
| `/` | `(dashboard)/page.tsx` | Dashboard con estadisticas |
| `/generate` | `(dashboard)/generate/page.tsx` | Formulario de generacion |
| `/artifacts` | `(dashboard)/artifacts/page.tsx` | Lista de artefactos |
| `/artifacts/:id` | `(dashboard)/artifacts/[id]/page.tsx` | Detalle de artefacto |
| `/qa` | `(dashboard)/qa/page.tsx` | Cola de revision QA |
| `/qa/:id` | `(dashboard)/qa/[id]/page.tsx` | Revisar artefacto |
| `/login` | `(auth)/login/page.tsx` | Inicio de sesion |
| `/signup` | `(auth)/signup/page.tsx` | Registro |

---

## Base de Datos (Supabase)

### Tablas

```sql
-- Artefactos generados
CREATE TABLE artifacts (...)

-- Sesiones de revision QA
CREATE TABLE qa_sessions (...)

-- Eventos del pipeline
CREATE TABLE pipeline_events (...)

-- Roles de usuario
CREATE TABLE user_roles (...)
```

Ver archivo: `supabase/migrations/001_initial_schema.sql`

---

## Modo de Desarrollo (Mock)

Actualmente configurado para funcionar sin Supabase:

- `artifacts.service.ts` - Datos mock en memoria
- `generation.service.ts` - Simula generacion con delays
- `useAuth.ts` - Usuario mock siempre autenticado
- `usePipelineProgress.ts` - Polling en lugar de realtime

Para activar Supabase, revertir estos archivos y configurar `.env.local`.

---

## Comandos

```bash
# Desarrollo
npm run dev

# Build produccion
npm run build

# Iniciar produccion
npm start

# Lint
npm run lint

# Generar tipos de Supabase
npm run supabase:types
```

---

## Para Continuar con ESP-02

1. **Copiar estructura base**: Duplicar `go-esp-01-web` como `go-esp-02-web`

2. **Modificar dominio**: Cambiar `artifacts` por el nuevo tipo de contenido

3. **Ajustar tipos**: Modificar `artifact.types.ts` y `database.types.ts`

4. **Actualizar validaciones**: Ajustar `validation_report` y `semantic_result`

5. **Personalizar UI**: Modificar componentes segun necesidades

### Checklist para nuevo ESP:

- [ ] Definir estructura del artefacto
- [ ] Crear tipos TypeScript
- [ ] Crear schema SQL
- [ ] Implementar servicio de generacion
- [ ] Crear componentes de visualizacion
- [ ] Configurar validaciones
- [ ] Implementar flujo de QA

---

## Dependencias Clave

```json
{
  "@supabase/ssr": "^0.1.0",        // Cliente Supabase para Next.js
  "@supabase/supabase-js": "^2.39.3",
  "react-hook-form": "^7.50.1",     // Formularios
  "zod": "^3.22.4",                 // Validacion
  "zustand": "^4.5.0",              // Estado global
  "date-fns": "^3.3.1",             // Manejo de fechas
  "lucide-react": "^0.316.0"        // Iconos
}
```
