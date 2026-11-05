# Plan de implementación: agrupaciones anidadas

## Corrección de acceso y selección — 2026-11-03
La secuencia pointerdown/click seleccionaba el grupo sin conservar la selección
aditiva antes de aplicar Shift/Ctrl o Selección múltiple. Los fixtures previos
enviaban click sin pointerdown y no detectaban esa diferencia. Las acciones
estaban además al final del panel Selección. Se añade acceso «Grupos» al timeline,
acciones al inicio y lista de grupos hermanos seleccionables completos. El
servidor conserva la capacidad y el guard SQL existentes: no se habilita por UI.
Sin capacidad se explica la dependencia de despliegue/habilitación, incluso sin
selección. La validación debe incluir eventos físicos CDP, no sólo click sintético.

Estado: plan técnico con decisiones concretadas en [technical-closure.md](technical-closure.md).
Ese cierre fija contrato, límites, SQL, clientes antiguos y habilitación y prevalece
sobre las opciones iniciales de este diseño. No son capacidades disponibles.
La implementación local y sus verificaciones están descritas en
[el informe de entrega](reports/implementation.md); la habilitación remota sigue pendiente.

## 1. Diagnóstico y evidencia

Rutas relativas a la raíz del repositorio:

| Evidencia primaria | Restricción actual |
| --- | --- |
| `apps/web/src/domains/production/composition-editor/composition-document.types.ts` | Grupo estricto con 2–500 clipIds; pertenencia única global; hasta 250 grupos y 500 clips por documento. |
| `apps/web/src/domains/production/composition-editor/editor-patch.types.ts` | group.create recibe clips, sin referencias a grupos. |
| `apps/web/src/domains/production/composition-editor/editor-patch.service.ts` | Rechaza clips agrupados; mueve miembros directos y vínculos avatar–voz; group.* exige USER. |
| `apps/web/src/domains/production/composition-editor/composition-group.service.ts` | Busca un grupo por clip y normaliza listas planas; disuelve grupos de menos de dos clips. |
| `apps/web/src/domains/materials/components/composition-editor/CompositionSelectionPanel.tsx` | Solo permite agrupar clips libres. |
| `apps/web/src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx` | Repite la restricción y coordina grupo seleccionado/en edición. |
| `apps/web/src/domains/materials/components/composition-editor/CompositionTimeline.tsx` | Mapa clip→grupo único y contexto singular de edición. |
| `apps/web/src/domains/production/composition-editor/composition-timeline-batch.service.ts` | Copia grupos planos completos y rechaza selecciones parciales. |
| `apps/web/src/domains/production/composition-editor/composition-narrative-fragment.service.ts` | Reconstruye copias mediante group.create con clipIds. |
| `apps/web/src/domains/production/composition-editor/composition-narrative-extraction.service.ts` | Evalúa pertenencia y selección parcial con clipIds directos. |
| `supabase/migrations/20261006040000_narrative_extraction_atomic_receipts.sql` | Comprueba pertenencia por clipIds para extracción de voz. |
| `supabase/migrations/20261006130000_narrative_fragment_selection_guard.sql` | Impide grupos parcialmente seleccionados leyendo clipIds. |
| `supabase/migrations/20261006140000_narrative_fragment_document_delta.sql` | Reconstruye grupos planos y compara el documento propuesto completo. |

La inspección SQL obliga a incluir migraciones y pruebas de paridad: adaptar solo
TypeScript podría omitir restricciones de selección o rechazar deltas legítimos.
Estas migraciones prueban contratos versionados en el repositorio, no su despliegue.

## 2. Flujo de usuario propuesto

1. En el nivel raíz se seleccionan grupos completos y/o clips libres con Ctrl/Cmd
   o Shift. Cada grupo cuenta como una unidad, aunque abarque varias pistas.
2. Agrupar se habilita con dos o más unidades hermanas. Se crea un padre y se
   conservan las identidades, etiquetas y relaciones internas de los hijos.
3. El nuevo padre queda seleccionado. La selección explícita de unidades se
   mantiene separada del conjunto derivado de clips afectados.
4. Mover el padre desplaza todos los descendientes una vez, conservando offsets.
5. Entrar abre el nivel del grupo. La ruta `Raíz > Principal > Grupo A` permite
   volver al padre; Escape sale un nivel si no hay un gesto activo que cancelar.
6. Dentro del grupo se seleccionan sus hijos directos para editar o reagrupar.
   La selección entre niveles se rechaza con una explicación y sin cambios.
7. Desagrupar elimina solo el contenedor seleccionado y promueve sus hijos al
   padre inmediato, o a raíz. No elimina clips ni deshace subgrupos.
8. Cada acción terminada usa un comando de historial y autoguardado existente.
   Durante guardado pendiente se conserva la política actual de cola/conflictos.

Ejemplo: agrupar A(1,2) y B(3,4) produce P(A,B). Desagrupar P recupera A y B.
Agrupar A y un clip libre 5 produce P(A,5). Seleccionar A y su clip 1 a la vez
no constituye una selección válida de hermanos.

