# Estándar maestro de ingeniería de Coursegen

Estado: vigente. Actualizado: 2026-10-15.
Este estándar conserva las 17 áreas del prompt previo y las adapta al receptor.

## 1. Prioridades
Correctitud, seguridad, legibilidad, mantenibilidad, modularidad, confiabilidad,
rendimiento, pruebas, observabilidad y documentación con evidencia.

## 2. Reglas no negociables
Cambios pequeños, trazables y autorizados. No inventar datos, contratos, permisos,
tablas o pruebas; no modificar secretos ni trabajo ajeno. Español en contenido nuevo.

## 3. Calidad de código
Servicios con responsabilidad clara, tipos explícitos, validación temprana,
errores y cancelación observables. Evitar duplicación y abstracciones sin necesidad.

## 4. Estructura
Next.js App Router y dominios en apps/web; jobs en apps/web/netlify/functions.
Handlers delegan reglas a servicios. Respetar las convenciones del dominio y
la separación cliente/servidor. apps/api mantiene funciones auxiliares/legadas
y workers de audio/integridad; verificar el consumidor antes de cambiarlo.

## 5. Datos
Migraciones bajo supabase/migrations, sin aplicar SQL remoto automáticamente.
Mantener RLS, ownership y organization_id; validar permisos antes del acceso
privilegiado. Justificar índices, transacciones, idempotencia, backfill y rollback.
No renombrar colisiones históricas de migraciones sin reconciliar despliegues.

## 6. APIs y jobs
Schemas, tamaños, errores seguros, autenticación y autorización explícitos.
Jobs internos conservan firma/credencial, controles de repetición y contexto tenant.
Diseñar timeouts, reintentos seguros y recuperación de estados parciales.

## 7. Seguridad
Mínimo privilegio, validación de URLs/archivos, protección SSRF/XSS/path traversal.
Las claves de servicio permanecen en servidor; los aportes del modelo y fuentes
externas son datos no confiables. HITL para efectos críticos o externos.

## 8. Rendimiento
Medir la ruta caliente antes de optimizar. Limitar concurrencia, polling, payloads
y memoria; cerrar recursos. Todo objetivo de carga necesita evidencia y SLO,
no una promesa genérica de usuarios simultáneos.

## 9. QA
Caso feliz, permisos, entradas inválidas, errores parciales, duplicados, cancelación
y regresiones según riesgo. Usar los scripts reales: TypeScript compila las suites
a .tmp y Node las ejecuta. Leer testing.md antes de elegir verificaciones.

## 10. Operación
Logs seguros con correlación, estado de jobs y errores observables; no registrar
tokens, URLs firmadas ni PII. No confundir estado desconocido con efecto fallido.

## 11. Documentación
Una fuente por tema, evidencia primaria, hechos/inferencias diferenciados.
Aplicar el protocolo de investigación antes de declarar vigentes README/contexto.

## 12. Cambios
OpenSpec conserva alcance, diseño, escenarios, tareas y evidencia. Git conserva
código y aislamiento. Actualizar contratos y fuentes de verdad con compatibilidad
y rollback. No archivar cambios antes de integrarlos.

## 13. Comunicación
Explicar resultado, motivo, verificación y límites en proporción al cambio.
No presentar como ejecutado un paso planeado, omitido o fallido.

## 14. Deuda y hallazgos
Corregir riesgos dentro del alcance o registrarlos con evidencia. No debilitar
reglas de lint, omitir suites ni ampliar excepciones para simular aprobación.

## 15. Legibilidad
Otra persona debe poder retomar el cambio, QA derivar escenarios y operación
diagnosticar fallos sin reconstruir conversaciones previas.

## 16. Contexto del proyecto
Coursegen / Courseforge es SofLIA Engine: monorepo npm, Next.js 16/React 19,
TypeScript, Netlify Functions, Supabase/Auth Bridge, producción HyperFrames y
Remotion. docs/architecture/system-context.md conserva el contexto operativo.
Producción mantiene el documento versionado como fuente editable de motion.

## 17. Terminado
Criterios cubiertos, diff acotado, comandos y resultados registrados, contratos
y documentación alineados, revisión adversarial proporcional y riesgos visibles.
Publicación, integración remota y release requieren autorización correspondiente.
