# Cierres técnicos del plan

Fecha: 2026-10-29. Estado: decisiones de diseño cerradas para implementación;
verificación funcional y SQL pendientes de desarrollar. No hay cambios de runtime.
Este documento concreta [design.md](design.md); prevalece ante sus opciones iniciales.

## 1. Contrato fijado

Se adopta `groupingVersion?: 2` en el documento y `childGroupIds?: string[]` en
cada grupo. Se conserva `clipIds: string[]`, ahora como hijos clips directos.
El grupo puede contener solo grupos, solo clips o ambos. No se persiste parentId,
descendientes, offsets del contenedor ni una segunda representación editable.

| Regla | Decisión |
| --- | --- |
| Documento sin marcador | Legacy: childGroupIds no permitido; mínimo dos clipIds por grupo. |
| Documento con marcador 2 | Mínimo dos hijos directos totales; clipIds puede estar vacío. |
| Lectura | No inyectar campos ni defaults en JSON; conservar bytes semánticos/hash histórico. |
| Primera escritura anidada | Añadir marcador 2 en una nueva versión; mantener IDs y grupos existentes. |
| Marcador desconocido | Rechazo explícito; no inferir legacy. |
| IDs | Usar editorIdSchema vigente; clip y grupo se resuelven en espacios tipados distintos. |
| Duplicados | Prohibidos en cada lista y entre padres para el mismo tipo de miembro. |
| order | Único global entre grupos; al crear, compactar a 0..n-1 antes de asignar el siguiente. |

El marcador es **persistente desde su introducción**: un documento que alcanzó
versión de agrupación 2 no vuelve a omitirlo, aunque se desagrupen todos sus
contenedores. Las versiones históricas siguen intactas y sin marcador.
No confundirlo con format, motion.schemaVersion ni el contador de guardados.

### Operación group.create

Contrato extendido: groupId, clipIds (obligatorio, puede ser [] en modo jerárquico),
childGroupIds opcional, label opcional y type existente. La suma de hijos debe
ser al menos dos. Los payloads legacy con dos clips siguen siendo válidos.
Todos los miembros deben tener el mismo padre inmediato, incluido raíz.

El servidor deriva el padre común; no acepta un parentId aportado como autoridad.
Si es un grupo, sustituye en él los miembros seleccionados por el nuevo grupo.
El nuevo ID no puede existir y los IDs referenciados deben existir antes de la
operación. Se valida el resultado completo y se persiste una sola acción.
Un grupo con dos hijos conserva al menos dos hojas por invariantes del árbol.

## 2. Límites y normalización fijados

Constantes de implementación: COMPOSITION_GROUP_MAX_DEPTH = 8,
COMPOSITION_MAX_GROUPS = 250, COMPOSITION_MAX_CLIPS = 500 y
COMPOSITION_GROUP_MAX_DIRECT_MEMBERS = 500. Los tres últimos conservan cotas
vigentes o su máximo equivalente; son contratos, no resultados de carga.

Profundidad: una raíz es nivel 1; un grupo en nivel 8 puede tener clips y no
grupos adicionales. Reagrupar evalúa también la nueva profundidad de todos los
descendientes. Si excede el tope, se rechaza, sin truncar el árbol.
El grafo tiene padre único, por lo que relaciones totales no superan 750 con
estas cotas; implementar recorridos acotados sin expansión combinatoria.
SQL usará los mismos valores; una prueba de paridad impedirá divergencias.

Normalizar solo después de operaciones admitidas sobre documentos válidos:
vacío → disolver; una unidad → promover; repetir de hojas a raíz; compactar order.
Cambiar de padre no cambia ID, posición temporal, pista, motion ni fuente del clip.
Un grafo de entrada inválido se rechaza; no se repara silenciosamente.

## 3. Inventario de consumidores y acciones

Rutas bajo apps/web/src, salvo indicación. El inventario cubre consumidores
semánticos identificados por búsqueda; las transferencias genéricas de documento
también se incluyen por compartir schemas, hash y serialización.

