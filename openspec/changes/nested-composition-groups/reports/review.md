# Evidencia de planificación

Fecha: 2026-10-29. Alcance: inspección estática del checkout local y diseño.

## Hechos comprobados

- El documento y los patches representan grupos planos con clipIds.
- UI y reducer impiden agrupar clips que ya tienen grupo.
- El movimiento considera pistas bloqueadas, límites y vínculos avatar–voz.
- La copia y extracción narrativa reconstruyen grupos planos.
- Las migraciones narrativas contienen guards y reconstrucción SQL dependientes
  de clipIds; existe comparación de documento completo para validar el delta.
- La ruta de documento autoriza sesión/rol/tenant y utiliza precondición de hash.
- El checkout contiene cambios previos de exportación por intervalo; no se editaron.

## Decisiones propuestas

Jerarquía mediante childGroupIds directos, marcador groupingVersion: 2,
profundidad máxima inicial de 8, selección de hermanos, desagrupación por nivel,
normalización con promoción y extracción indivisible por raíz. Son decisiones
de diseño pendientes de implementación y pruebas, no hechos del producto actual.

## Revisión de riesgos del plan

- Incluir SQL evita que el nuevo formato eluda guards que solo ven clips directos.
- Mantener IDs y metadatos legacy evita migraciones masivas e historial reescrito.
- Separar selección explícita y hojas evita confundir grupo con todos sus clips.
- Validación completa antes del reducer evita reparaciones silenciosas con pérdida.
- Rollback conserva lectores nuevos: ocultar el botón no vuelve compatibles a los antiguos.
- Las nuevas capacidades no conceden permisos al agente ni alteran tenancy.

## Verificaciones

- `npm run docs:check`: exit 0; enlaces locales verificados en 157 documentos.
- `npm run openspec:validate`: exit 1; el ejecutable `openspec` no está disponible
  en el entorno. No se instalaron dependencias ni se declara validación OpenSpec exitosa.
- Revisión estática: proposal, design, tasks, spec con Requirements/Scenarios y
  este informe presentes; tareas funcionales pendientes y rutas de evidencia locales.

No se ejecutaron suites de producto, QA visual, pruebas SQL, render ni cargas:
no hay implementación funcional nueva que esas verificaciones puedan acreditar.
No se inspeccionó base de datos remota ni se afirma qué migraciones están aplicadas.

## Cierre técnico posterior

Decisiones definitivas del plan en [technical-closure.md](../technical-closure.md).
El inventario añadió reconciliación del documento, ripple/roll/slide y llamadas
SQL desde edición HTML e inicialización. El append v2 versionado no valida el
grafo: se incluyó guard SQL transversal y marcador persistente contra downgrade.
El historial admite snapshots rebasados; se mantiene su contrato, sin exigir que
todo checkpoint coincida con una fila histórica persistida.

Verificaciones del cierre:

- `npm run docs:check`: exit 0; 158 documentos verificados.
- `npm exec --yes --cache <TEMP>/courseforge-openspec-cache --package
  @fission-ai/openspec@1.8.0 -- openspec validate nested-composition-groups
  --strict --no-interactive`: exit 0, Change 'nested-composition-groups' is valid.
  Ejecución temporal aislada; no se modificaron package.json ni lockfile.
  El primer intento restringido falló por ENOTFOUND; el reintento con acceso
  de red permitió ejecutar el validador oficial.
- `git diff --check -- openspec/changes/nested-composition-groups`: exit 0;
  el cambio sigue sin seguimiento, por lo que este comando no certifica por sí
  solo los archivos nuevos. docs:check sí incluye documentos sin seguimiento.
- Herramientas locales: no se encontraron comandos psql, docker ni supabase;
  tampoco la dependencia temporal PGlite en .tmp/sql-verification.

Estos resultados cierran validación documental del cambio específico, no el
gate global de todos los cambios OpenSpec ni pruebas funcionales/SQL pendientes.
