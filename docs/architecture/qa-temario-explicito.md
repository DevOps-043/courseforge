# QA local de temarios explícitos — 2026-10-09

El usuario confirmó que la migración sigue pendiente de aplicación manual y pidió continuar únicamente con validación local. No se modificó producción ni se habilitó el flag. Esta entrega complementa la evidencia del 8 de octubre.

## Pruebas nuevas

| Suite | Resultado | Código real ejercitado | Fronteras simuladas |
|---|---|---|---|
| Orquestación | 22 aprobadas | Runner local/background, repositorio, política de fidelidad, validadores, duración y contratos OpenAI/Gemini | SDK de proveedor, configuración, logger, telemetría y transporte de persistencia |
| HTTP y carga | 17 aprobadas | GET/POST de importaciones, autorización del caso de uso, schemas, respuestas HTTP, repositorio y handler multipart | Sesión, resolución de tenant, cliente de BD, ejecución/dispatch, extracción y adaptador NextResponse |

Los tests compilan los módulos reales mediante esbuild, usando la instalación existente del proyecto. No cargan archivos `.env`; rechazan cualquier llamada a `fetch`. Los flags que usan viven solo en el proceso de pruebas y se restauran al terminar. Los bundles de QA se escriben en `apps/web/.tmp/syllabus-import-qa`, no en el producto.

Las simulaciones no acreditan permisos efectivos de producción, firmas reales en Netlify ni comprensión semántica del proveedor. Las transacciones, restricciones y permisos SQL se verifican por separado con la migración real en PGlite; sus once casos aprobados están registrados en el plan.

## Casos y hallazgos

- Temario completo: se guarda con sus IDs, títulos, objetivos y temas sin consultar configuración IA, construir SDK ni leer apoyo documental innecesario. Antes de esta continuación todavía dependía de la disponibilidad de configuración IA aunque no necesitaba generación; quedó corregido.
- Solo títulos: completa objetivos por ID y no inventa estructura. Se preservan también subtemas y títulos repetidos entre módulos, con IDs independientes.
- Extracción: usa exclusivamente el documento principal; una lista plana queda para revisión. Un título sin cita verificable genera una incidencia visible.
- Respuestas adversas: rechaza campos protegidos, IDs desconocidos, reemplazo de objetivos explícitos y objetivos ausentes. El baseline confirmado sobrevive.
- Salida truncada: rechaza respuestas marcadas como incompletas incluso si el JSON recibido es válido. Se añadió la comprobación `MAX_TOKENS` de Gemini; OpenAI ya comprobaba su razón de terminación.
- Exceso de duración: conserva las veinte lecciones del caso de prueba y guarda validación bloqueante para aprobación, sin eliminar contenidos.
- Ampliaciones: una ubicación inválida falla; una propuesta válida se guarda separada y no se aplica automáticamente.
- Recuperación: reservas vencidas se recuperan antes de gastar IA; una revisión antigua no ejecuta trabajo y una reserva perdida durante el proveedor no sobrescribe ni marca fallida la revisión nueva.
- Privacidad: los fallos simulados no filtran contenido de documentos o respuestas privadas a logs o errores HTTP. La lectura del original conserva `private, no-store`.
- Acceso: usuario sin sesión, tenant ausente, otra organización y sesión/tenant con distintos usuarios quedan bloqueados antes de lecturas privilegiadas. La carga persistente aplica también esta comprobación de identidad.
- Contrato HTTP: cuerpos inválidos o excesivos fallan antes de consultar BD. Se corrigieron códigos inconsistentes: ausencia de tenant es `TENANT_FORBIDDEN`; exceso de payload es `PAYLOAD_TOO_LARGE`.
- Confirmación: exige aceptación explícita, estructura no vacía, actor autenticado y revisión vigente.
- Rollout: con flag apagado no se consultan tablas nuevas; la lista de organizaciones controla disponibilidad.
- Local/Netlify: verifican revisión reservada y organización en ejecución/dispatch. Un fallo de dispatch libera la reserva y conserva el original. La firma y transporte real requieren aceptación del despliegue.

## Reproducción

Desde `apps/web`:

```powershell
npm run test:syllabus-import-flow
npm run test:syllabus-import
npm run test:syllabus-duration
npx tsc --noEmit --pretty false --incremental false
```

O desde la raíz:

```powershell
node --test scripts/test-provided-syllabus-orchestration.mjs
node --test scripts/test-provided-syllabus-http.mjs
```

La regresión de temario/duración mantiene 38 casos aprobados y la política de importación mantiene 16. Los cambios de código se limitan al runner, su política, terminación del proveedor, autorización y contratos de las rutas de temario.

## Pendientes reales

Persisten: aceptación con IA real, revisión de UX/accesibilidad, revisión SQL de políticas históricas, aplicación manual de migración y piloto. Los tests de HTTP usan mocks de sesión y transporte; no equivalen a una sesión autenticada contra producción. No se ejecutó una prueba E2E nueva de SCORM.

El build dentro del aislamiento de Windows falló al canonicalizar `jsc.baseUrl` por acceso denegado, antes de compilar la aplicación. Se reintentó el mismo comando fuera del aislamiento; el resultado final y el typecheck se registran en el plan.

Resultado final: build aprobado fuera del aislamiento, con 97 páginas y siete avisos de filesystem en módulos de producción visual. TypeScript completo y ESLint focalizado aprobados. `npm run test:syllabus-import-flow` reúne los 39 casos nuevos y terminó con exit 0. El control de versiones de migraciones también pasó (186 archivos). Producción y la migración permanecen sin cambios; el flag local no fue habilitado.
