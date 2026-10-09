# Traspaso y desarrollo paralelo del editor multimedia

Fecha del corte: 2026-10-06. Responsable principal: equipo actual + Codex.
Colaborador: por confirmar. Las asignaciones siguientes son propuestas, no trabajo ya delegado.

## 1. Alcance y fuentes de verdad

Objetivo: permitir que un compañero complete paquetes del roadmap sin editar simultáneamente
el núcleo que seguimos desarrollando y con integración posterior verificable.

- [Roadmap de arquitectura](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ARCHITECTURE_ROADMAP.md): alcance original.
- [Hoja de seguimiento](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_DELIVERY_TRACKER.md): entregas y limitaciones; los cortes recientes prevalecen sobre el historial.
- [Registro de requisitos](SOFLIA_ENGINE_MULTIMEDIA_EDITOR_ROADMAP_REQUIREMENTS_TRACKER.md): R01–R30; crédito de cierre no significa porcentaje de código.
- [Cierre CAP-027](SOFLIA_ENGINE_CAP027_COMPLETION_PLAN.md): prioridad y decisiones pendientes actuales.

Base local revalidada: commit `96a191b9dfb4dc1bf8060e364816bb5079a1e273`
(`feat: endurecer conformidad preview-render y documentar desarrollo paralelo`). El árbol estaba
limpio al iniciar esta comprobación. Se verificaron como versionados la hoja de traspaso,
config del build operativo, productor/colector materializados, host Windows y contratos/planificador
de thumbnails. Esta base sustituye la advertencia del corte anterior sobre HEAD `7e16e8c...`
incompleto; las dependencias y recursos del operador siguen siendo una instalación aparte.

**Commit local disponible no significa commit publicado en GitHub**: el fallo de conectividad
reportado impide asumir que un clone/fetch del compañero lo contiene. Confirmar que su checkout
resuelve este SHA antes de iniciar el paquete. Este documento actualizado constituye un cambio
posterior al commit base y debe acompañar el traspaso. Los autores/reservas de otros frentes
(por ejemplo narrativa) deben confirmarse, no tratarlos como archivos libres para este acuerdo.
No copiar secretos, `.env`, outputs, `node_modules` ni credenciales. No usar reset/stash/limpieza
para preparar el traspaso sin autorización.
Este documento no crea rama, commit, PR, envío a otra persona ni despliegue.

## 2. Estado de las siete prioridades

Los porcentajes son estimaciones de implementación registradas, no aceptación productiva.

| CAP | Avance registrado | Implementado / evidencia de avance | Pendiente | Responsable propuesto |
| --- | ---: | --- | --- | --- |
| CAP-004 | 100% | Operaciones masivas, duplicate/clipboard/ripple/insert/overwrite y layout; restricciones de grupos/links/transiciones preservadas | QA integrado y regresiones de operaciones | Equipo actual; tester después |
| CAP-009 | 100% | Undo/redo documental general | QA integrado; no extender undo a efectos externos | Equipo actual; tester después |
| CAP-010 | 100% | Journal/autosave, recuperación y OCC, preservación de conflictos | QA de recovery/concurrencia/sesión real | Equipo actual; tester después |
| CAP-017 | 100% | Waveform/LOD, metros y diagnóstico de clipping/loudness | Worker real, calibración, escucha y QA | Equipo actual; tester después |
| CAP-023 | 100% | Biblioteca de medios/search, identidad, reemplazo/relink | QA tenant/Storage/medios reales y regresiones | Equipo actual; tester después |
| CAP-026 | 100% | Preview incremental, ACK correlacionado, fallos explícitos y recuperación | QA autenticado/navegadores y latencia sostenida | Equipo actual; tester después |
| CAP-027 | 85.80% | Contratos/gates, materialización, pins, supervisor/checkpoints, lifecycle/fence, inventario, puente Windows, candidato SDK y comparadores preparados; build operativo separado; corrección de supresión currentColor | Integración productor→medición→supervisor, aislamiento real, identidad/fuentes/color efectivos y cobertura original; además QA | **Equipo actual, reservado** |

Media de las siete: `(600 + 85.80) / 7 = 97.97%`.
CAP-027 tiene **14.20% estimado de implementación pendiente**, no solo QA.
Crédito de cierre del roadmap completo: **7/30 = 23.33%**, no porcentaje global de implementación.
CAP-008/R08 es un cierre adicional fuera del subconjunto de siete, también con QA pendiente.

