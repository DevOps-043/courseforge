# Implementación local de agrupaciones anidadas

Fecha: 2026-10-30. Estado: código implementado y verificaciones locales realizadas;
sin despliegue ni aplicación de SQL remoto. La compuerta global conserva fallos
anteriores identificados abajo; no se declara una entrega global en verde.

## Base y aislamiento

- Base: `13774405f90d5d3dd1d87989673c6b4976269f54`.
- Rama de entrega: `codex/nested-composition-groups-final`.
- Worktree activo: `C:/Users/Lordg/.codex/worktrees/nested-composition-groups/courseforge`.
- El gestor de worktrees quedó inicialmente pendiente; el trabajo comenzó en un
  checkout local aislado y se trasladó al worktree activo cuando quedó disponible.
- Los cambios anteriores de exportación por intervalo se conservaron en su checkout.
- No se copiaron .env, secretos ni configuraciones personales.
- Se instaló el lockfile con `npm ci --ignore-scripts --no-audit --no-fund` en el
  checkout aislado anterior. El worktree activo reutiliza esas dependencias con
  junctions locales ignoradas por Git. CI instala desde el lockfile normalmente.
- PGlite 0.3.14 es dependencia temporal de verificación; no cambió el lockfile ni
  se añadió una dependencia de producción.

## Resultado funcional

Se implementó el contrato `groupingVersion: 2` con `childGroupIds` y pertenencias
directas de clips. Se mantienen lectura legacy, hashes históricos y el marcador
persistente al restaurar snapshots planos. El grafo rechaza ciclos, padres
duplicados, referencias inválidas, exceso de profundidad y listas de membresías
que no pueden corresponder a un árbol con padre único.

El servicio puro de jerarquía deriva padres, raíces, hojas, profundidad, límites
y unidades seleccionables. El mismo reducer de agrupación se usa al aplicar
patches y proyectar la duración del canvas; evita que un movimiento anidado
calcule su extensión con una lista plana incompleta.

La interfaz permite seleccionar grupos hermanos con selección aditiva, crear
contenedores mixtos, entrar por niveles, navegar por la ruta y salir con Escape.
Limpiar la selección del timeline conserva el nivel actual. Desagrupar espera
el ACK antes de actualizar la selección y promueve hijos sin eliminar contenido.
Los bounds del timeline y la resolución de selección se memorizan por documento
y contexto para no reconstruir el grafo en cada actualización del playhead.

La selección de unidades se deriva del conjunto de hojas y del contexto de
edición mediante una función pura compartida: no se añadió un segundo estado
mutable de membresías que pudiera divergir de la selección existente.

Las operaciones conservan vínculos avatar–voz, pistas bloqueadas, límites,
normalización, clips derivados, copia jerárquica y las restricciones de selección
completa. Las operaciones masivas mantienen sus presupuestos anteriores; no se
promete duplicar cualquier documento de 500 clips en una sola acción.

## Persistencia y seguridad

Las capacidades se anuncian fuera del JSON hasheado. Las escrituras jerárquicas
requieren cliente compatible, identidad/rol/tenant y hash vigente. La negociación
de versión no concede permisos. Los escritores SYSTEM confiables identifican su
compatibilidad desde el llamador interno; el payload HTTP no admite auditSource.
La política de habilitación continúa aplicándose a esos escritores.

La creación requiere `COMPOSITION_NESTED_GROUPS_ENABLED=true` y confirmación del
contrato SQL. La consulta de capacidad tiene timeout, fallo cerrado, caché acotada
y coalescencia. Desactivar creaciones permite simplificar relaciones de ancestros
ya existentes al desagrupar; impide recrearlas mediante nuevas acciones o rehacer.

El guard de inserción valida el grafo y bloquea downgrade desde append, wrapper
legacy e inserciones directas. La migración narrativa reconstruye hijos antes
que padres con IDs deterministas y comprueba igualdad completa del delta.
El RPC de capacidad se publica al final de la segunda migración, no antes de
tener los guards narrativos compatibles. Se mantienen permisos privados y la
serialización NOWAIT por borrador.

## Verificaciones con resultado comprobado

