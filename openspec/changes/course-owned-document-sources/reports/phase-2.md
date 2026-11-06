# Fase 2 — extracción y biblioteca (2026-11-06)

Implementación local: biblioteca en Base/Temario/Fuentes y preparación de borrador sin IA en creación de cursos. Carga directa privada con confirmación, extracción mediante función background firmada, recuperación explícita, vista de texto y descarga autorizada de original. Retirada lógica conserva el original y evita futuras reservas de procesamiento.

La migración `20261106010000_course_source_extraction.sql` añade reserva de diez minutos y máximo tres intentos. La RPC bloquea por documento, rechaza tokens vencidos/ajenos y persiste fragmentos y READY en una transacción. Un worker anterior no completa después de retirada. El extractor existente admite PDF textual, DOCX, PPTX y TXT con hasta 40,000 caracteres; no hay OCR. Fragmentos de 2,000 caracteres conservan posiciones en el texto normalizado, no páginas inventadas. No hay llamadas IA.

La UI conserva progreso de procesamiento en DB y consulta cada cinco segundos; la transferencia indica etapa, sin porcentaje de bytes. PDF corrupto/escaneado queda FAILED con diagnóstico genérico visible y original conservado. Una interrupción de dispatch conserva UPLOADED para reintento explícito. El guard firmado existente valida la llamada y la RPC contrasta organización del artefacto antes de adquirir la reserva.

## Límites pendientes de F2

- Sustitución documental con vínculo explícito a versión anterior y conciliación/purga segura de reservas huérfanas no implementadas. Se permite subir un documento distinto y retirar el anterior; no se presenta como reemplazo versionado terminado.
- Sin QA visual ejecutada en navegador ni prueba con Supabase Storage desplegado.
- La UI no vincula todavía los documentos a generación; política/cobertura y adaptadores son F3/F4.
- No se aplicaron migraciones remotas ni se desplegó.

## Evidencia

`npm run test:course-sources`: 19 pruebas de dominio y 10 SQL, código 0 también en ejecución final, incluida retirada al caso SQL; evidencia en `phase-2-tests.log`. Incluye conservación del texto posterior a 12,000 caracteres, leases, persistencia atómica, aislamiento y regresiones F1. Documentación/OpenSpec y ESLint de componentes finales aprobaron. La primera compilación detectó una ruta relativa incorrecta del fallback local y la primera compuerta un warning nuevo de efecto React; ambos corregidos sin modificar baseline. La compuerta completa se ejecuta de nuevo; registrar resultado final al cerrar. El último ajuste de UI conserva la clave idempotente por archivo durante la sesión y se comprobó con ESLint sin warnings.

Resultado final `npm run verify:pr`: código 0, compuerta completada; evidencia `phase-2-gate.log`. Incluye lint sin diferencias del baseline, tipos, grafo, migraciones y suites de producto. Ejecución con TEMP/TMP en el temporal del workspace ya utilizado en F1. La auditoría documental extendida se solicitó por separado; no sustituye estos resultados ni acredita despliegue.
