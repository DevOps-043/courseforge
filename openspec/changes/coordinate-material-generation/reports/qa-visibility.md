# QA visible en materiales híbridos

## Diagnóstico confirmado

El curso de staging dca8d686-2c8a-413f-b4a6-5b1e4b187547 muestra veinte
lecciones listas para QA y dos sesiones guardadas. Al abrir Hub por navegador,
«Aprobar materiales completos» sí existe al final de su apartado. Academy no
ofrece su panel de revisión: HybridMaterialsWorkspace pasaba coordinatedReview,
que oculta MaterialsQaReviewPanel. No se aprobó ni modificó contenido del curso.

## Cambio

HybridMaterialsQaPanel coloca la revisión conjunta fuera de los destinos
ocultables, muestra estados y bloqueos y usa APPROVE/MATERIALS existente.
Academy recupera envío a QA, notas, aprobación y rechazo mediante sus acciones
actuales. Hub oculta únicamente el botón conjunto duplicado cuando está dentro de
la vista coordinada; el síncrono puro y Plan conservan su aprobación.

El permiso procede de snapshot.canReview; los estados del cliente orientan la
habilitación y el servidor sigue validando identidad, fuentes, versiones y ambos
destinos. Un fallo de confirmación refresca ambos estados porque Academy puede
haberse aprobado antes de un conflicto en Hub. No se cambia el backend ni se
convierte la generación completada en aprobación automática.

## Verificación

- npm run typecheck: código 0.
- npm run test:course-delivery: 70/70, código 0. Log local
  .tmp/hybrid-qa-delivery-tests.log.
- node scripts/test-hybrid-materials-qa.cjs: siete escenarios de renderizado real
  React aprobados. Comprueba QA fuera del destino oculto, controles de Academy,
  permiso, generación, contenido pendiente, aprobación vigente y síncrono puro.
- ESLint de los tres componentes: --max-warnings 0, código 0. El intento inicial
  incluyó un script fuera de basePath y terminó con advertencia; se corrigió el
  alcance. Los dos scripts pasan node --check y sus bundles compilan con esbuild.
- OpenSpec coordinate-material-generation estricto: código 0.
- git diff --check aprobado.

El fixture interactivo se inicia con node scripts/qa-hybrid-materials-review.cjs.
Usa componentes reales, datos/acciones simulados y CSP sin solicitudes externas;
no contiene credenciales ni genera contenido. Chrome agotó el acceso tanto por
127.0.0.1 como por localhost. No se verificaron diseño, interacción, notas ni
aprobación con un navegador local; el renderizado no sustituye esa comprobación.
El servidor temporal quedó detenido al terminar.

Revisión del mismo agente: sin cambios de permisos, API, guardas o validadores;
el controlador conserva revisión y el ref local evita solicitudes dobles de
aprobación. No hay migraciones, dependencias nuevas, commit, push ni despliegue.
La confirmación visual y funcional en staging requiere desplegar esta entrega.