| Verificación | Resultado |
| --- | --- |
| Suite nueva de agrupaciones | 18 pruebas aprobadas; compilación TypeScript de la suite incluida. |
| Regresión de ocho archivos afectados | 130 pruebas aprobadas: documento, patches, persistencia de grupos, batch/edit de timeline, extracción y transporte, guardado HTTP cliente. |
| PostgreSQL en memoria | 6 pruebas aprobadas; fixtures compartidos TS/SQL, profundidad 8/9, máximos 250/500, downgrade, permisos, copia narrativa y delta inválido. |
| Chromium headless | Selección aditiva, capacidad desactivada/activada, agrupación, dos niveles, ruta, Escape y desagrupación aprobados. |
| Seguridad | 30 pruebas aprobadas de fronteras existentes. |
| Arnés | 20 pruebas aprobadas, con repositorios temporales propios. |
| Lint y tipos web | Aprobados dentro de `npm run verify`, antes de detenerse en ciclos; tipos y lint de los componentes se repitieron y aprobaron tras la optimización final. |
| Migraciones | Version guard aprobado: 213 archivos SQL, sin nuevas colisiones. |
| OpenSpec de este cambio | Validación estricta aprobada. |
| Enlaces documentales | Comprobación aprobada: 154 documentos, incluido el informe. |

La igualdad de compilación de preview/render se comprueba con documentos que
solo cambian agrupación; no se confunde el hash editorial con equivalencia visual.
La fixture máxima de grafo se resuelve en pocos milisegundos en estas pruebas;
la validación SQL máxima observada fue aproximadamente 179 ms. No son SLO,
benchmarks de producción ni garantía de 100000 usuarios simultáneos.

## Fallos generales anteriores y evidencia

1. `npm run verify:pr` se detiene en OpenSpec: `diagnose-font-catalog` no contiene
   deltas. Sus archivos ya existen en la base y no fueron modificados.
2. `npm run verify` supera lint y tipos y se detiene en 11 ciclos. Se comprobó
   cada arista reportada contra las importaciones del commit base mediante el
   resolver TypeScript: las 11 listas de aristas ya estaban presentes. No se
   cambiaron las reglas ni se añadieron excepciones para obtener verde.
   La evidencia persistida está en [architecture-baseline.json](architecture-baseline.json).
3. La suite HyperFrames completa se detiene en un módulo anterior que usa el
   alias `@/lib/server/outbound-http` sin resolución equivalente en Node CommonJS.
4. La suite completa de preview contiene una expectativa anterior de marca
   `SofLIA - Engine` mientras el producto configura `SofLIA Architect`. Se ejecutó
   y registró ese fallo; no se modificó el test ajeno ni se declara aprobada la
   suite completa. La equivalencia de agrupaciones sí está cubierta por la suite nueva.

Estos bloqueos no se omitieron: se ejecutaron verificaciones afectadas adicionales
para obtener evidencia del cambio, conservando los fallos globales visibles.

## Reproducción

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
npm ci
npm run test:composition-nested-groups
npm run test:composition-timeline --workspace=apps/web
npm install --prefix .tmp/sql-verification --no-save --package-lock=false --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
npm run test:composition-nested-groups:sql
npm run qa:composition-nested-groups
npm run test:security-boundaries
npm run test:harness
npm run docs:check
npm exec -- openspec validate nested-composition-groups --strict --no-interactive
npm run verify:pr
```

La QA usa Chromium local con perfil descartable y no accede a cuentas. El runner
puede recibir CHROME_PATH. PGlite puede recibirse por NESTED_GROUPS_PGLITE_PATH
cuando se reutiliza la instalación temporal. Los fallos generales anteriores
siguen siendo esperables hasta que se resuelvan en sus cambios correspondientes.

## Revisión adversarial y límites

Revisión realizada por el mismo agente; no se afirma independencia. Se corrigieron
promoción durante rollback, proyección de duración, restauración del marcador,
origen SYSTEM, navegación al limpiar selección y rechazo acotado de entradas
duplicadas. Las pruebas verifican estados finales y ausencia de efectos parciales.

No se ejecutaron SQL remoto, carga multiusuario, render cloud, publicación ni
build de CI. Las tablas mínimas de PGlite no acreditan todo el RLS de Supabase.
El smoke comprueba interacción con componentes reales y estilos mínimos de
fixture; no certifica el diseño completo del editor con el CSS de producción.
Quedan para la habilitación: integración en Supabase descartable con esquema/RLS
reales, QA visual completa, CI/build y resolución de las compuertas anteriores.

## Habilitación y rollback

1. Resolver los bloqueos generales e integrar esta rama mediante revisión.
2. Validar ambas migraciones en Supabase descartable y desplegar lectores compatibles.
3. Aplicar, con autorización, `20261029230000_nested_composition_groups.sql` y
   `20261029230100_nested_narrative_fragment_groups.sql`, en ese orden.
4. Confirmar el RPC de capacidad y después habilitar la variable en servidor.
5. Ante fallos, desactivar nuevas creaciones y conservar lectores/guards. No
   retirar soporte del marcador ni aplanar documentos históricos.

Ninguno de esos efectos remotos se ejecutó en esta tarea. El cambio OpenSpec
permanece abierto hasta la integración y no se archivó anticipadamente.