| Archivos / familia | Acción antes de habilitar |
| --- | --- |
| domains/production/composition-editor/composition-document.types.ts; editor-patch.types.ts | Schemas duales, restricciones y payload extendido. |
| composition-group.service.ts; composition-group-color.service.ts | Índices padre/raíz/hojas, bounds y colores jerárquicos. |
| editor-patch.service.ts | Wrap, move, ungroup, split/remove y normalización; source USER. |
| composition-document.factory.ts | Reconciliación jerárquica; preservar marcador al construir el documento sincronizado. |
| composition-timeline-batch.service.ts; composition-timeline-edit.service.ts | Copia, ripple, roll/slide y coordinación por unidades/descendientes. |
| composition-selection-layout.service.ts | Elegibilidad y transformación de selección sin saltar límites del nivel. |
| composition-narrative-extraction.service.ts; composition-narrative-fragment.service.ts | Pertenencia por raíz, restricciones de voz, copia de árbol y paridad del delta. |
| domains/materials/components/composition-editor/NativeCompositionPreview.tsx; CompositionTimeline.tsx; CompositionSelectionPanel.tsx; CompositionTimelineWorkspace.tsx | Estado de selección y navegación, eligibility única, arrastre y callbacks. |
| composition-document.service.ts; composition-document-version.ts; composition-document-save-request.ts | Capacidad, persistencia, concurrencia y tratamiento de clientes incompatibles. |
| composition-command-history.ts; composition-selection-clipboard.ts | Snapshots, undo/redo y clipboard compatibles; no convertir todo checkpoint en referencia SQL obligatoria. |
| composition-preview-operation-policy.ts; compilador, snapshot/export y adaptadores preview/render | Schemas compatibles y pruebas de equivalencia; grupos siguen siendo metadatos editoriales. |
| Políticas/herramientas del agente y restauración/reconciliación completa | No permitir pérdida indirecta de relaciones ni nuevas facultades group.*. |

Los nombres sin directorio en la tabla pertenecen a
`apps/web/src/domains/production/composition-editor/`. Los consumidores genéricos
se validarán con fixtures del documento completo en fase 1; el inventario no
equivale a haber ejecutado esas rutas ni a una auditoría de producción.

## 4. Cierre del contrato SQL

La última definición de append v2 encontrada en migraciones versionadas es
`supabase/migrations/20260815010000_replace_composition_document_append_rpc.sql`.
Usa lock NOWAIT del borrador, tenant, hash esperado y outcomes explícitos.
La tabla definida en `20260812180000_create_video_composition_draft_documents.sql`
almacena JSONB y format text; esas definiciones no validan la jerarquía.
No se deduce de esto que una base remota tenga estas mismas funciones.

| Función versionada | Cambio requerido |
| --- | --- |
| public.append_video_composition_draft_document_v2 y wrapper legacy | Validar jerarquía y prohibir retirar el marcador de un documento ya migrado; conservar outcomes y bloqueo fail-fast. |
| public.commit_narrative_voice_extraction (20261006040000) | Reconocer pertenencia a grupos bajo ambos contratos; conservar rechazo de voz agrupada. |
| private.narrative_fragment_selected_clips (20261006130000) | Evaluar hojas de raíces para rechazo de selección parcial. |
| private.narrative_fragment_document_delta (20261006140000) | Copiar árbol completo, IDs y order deterministas, marcador y comparación exacta. |
| public.commit_narrative_fragment (20261006150000) | Mantener recibos/idempotencia y propagar rechazos del nuevo delta. |
| public.append_html_editing_revision (20261005210000); public.commit_html_editing_legacy_adoption (20261008100000); public.commit_generated_deck_initialization (20261011010000) | Revisar sus llamadas al append y preservar jerarquía/marcador en documentos completos. |

Migración nueva y aditiva: helper privado de validación/resolución compartido por
los guards, reemplazos compatibles y verificación de disponibilidad. Sin nuevas
tablas ni índices para este requerimiento. Conservar SECURITY, search_path,
REVOKE/GRANT y permisos existentes; helpers privados sin acceso público.
Verificar también inserciones directas a la tabla: la prohibición de downgrade
debe cubrir todas las escrituras mediante un guard de inserción, usando la
serialización por borrador y política fail-fast existentes. Un escritor antiguo
no debe poder evitarla usando el wrapper o una escritura directa privilegiada.

### Estrategia de prueba SQL fijada

Usar PostgreSQL local en memoria mediante PGlite, patrón ya presente en
`scripts/test-course-delivery-sql.mjs`. Dependencia temporal aislada, sin modificar
lockfile ni leer .env; el runner de esta capacidad se construirá en fase 1.
La dependencia PGlite no está instalada en `.tmp/sql-verification` en este entorno.