Evidencia reciente CAP-027: 44/44 checks de build/collector y regresiones; después 39/39 tests
de máscaras/supresión/texto. Son selecciones diferentes, no una suite única de 83 tests.
No prueban render productivo, sandbox OS ni QA real. Los siete fallos históricos de checkpoint
no quedan resueltos por esas selecciones.

## 3. Otros frentes: qué existe y qué no está cerrado

| Frente | Base existente inspeccionada / registrada | Trabajo pendiente y recomendación |
| --- | --- | --- |
| CAP-022 / R13 | `media-derivatives/thumbnail-derivative.contract.ts`, `thumbnail-plan.service.ts` y tests: identidad tenant/SHA/perfil/intervalo/LOD/página, manifiesto WebP, plan por viewport/playhead y presupuestos | Productor seguro, verificación de bytes, jobs/cancelación/cache, entrega autorizada, UI y mediciones. **Primer candidato para el compañero**. Proxies solo según mediciones; no sustituyen originales en render |
| CAP-025 / R23–R25 | Servicios `composition-agent-*`: allow-list ejecutable, read snapshot, simulación, diff/riesgo, proposals/store, TTL y confirmación; schemas existentes | Auditar cobertura de herramientas/presupuestos, planificación multi-step, anti-replay/hash/ownership/policy/model y gateway. **Segundo paquete acotado**, no reimplementar lo existente |
| CAP-029 / R19–R22 | Contratos/reducer/compiler, catálogo/bootstrap, repositorio/Storage/snapshot, comandos/historial/inspector y recovery; inicialización durable servicio/HTTP preparada y deshabilitada | Cliente de inicialización aún legacy: persistir ID/digest antes de POST durable y recovery por receipt; catálogo UX, sandbox, gates y evidencia integrada. **No asignar CAP completa**: fuerte acoplamiento con documento/preview/render |
| CAP-031 / R09 | Auditoría específica y trabajo de shortcuts/foco/canvas/localización/Unicode/RTL registrados | Inventario de presentación/nombres y validación de accesibilidad/shaping; cambios de UI compartida requieren reserva de archivos |
| CAP-019 / R05; CAP-018 / R11 | Color y procesamiento de voz parciales registrados | Auditar DoD completo. Mantener en coordinación con CAP-027 y audio, no asignar aisladamente por ahora |
| CAP-024/015 / R14; CAP-012 / R15; CAP-021 / R16; CAP-020 / R17; R18 | Presets/captions, motion, rate/freeze, máscaras editoriales y subcomposiciones inventariados | Cierre no acreditado. Auditoría propia antes de prometer alcance; máscaras QA no equivalen a máscaras editoriales |
| CAP-032 / R28; R01/R26–R30 | Gateway, seguridad, performance, observabilidad, migración y flags transversales | No asignar en bloque: atraviesan varios dueños. Separar contratos/runbooks específicos después de acordar alcance |

CAP-022/025/029 y demás frentes no tienen aquí una rúbrica de implementación comparable;
**no asignar 0% por falta de cierre ni inventar un porcentaje**. Las filas resumen la evidencia
inspeccionada y el registro vigente, no una auditoría completa nueva de todas las capacidades.

## 4. Qué seguimos nosotros

1. CAP-027: conservar propiedad del productor, mediciones, supervisor, autoridad/checkpoints y gates.
2. Acordar entorno productivo: Windows restringido o Linux con contenedor aislado. El Job Object
   actual controla procesos/cuotas, no filesystem/red/token. Dockerfiles de API/audio no resuelven esa decisión.
3. Acordar instrumentación de la sesión original: pipeline completo del SDK fijado no expone
   ese hook en RenderConfig. No modificar `node_modules` silenciosamente ni usar una sesión distinta como prueba.
4. Integrar los paquetes aceptados del compañero en editor/API/contratos compartidos.
5. Conservar la preparación de QA global, migraciones y rollout, sin ejecutarlos todavía.

CAP-022/025/029 permanecen en el objetivo global: delegar un paquete no elimina requisitos ni
convierte nuestro trabajo actual en una reimplementación paralela del mismo paquete.

## 5. Paquete inicial recomendado: CAP-022, thumbnails sin tocar render

