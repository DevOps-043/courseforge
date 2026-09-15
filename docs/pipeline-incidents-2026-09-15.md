# Correcciones del pipeline — 15 de septiembre de 2026

## 1. Objetivo y alcance

Resolver las incidencias del reporte `SofLIA_Reporte_de_incidencias_Engine_2026-09-15.md`: duplicación al crear, generación inicial sin salida, fuentes incompletas, materiales irregulares y cancelación/reintentos que permanecen cargando. Se aplicaron los criterios de `docs/prompt_maestro.md`.

Los cambios son de código y migración. No se modificaron cursos ni configuraciones de la base remota durante las pruebas. No se aplicó la migración remota ni se desplegó la aplicación.

## 2. Diagnóstico técnico

- El formulario permitía llamadas concurrentes. Cada llamada insertaba un nuevo artefacto sin identidad estable de solicitud.
- La función inicial devolvía un error sin sacar el artefacto de `GENERATING`. El cliente de Gemini se construía al importar el módulo, incluso cuando se había seleccionado OpenAI.
- En desarrollo, las acciones esperaban la ejecución completa del trabajo. El formulario quedaba ocupado durante toda la generación.
- Curación borraba fuentes automáticas al reiniciar. Los errores de cuota podían repetirse por lote; la detección de procesos detenidos ignoraba cualquier ejecución que ya tuviera alguna fuente.
- La base conservaba una restricción de dos intentos de curación.
- Materiales reiniciaba lecciones `GENERATING` sin comprobar que hubieran expirado. Sus escrituras no verificaban la versión del trabajo, y cancelar no invalidaba respuestas tardías.
- La terminación de materiales cambiaba a `VALIDATING` sin iniciar esa validación. Las consultas fallidas podían interpretarse como ausencia de lecciones pendientes.
- Las fuentes podían asociarse por título aunque los identificadores de las lecciones fueran distintos.

## 3. Implementación

- **Artefactos:** bloqueo inmediato del envío, UUID estable de solicitud respaldado por la clave primaria, identificación de ejecución en metadata, despacho local sin bloquear la respuesta, errores persistidos y visibles, recuperación de generaciones antiguas y límites de tiempo de solicitudes de IA.
- **Curación:** conservación de fuentes, reanudación por cobertura pendiente, tiempos y reintentos acotados, parada inmediata ante errores permanentes, progreso persistido y finalización condicionada al intento vigente. Una búsqueda incompleta termina bloqueada con las lecciones pendientes identificadas.
- **Materiales:** inicio, selección de lección, cancelación y guardado transaccionales. La versión del proceso y la iteración de la lección impiden que trabajos antiguos sobrescriban resultados nuevos. Los componentes válidos de un resultado parcial se conservan junto con `NEEDS_FIX`. Se ejecuta la validación al terminar una generación completa.
- **Fuentes:** verificación previa por lección y cantidad requerida, preservando la ruta explícita `B_NO_SOURCE`. Los identificadores tienen prioridad sobre títulos.
- **Seguridad:** las nuevas funciones SQL son `security invoker`, requieren `service_role` y se invocan después de la autorización existente. No se añadieron dependencias de producción.

La lógica de escritura transaccional está en `supabase/migrations/20260915120000_pipeline_generation_commits.sql`. Los adaptadores de aplicación permanecen en los dominios y los trabajos de `apps/web/netlify/functions`.

## 4. Pruebas y resultados

Comandos desde la raíz:

```powershell
npm run verify
npm run build
npm run test:curation -w apps/web
npm run test:materials-generation -w apps/web
npm run test:model-json-response -w apps/web
```

Las comprobaciones ejecutadas pasan: lint, TypeScript, ausencia de ciclos, inventario de migraciones, seguridad, regresiones generales, curación, materiales y contratos JSON.

Prueba PostgreSQL aislada usando los esquemas del repositorio y la nueva migración:

```powershell
npm install --prefix "$env:TEMP/courseforge-pipeline-db-tests" --no-save --package-lock=false @electric-sql/pglite
node scripts/test-pipeline-generation-db.mjs "$env:TEMP/courseforge-pipeline-db-tests/node_modules/@electric-sql/pglite"
```

Comprueba entrega duplicada, cancelación, versión antigua, selección exclusiva de lección, rollback ante escritura inválida, conservación parcial, reinicio y permisos. El motor de pruebas se instala fuera del repositorio. No representa una prueba de carga ni concurrencia distribuida real.

Pruebas reales de proveedores, después de compilar las suites anteriores:

```powershell
node scripts/test-pipeline-providers.mjs --live
```

Este comando consume tokens y no guarda cursos. Usa `.env.local`; permite ajustar `PIPELINE_SMOKE_BASE_MODEL`, `PIPELINE_SMOKE_SEARCH_MODEL` y `PIPELINE_SMOKE_MATERIALS_MODEL`. Se verificaron una base válida con tres nombres y tres objetivos, dos fuentes web con validación HTTP/contenido y un ejercicio generado. Las solicitudes de control a Google y OpenAI respondieron correctamente. Esto no confirma ni descarta problemas históricos de cuota ni prueba todas las configuraciones de organizaciones.

El build presenta cuatro advertencias de trazado de archivos en el módulo de plantillas de producción, fuera de los archivos corregidos. Las pruebas existentes de PDF imprimen advertencias para documentos deliberadamente inválidos y finalizan correctamente.

## 5. Aplicación y riesgos residuales

1. Aplicar primero la migración SQL mediante el proceso habitual de despliegue de Supabase.
2. Desplegar coordinadamente frontend/acciones y funciones background. Los mensajes nuevos llevan versión/intento; no mezclar versiones de aplicación y workers.
3. Probar en el entorno desplegado: doble clic, navegación durante generación, cancelación durante búsqueda, reanudación, fallo del proveedor y un curso completo con todas sus lecciones.
4. Verificar que la interfaz muestre error o cobertura pendiente cuando corresponda, y que solo los resultados completos lleguen a QA.

No se realizó una prueba de navegador autenticado del pipeline entero ni un despliegue Netlify real. El éxito de los smoke tests no garantiza disponibilidad futura, saldo o ausencia de límites por organización.

Curación dispone de un presupuesto de diez minutos por ejecución y preserva lo generado para reanudar. El vencimiento se detecta al consultar el estado, no mediante un monitor permanente. La ejecución local continúa en el proceso de desarrollo: reiniciar ese proceso interrumpe el trabajo y la recuperación por expiración permite reintentarlo.

Para rollback, revertir primero el código de aplicación; las nuevas funciones SQL pueden permanecer sin uso. No restaurar la restricción antigua de dos intentos sobre datos con intentos superiores. No hay borrado de cursos ni transformación destructiva de contenidos.

## 6. Mejoras adicionales

Como evolución independiente, una cola durable con recuperación programada permitiría reanudar automáticamente ejecuciones tras caídas del proceso. No es una garantía que ofrezca este cambio ni se introdujo una segunda infraestructura de ejecución para corregir estas incidencias.