El timeline conserva pistas y profundidad de pintura. La jerarquía se presenta
mediante contenedores, nivel y expansión; no debe confundirse con los grupos de
visualización de `composition-timeline-layout.service.ts`.

## 3. Contrato de datos recomendado

Conservar `groups` como colección plana indexable; cada grupo guarda referencias
a hijos directos. Propuesta ilustrativa, aún no implementada:

```json
{
  "groupingVersion": 2,
  "groups": [
    { "id": "A", "order": 0, "clipIds": ["1", "2"] },
    { "id": "B", "order": 1, "clipIds": ["3", "4"] },
    { "id": "P", "order": 2, "clipIds": [], "childGroupIds": ["A", "B"] }
  ]
}
```

- `groupingVersion: 2` identifica la extensión jerárquica propuesta; no cambia
  el formato canónico de motion ni representa una versión de guardado.
- Ausencia del marcador mantiene interpretación legacy: solo clips y mínimo dos.
- En versión jerárquica, clipIds y childGroupIds son membresías directas; su suma
  debe ser al menos dos. childGroupIds omitido equivale a vacío para el algoritmo,
  sin materializarlo en lecturas ni alterar hashes históricos.
- Cada clip o grupo puede tener cero o un padre directo; los ancestros son derivados.
- Sin parentId persistido ni lista duplicada de clips descendientes. Derivar ambos
  evita fuentes de verdad contradictorias y mantiene las validaciones auditables.
- Mantener order global único y determinista para reducir impacto; el orden entre
  hermanos se deriva de order. No introducir reordenamiento mixto independiente.
- Mantener topes actuales de 250 grupos y 500 clips; proponer profundidad máxima
  de 8 niveles de grupos, centralizada y compartida con SQL. Validar este límite
  con QA y fixtures antes de habilitarlo; no es capacidad medida.

La ampliación requiere ajustar schemas estrictos en todos los lectores. No se
debe emitir el marcador hasta que cada consumidor y escritor sea compatible.
La primera acción que cree anidamiento agrega el marcador en la nueva versión,
sin reescribir el historial ni normalizar documentos durante GET.

### Alternativas descartadas

- Repetir todos los clips en cada ancestro: hace ambigua la pertenencia y facilita
  movimientos dobles y normalizaciones con pérdida de estructura.
- Convertir el grupo en un nuevo clip o track: ampliaría innecesariamente render,
  tiempos, audio y motion, cuando el requerimiento es organización editorial.
- Guardar parentId y listas de hijos simultáneamente: duplica relaciones mutables.

## 4. Servicios y operaciones

Crear un módulo puro de jerarquía, separado de componentes y persistencia, con:
índices de clips/grupos, padre por miembro, raíces, ruta de ancestros, descendientes,
bounds temporales y validación del grafo. Usar Maps/Sets, detección de ciclos y
recorrido acotado; construir índices una vez por documento/revisión y reutilizarlos
en UI. Validación completa O(clips + grupos + relaciones); evitar búsquedas
anidadas por clip en cada render o gesto.

| Operación | Adaptación |
| --- | --- |
| group.create | Admitir childGroupIds opcional; mínimo dos miembros totales, existentes, distintos y hermanos; envolverlos en su padre común de forma atómica. Mantener payload legacy válido. |
| group.add-clips / remove-clips | Conservar semántica de clips directos; no reinterpretar IDs de grupo como clipIds. Aplicar reglas de padre y normalización jerárquica. |
| group.move | Resolver hojas descendientes, ampliar por vínculos permitidos, validar todo y aplicar un delta único. |
| group.ungroup | Promover miembros directos y compactar order; conservar subgrupos y tiempos. |
| clip.split / remove-range | Los derivados conservan el padre directo del clip fuente. |
| clip.remove | Eliminar referencia y normalizar de hojas a raíz dentro del mismo comando. |
| Copiar/duplicar/pegar | Reasignar IDs de clips y grupos; reconstruir de hijos a padres; no compartir miembros con el original. |
| document.restore | Leer ambos contratos, validar y preservar hash/ACK e historial según mecanismos vigentes. |

Normalización propuesta: disolver grupos vacíos; si queda una sola unidad,
promoverla al padre o raíz y repetir hacia arriba. Nunca eliminar contenido ni
corregir silenciosamente un grafo inválido recibido: rechazarlo antes del reducer.
No añadir reparentado arbitrario en la primera entrega; agrupar/desagrupar cubre
el flujo solicitado con menor superficie de operaciones.

### Vínculos avatar–voz

Resolver el conjunto de hojas antes de evaluar vínculos. Si ambos extremos están
en el subárbol movido, moverlos una vez aunque pertenezcan a grupos hermanos.
Si la contraparte está libre, conservar la ampliación actual del movimiento.
Si pertenece a otro subárbol fuera del seleccionado, rechazar sin efectos parciales.
Un vínculo ambiguo siempre bloquea. Verificar pistas bloqueadas y límites también
en contrapartes añadidas. Agrupar por sí solo no modifica vínculos ni tiempos.

