# Consumo automático de todas las fuentes válidas

Decisión del usuario, 2026-11-20: Materiales recibe todas las fuentes investigadas
y validadas de su lección, sin selección ni confirmación manual por objetivo.
Los documentos READY del curso forman parte del contexto según la política.

## Contrato y criterios

- DOCUMENTS_ONLY excluye web; DOCUMENTS_AND_WEB incorpora todos los documentos y
  todas las fuentes web válidas de las lecciones que se están generando. WEB_ONLY
  conserva el consumidor histórico. No mezclar fuentes de otras organizaciones.
- La base de datos construye el conjunto completo y un snapshot inmutable; el
  cliente no elige IDs ni puede omitir fuentes. No marcar una revisión humana
  como aprobada para simular automatización.
- Conservar validación de contenido, citas literales, identidad curricular, límites
  de contexto, vigencia y recibos. Si el conjunto excede el presupuesto, fallar con
  explicación; no reducirlo silenciosamente a una sola fuente.
- Sustituir la selección manual obligatoria por inventario y continuación al paso
  de Materiales. Los vacíos y errores permanecen visibles.
- Los snapshots manuales históricos conservan su comprobación original. Los nuevos
  snapshots de Materiales identifican explícitamente el consumo ALL_VALIDATED.

## Entrega

Aplicación y migración incremental en la instancia de Architect, bajo supabase/
migrations como el resto de este dominio. No ejecutar SQL remoto en esta tarea.
Probar PostgreSQL aislado, casos de varias fuentes, descarte de fuentes inválidas,
política exclusiva, otra organización, conjunto vacío, vigencia y presupuesto;
verificar UI sin generación pagada. La activación requiere aplicar la migración
antes del código nuevo; mientras falte, el sistema debe fallar de forma cerrada.
