# Verificación local

Fecha: 21 de noviembre de 2026. Revisión realizada por el mismo agente; no es independiente.

## Resultados

| Comprobación ejecutada | Resultado |
|---|---|
| `npm run test:coordinated-materials` | 60 pruebas de sesiones + 31 de generación + 5 de recuperación + 6 de SQL aprobadas |
| `npm run test:course-sources -w apps/web` | 78 aprobadas |
| Repetición dirigida de `test:course-delivery` tras ajustes del manejador | 60 aprobadas |
| `npm run typecheck` | Aprobado |
| ESLint dirigido a implementación y pruebas | 0 errores; 4 advertencias existentes en LessonMaterialsCard/useMaterials |
| `npm run lint` | 0 errores; falla por 5 reducciones no conciliadas con el baseline de cambios anteriores |
| `node scripts/qa-hybrid-materials.cjs` | Aprobado con Chrome local, motores simulados y peticiones externas bloqueadas; escritorio, móvil, claro y oscuro |
| `npm run db:migrations:check` | Aprobado: 234 archivos SQL, colisiones históricas congeladas |
| `npx openspec validate coordinate-material-generation --strict --no-interactive` | Aprobado |
| `git diff --check` | Aprobado; avisos de normalización LF/CRLF |
| `npm run docs:check` | Bloqueado por cuatro enlaces locales anteriores en reportes/2026-11-14-factibilidad-herk-edit-kit.md |

Total de suites dirigidas sin contar repeticiones: 180 pruebas aprobadas. No se ejecutó `verify:release`, despliegue, SQL remoto ni generación real. No se afirma que la compuerta global esté verde.

## Revisión de regresiones y riesgos

- Autorización del artefacto/organización antes de RPC privilegiadas y worker interno firmado conservados. RPC nuevas niegan ejecución a anon/authenticated.
- Locks padre→lección y workspace→run; reserva con versión/iteración y límites de capacidad. Pruebas de duplicados, versión distinta, tenant/unidad ajenos y fin de tanda.
- Cancelar o sustituir la reserva impide continuar guardando. La finalización de un fallo fatal no vuelve a despachar solicitudes pendientes.
- Guardar progreso no sobrescribe la cola concurrente de Hub. El cierre con reintentos pendientes conserva trabajo en QUEUED.
- Fallo dirigido de Academy no marca al padre indiscriminadamente y despierta la cola. Se verifica el callback local además del worker.
- El fallo de inicio de Hub no cancela Academy; cambiar de panel no desmonta el otro motor. Se puede reintentar una lección mientras otra sigue activa.
- Se mantiene el rechazo de contenido sin recibo vigente; el mensaje no copia prompts ni textos privados.
- La revisión detectó y corrigió el marcado prematuro de ready y la clasificación engañosa de fallos técnicos del auditor como timeout.

## Evidencia y pendientes

Logs locales en `apps/web/.tmp/coordinated-*.log`; capturas en `.tmp/hybrid-materials-qa/`. Son artefactos locales de QA, no entregables de contenido ni evidencia de gasto real.

El lint global requiere conciliar reducciones anteriores en las dos páginas de creación y useCourseDelivery. No se modificó ese baseline ni el reporte Herk ajeno al alcance.

Antes del piloto: aplicar `supabase/migrations/20261121010000_coordinated_material_retries.sql` en Architect y reiniciar los procesos locales que tengan cargado el worker anterior. Coordinar el cambio sin workers de versiones mezcladas. Los detalles de alcance, errores y operación están en [analysis.md](analysis.md).

## Corrección posterior: motivo específico de rechazo

Se conserva el código del auditor desde `validateSourceGrounding` hasta los adaptadores asíncrono, síncrono y el resumen del run. Se añade el evento `revision_contenido_rechazada` antes de propagar la excepción. Un catálogo común solo permite los cuatro códigos conocidos con texto fijo; un código desconocido no se copia al mensaje público.

Verificación de esta corrección: 61 pruebas de sesiones, 79 de fuentes, 31 de generación asíncrona y 5 de recuperación aprobadas (176 sin repeticiones), con compilación TypeScript de sus suites. Incluye los cuatro rechazos a través del auditor real con proveedor simulado, ausencia de recibos rechazados y conservación de los códigos sin texto privado en los adaptadores. ESLint y `git diff --check` dirigidos aprobados. No cambia SQL ni inicia generación real. Los mensajes históricos permanecen iguales hasta un nuevo intento.