### Extracción narrativa

Conservar la política de grupos indivisibles: una selección que toque una raíz
agrupada debe incluir todas sus hojas. Si no, devolver motivo explícito; no
ampliar silenciosamente la extracción ni aplanar grupos. Las copias completas
reconstruyen el árbol con nuevos IDs en TypeScript y en la verificación SQL.
Conservar las restricciones específicas de extracción de voz; el nuevo contrato
no debe permitir eludir su rechazo de clips agrupados.

## 5. Persistencia, seguridad y compatibilidad

Reutilizar `PUT /api/production/hyperframes/drafts/[draftId]/document`, su límite
de 2 MiB de request, autenticación, rol, organización y precondición de hash.
IDs de grupo solo pueden resolver dentro del documento autorizado. Mantener
group.* restringido a USER y revisar document.restore/payloads completos para
evitar que un escritor incompatible elimine la jerarquía.

Reutilizar `video_composition_draft_documents` y append versionado. Las funciones
SQL narrativas necesitan migración aditiva; no modificar migraciones históricas.
Inventariar RPCs y guards vigentes y comprobar si el append general tiene otras
validaciones de formato antes de cerrar el diseño ejecutable. No afirmar que
almacenar JSONB basta para soportar el cambio.

Un conflicto conserva el documento confirmado y las intenciones pendientes;
no se reenvía ciegamente un wrap calculado sobre otra estructura. Revalidar
referencias y padre común al recuperar la versión actual.

Logs: resumen de operación, cantidad de grupos/hojas afectadas y profundidad,
con correlación existente; sin contenido del curso, credenciales o documento entero.

## 6. Fases y condiciones de avance

| Fase | Entrega | Condición de salida |
| --- | --- | --- |
| 0. Inventario | Contratos, consumidores TS/SQL, fixtures legacy y árbol propuesto | Ningún consumidor de groups sin clasificar; resolver compatibilidad y límites. |
| 1. Lectura y validación | Schemas duales, índices, validadores y migración SQL local | Fixtures legacy conservan hash y jerarquías inválidas fallan en TS/SQL. Escrituras anidadas deshabilitadas. |
| 2. Operaciones | Reducers atómicos, copia, extracción y restauración | Escenarios funcionales y paridad SQL completos; permiso y concurrencia cubiertos. |
| 3. Interfaz | Selección por unidades, ruta, expansión y navegación | QA visual/teclado en varias pistas; un comando por gesto. |
| 4. Integración | Preview/render equivalentes, documentación y piloto | Gates, rollback y lectores compatibles verificados; habilitación controlada autorizada. |

Cada fase implementable se trabaja en rama/worktree recuperable, con cambio
acotado. La planificación actual agrega solo documentos nuevos en este cambio.

## 7. Rollout y reversión

Introducir COMPOSITION_NESTED_GROUPS_ENABLED en servidor, desactivada inicialmente,
y capacidades reflejadas en UI. Contrato de cliente, precondición SQL y restauración
con marcador persistente definidos en [cierre técnico](technical-closure.md).

Orden: lectores/validadores compatibles → guards SQL compatibles → escritores y
UI compatibles → piloto → habilitación. Si los guards SQL no están disponibles,
las escrituras jerárquicas permanecen bloqueadas también en servidor.

Tras persistir el primer árbol, deshabilitar la creación no permite volver a
lectores antiguos. Rollback seguro: conservar lectores, SQL y operaciones necesarias
para documentos existentes, y desactivar nuevas creaciones jerárquicas. No aplanar
ni borrar documentos. Restaurar una versión plana es una acción explícita sobre
un borrador, no una estrategia global de rollback.

## 8. Validación y límites

Pruebas obligatorias: validación de grafo, padres duplicados, ciclos, profundidad,
límites, wrap mixto, ungroup interno/raíz, normalización en cascada, duplicación,
split, extracción parcial/completa, vínculos externos, pistas bloqueadas,
concurrencia, historial y payloads de escritor antiguo.

Verificar igualdad de HTML/timing/audio derivados antes y después de agrupar sin
mover clips. Cambia el hash del documento por metadatos editoriales; no exigir
igualdad del hash como prueba de equivalencia audiovisual.

Comandos previstos: npm run typecheck; npm run test:composition-timeline
--workspace=apps/web; npm run test:hyperframes --workspace=apps/web;
npm run test:security-boundaries; npm run docs:check; npm run openspec:validate;
npm run verify:pr al preparar entrega. Agregar pruebas SQL reproducibles en
entorno aislado para los guards modificados; las suites TS no acreditan RLS/RPC.
QA visual y build conservan su gate de CI; documentar ejecución o límites reales.

No se promete capacidad de 100000 usuarios por este cambio. Se mantiene el
documento acotado y se medirá coste de validación y selección con fixtures máximos;
la capacidad global requiere SLO y prueba de carga independiente.