| Etapa | Entregable del compañero | Condición de integración |
| --- | --- | --- |
| T022-1 | Auditoría breve de los tres archivos existentes; contrato de adquisición autorizada/resultado/verificación y presupuesto; reutilizar identidad/planificador existentes | Revisión de interfaz por equipo actual antes de tocar consumidor compartido |
| T022-2 | Productor/verificador modular de sprites y adapter de jobs/cache, cancelación y errores explícitos; fuente autorizada, hash/MIME/tamaño/dimensiones/timestamps cotejados | Tests unitarios/contrato, duplicados concurrentes/idempotencia y cancelación; ningún permiso implícito desde cache key; definir contención antes de admitir medios no confiables |
| T022-3 | Reader/servicio autorizado tenant-scoped, componente/hook de thumbnails aislado y consumo del plan por viewport | Acceso cruzado rechazado, presupuestos/memoria/cancelación, sin cambiar hash documental ni fuentes finales |
| T022-4 | PR o patch de integración pequeño con métricas previstas, riesgos y backlog de QA | Equipo actual realiza wiring de timeline/biblioteca y comprueba regresiones de CAP-023/026/027 |

No implementar proxies en este primer paquete sin datos que los justifiquen. No crear otro motor
de jobs: reutilizar infraestructura existente mediante un adapter; cualquier modificación de
esa infraestructura necesita acuerdo de archivos antes de comenzar.

Archivos permitidos **propuestos** para el paquete:

- `apps/web/src/domains/production/media-derivatives/**` y sus tests.
- Nuevo `apps/api/src/features/media-derivatives/**` y tests, si la interfaz backend es aprobada.
- Nuevos componentes bajo `apps/web/src/domains/materials/components/media-derivatives/**`.
- Nuevo `apps/web/tsconfig.media-derivatives-test.json` si se necesita un build de tests acotado;
  actualmente no existe. No asumir que tsconfig.hyperframes-test incluye este módulo.
- Documento/nota de entrega exclusiva CAP-022. Cambios a package scripts, API routes, DB,
  migrations o Storage policies deben venir como integración separada y revisada.

No integrar directamente en `NativeCompositionPreview.tsx`, timeline o biblioteca compartida:
entregar componente/adapter y diff propuesto al responsable de integración.

## 6. Paquetes siguientes, solo después de aceptar el primero

### CAP-025: policy y herramientas acotadas

Tomar primero auditoría + cobertura de read tools/presupuestos y simulación multi-step usando
el evaluator existente. Trabajar en `composition-agent-read-tools.service.ts`, módulos nuevos
con prefijo `composition-agent-` y sus tests, con reserva previa si se modifica un archivo existente.
No ampliar allow-list, ejecutar apply automáticamente, cambiar schema/gateway/store compartidos,
pedir credenciales ni llamar proveedores durante el paquete inicial. Anti-replay/TTL/ownership
se revisan frente al store existente; wiring/API/DB en una integración separada.

DoD del paquete: límites explícitos, permisos independientes del modelo, diff verificable,
simulación sin side effects, fallos seguros, tests de entradas malformadas y revisión base obsoleta.
La política no se delega al prompt. No declarar CAP-025 cerrada por completar solo esta etapa.

### CAP-029: catálogo UX, no núcleo editorial

Alternativa si el compañero prefiere frontend: componente aislado para descubrir/mostrar plantillas
aprobadas, vacío/error/loading, selección y contrato de lectura, con datos de prueba. Reservar
una subcarpeta nueva de componentes de catálogo; servidor conserva autoridad. No activar catálogo
ni flags, inicializar revisiones automáticamente, modificar sandbox, compiler, snapshots,
journal o documento nativo. El equipo actual integra el componente contra el catálogo autorizado.
La recuperación durable pendiente no debe reconstruirse desde el selector ni resolverse con retry.

## 7. Reserva de archivos y reglas de trabajo paralelo