Capas: fixtures JSON compartidos TS/SQL para el helper puro; tablas y roles mínimos
para append/guards; pruebas de recibos y rollback atómico. Probar aislamiento tenant,
versión obsoleta, downgrade, ciclos, duplicados, profundidad 8/9, wrapper legacy,
copia completa y parcial, y voz agrupada. Roles mínimos son fixtures de prueba,
no evidencia de equivalencia con RLS ni del esquema completo de producción.
Antes de piloto, repetir integración en una instancia Supabase descartable con
migraciones reales y roles anon/authenticated/service_role, sin datos de producción.

Orden determinista para copia de grupos: asignar ordinales por order original
y desempate por ID; crear grupos de hijos a padres, pero conservar el mapeo
precalculado. SQL y TypeScript deben producir iguales IDs, listas y etiquetas.

## 5. Clientes antiguos, habilitación y reversión

Se fija la variable **servidor** `COMPOSITION_NESTED_GROUPS_ENABLED`, true exacto
para habilitar y false por defecto. Es una variable nueva a implementar, no una
configuración disponible. No usar NEXT_PUBLIC como decisión de autorización.

El GET de documento agregará capacidades fuera del JSON hasheado:
`capabilities.groupingVersion: 2` y `capabilities.canCreateNestedGroups: boolean`.
El cliente compatible enviará `X-Composition-Grouping-Version: 2` en escrituras.
La ausencia solo es compatible con documentos y operaciones legacy. Si el actual
o el solicitado usa jerarquía, exigir la capacidad; si falta devolver HTTP 409
con reason `COMPOSITION_GROUPING_CLIENT_OUTDATED` y mensaje español de recarga.
Es negociación de compatibilidad, no prueba de identidad ni permiso.

El servicio volverá a validar grafo, tenant, source y hash independientemente
del header. Un hash inválido/obsoleto conserva el tratamiento vigente.
El guard SQL impedirá downgrade del marcador incluso desde un backend anterior.
Los backends antiguos no quedan soportados para editar árboles: el fallo debe
conservar el documento, y su retirada precede al piloto.

Restauración: conservar snapshots de sesión, incluidas proyecciones legítimas de
historial. No exigir que cada checkpoint sea una fila histórica exacta, porque
el historial admite rebaseDocuments. En documentos ya migrados, restaurar un
snapshot plano produce una **nueva** versión con marcador 2 y sus grupos planos;
el snapshot/historial original permanece inmutable. La normalización del marcador
ocurre solo en la escritura y se devuelve como documento confirmado/ACK.

Si la habilitación está apagada, rechazar toda introducción de nuevas relaciones
grupo→grupo, incluso por restore/reconcile, sin bloquear el movimiento,
desagrupación, eliminación o edición compatible de árboles existentes. Rehacer
una acción que reintroduciría un anidamiento también se bloquea con explicación
y conserva su checkpoint; no se avanza el cursor hasta ACK.

Precondición operativa: desplegar lectores compatibles y migración primero;
verificar helper/versión SQL antes de habilitar. Sin confirmación de disponibilidad,
capabilities.canCreateNestedGroups es false aunque la variable diga true.
No consultar el catálogo SQL por cada gesto: verificar capacidad por despliegue
con caché acotada y fallo cerrado, con identificador de contrato devuelto por RPC
de capacidad restringido a servidor. No deducir compatibilidad solo de una env.

Rollback: apagar creaciones nuevas, conservar lectores/guards, operaciones seguras
y documentos; no regresar a binarios incompatibles ni aplanar contenido. Si se
necesita piloto por organización, usar la configuración tenant existente o definir
un control específico antes del despliegue, sin inventar una tabla en esta fase.

## 6. Qué está cerrado y qué exige ejecución

Cerrados: forma del contrato, límites, reglas de edición, inventario estático,
funciones SQL afectadas, estrategia de pruebas, capacidad de cliente, flag y rollback.

Pendientes de implementación: fixtures ejecutables, helpers y migraciones,
runner SQL, negociación de capacidades, pruebas de paridad, QA, rendimiento y
verificación del entorno elegido para piloto. Son tareas funcionales de fases 1–4,
no incertidumbres sobre el diseño ni resultados de prueba ya obtenidos.
