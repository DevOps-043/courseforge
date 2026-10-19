# Verificación — 2026-10-19

Base staging 2660223e, rama codex/heygen-external-import-v3. Sin credenciales,
consultas reales a HeyGen, SQL remoto, generación facturable ni despliegue.

## Resultados

- `npx tsc -p tsconfig.remotion-test.json` en apps/web: aprobado.
- `node --test` de heygen-external-import-source, heygen-client y
  heygen-credential-resolver compilados: 28 pruebas, 3 suites, cero fallos.
- `npm run test:security-boundaries`: aprobado, incluida la nueva comprobación
  de delegación v3/tenant y las políticas de importación externa existentes.
- `npm run db:migrations:check`: aprobado, 210 archivos SQL; no hay migraciones nuevas.
- `npm run docs:check`: aprobado.
- `git diff --check`: aprobado.
- `npm run verify:pr`: adapters:check, harness:validate y docs:check aprobados;
  se detiene en openspec:validate porque el ejecutable openspec no está disponible.
- `npm run openspec:validate`: no ejecuta validación por falta del CLI. No se
  instala una dependencia ni se debilita el gate para ocultar esta limitación.
- `npm run typecheck`: aprobado.
- ESLint de la ruta, módulo de resolución y pruebas afectadas: aprobado.

## Revisión adversarial del mismo autor

- Autenticación y autorización de componente preceden a la consulta de cuenta.
- La organización proviene del contexto servidor; el payload no concede autoridad.
- No se leen secretos en herramientas; el código usa el resolver existente en runtime.
- El callback que resuelve credenciales no se ejecuta para URLs directas.
- Los errores HTTP del proveedor no muestran body ni se convierten en pendientes.
- El cliente v3 mantiene límites JSON y timeout; la descarga conserva sus defensas.
- La prueba de inventario ya no exige parsing JSON duplicado en el handler;
  exige delegación al cliente y conserva la prueba del parser acotado central.
- La nueva suite está incluida en test:remotion; no queda aislada de los scripts.
- Búsqueda de URLs api.heygen.com/v1 o v2 en código apps/supabase/scripts: sin coincidencias.

## Límites y operación

No es una revisión independiente ni certifica producción. No se ejecutó build,
QA visual ni importación real. Antes de desplegar, confirmar credencial HeyGen
por empresa para consumidores por ID que antes dependían de la clave global.
Validar un ID completado, otro pendiente y URL directa en staging.
El cambio no se archiva hasta integrarse a la rama objetivo.