| Área | Dueño de cambios durante este acuerdo |
| --- | --- |
| `composition-editor/qa/**`, `tools/controlled-hyperframes/**`, `tsconfig.composition-worker.json`, scripts de worker/gate | Equipo actual: CAP-027 |
| Documento/factory/persistencia/snapshots, editor-patch/types/gateway, preview compiler/protocol y contratos de render | Equipo actual; cambios del compañero solo por propuesta de interfaz |
| `composition-html-editing-*`, `html-editing/**`, handlers/rutas HTML y lifecycle de recovery | Equipo actual; no se cede CAP-029 completa |
| `NativeCompositionPreview.tsx` y componentes compartidos de timeline/biblioteca | Equipo actual, responsable del wiring |
| Allow-list/apply/store/gateway de agentes y rutas actuales | Equipo actual hasta reserva explícita CAP-025 |
| Módulos nuevos y rutas permitidas de CAP-022 | Compañero, **una vez aceptado el paquete** |
| package/lock/config común, jobs compartidos, migrations, políticas Storage/RLS, flags y despliegue | Cambio coordinado, nunca unilateral |
| Seguimiento general y porcentaje | Equipo actual; compañero entrega nota propia para consolidación |

Dos módulos distintos pueden tener conflicto semántico aunque Git no detecte conflicto textual.
Antes de cambiar interfaz/identidad/cache keys, enviar propuesta y acordar quién modifica cada consumidor.
Ninguna reserva concede ownership permanente de todos los archivos del directorio.

## 8. Base, entregas e integración

1. Confirmar colaborador, paquete, alcance y archivos reservados. Usar el commit base de §1
   o un sucesor acordado; comprobar que existe en el checkout del compañero y que contiene los
   archivos del paquete. No comenzar desde un clone remoto desactualizado ni copias divergentes.
2. Rama/checkout independiente para el compañero. Trabajar por entregas pequeñas sobre la misma
   base acordada, sin compartir un directorio mutable ni hacer rebase/merge durante cambios del otro.
3. Revisar primero el contrato; después implementación. Dependencias hacia el dominio, nunca
   importar componentes/UI o servicios IA desde el planificador/productor.
4. Cada entrega incluye CAP/R afectados, archivos, contrato, tests ejecutados/resultados,
   compatibilidad, riesgos, qué no prueba, configuración y QA pendiente. Adjuntar comandos reales,
   no solo «tests pasan»; no incluir claves ni datos privados.
5. Equipo actual revisa diff y límites, resuelve wiring compartido y ejecuta tests pertinentes
   de ambos frentes en checkout de integración. No sustituir esta comprobación con el verde de una rama aislada.
6. Actualizar seguimiento solo con evidencia; estado «implementación completada, QA pendiente»
   únicamente cuando no queden requisitos funcionales del paquete, sin extrapolar al CAP entero.
7. QA formal conjunto y migraciones/deploy/flags siguen diferidos para el tester/decisión posterior.

Comprobación estática disponible en la base actual:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
```

No ejecutar suites generales que disparen FFmpeg/render como sustituto de tests dirigidos.
Si requiere cambios SQL, preparar y revisar migraciones sin aplicarlas, acordando antes numeración:
la relectura de este corte encuentra **179 archivos**, no los 173 del corte histórico CAP-029.
Persisten cuatro grupos de prefijos repetidos: 20240117 (7 archivos), 20260721120000 (2),
20260825120000 (2), 20260826120000 (2). Este conteo no verifica aplicación ni historial de la DB.
No renombrar ni borrar migraciones del otro desarrollador.

## 9. Ficha de asignación para completar

| Campo | Propuesta / estado |
| --- | --- |
| Responsable compañero | Pendiente de nombre |
| Perfil requerido / alternativa | CAP-022 productor requiere backend/media/jobs/Supabase; si su foco es frontend, comenzar por catálogo UX CAP-029 aislado |
| Primer paquete | CAP-022, T022-1→T022-2; ampliar a T022-3 tras aceptar contratos |
| Base reproducible | Commit local 96a191b9dfb4dc1bf8060e364816bb5079a1e273 disponible; entrega/acceso remoto y aceptación pendientes |
| Reserva de archivos | Propuesta en §§5 y 7; requiere aceptación |
| Responsable integración | Equipo actual |
| Segundo paquete | CAP-025 acotado o catálogo UX CAP-029; elegir después del primero |
| Entregas / fechas | Acordar según disponibilidad, sin estimación artificial |
| QA formal / migraciones / flags / deploy | Diferidos; no autorizados por este traspaso |

Esta separación reduce solapamientos; no garantiza cero conflictos ni aprobación automática.
La decisión final de asignación corresponde al equipo, y la integración requiere revisión explícita.
