# Verificación local

## Doble confirmación con fuentes

- La suite SQL en PGlite pasó 28 casos. El caso añadido verifica manifiesto
  obsoleto, acceso ajeno, bloqueo de roles de navegador, reversión de datos y
  cola ante una FK protegida y eliminación de un curso con fuente reservada,
  documento histórico, importación y recibo de Base. Usa fixtures históricos y
  migraciones documentales reales.
- La suite dirigida de autoridad pasó 10 casos. Verifica rechazo de solicitudes
  sin confirmación, rol insuficiente, resolución de organización en servidor,
  respuesta segura y metadatos sin rutas privadas.
- La suite web de fuentes pasó 63 casos, incluida la limpieza que conserva
  la cola si Storage falla y solo acusa las rutas reclamadas.
- Chrome a 390 × 420 verificó el flujo con componentes y CSS reales y APIs
  simuladas: dos pasos, foco en la revisión, lista, acciones de descarga,
  rechazo de lista obsoleta y retiro de la tarjeta tras confirmar el éxito.
- `npm run typecheck`, ESLint dirigido, `npm run test:security-boundaries`,
  `npm run db:migrations:check`, `npm run docs:check`,
  `npm run openspec:validate` y `git diff --check` terminaron con salida 0.
- Pendiente en un entorno autorizado: validar descargas y eliminación física
  desde un curso prescindible con Supabase Storage real, así como el ejecutor
  programado y los tiempos de elegibilidad. No se aplicaron migraciones remotas.

## Borrado anterior

El esquema real de fuentes, ejecutado en PGlite, reprodujo el fallo
`23503` de `course_source_settings_artifact_id_fkey` al intentar borrar
un borrador documental recién creado. La acción previa enviaba los borrados
del pipeline en solicitudes independientes. La RPC nueva confirma el borrado
del padre en la misma transacción y conserva los registros ante una FK
imprevista. Las reservas de carga y originales registrados se protegen antes
de eliminar relaciones. La prueba incluye un original histórico simulado.

| Verificación | Resultado |
| --- | --- |
| `node --test scripts/test-course-source-migration.mjs` | 27/27. Se repitieron los dos casos de eliminación tras conservar el recibo de idempotencia. Pasaron con borrado histórico, protección de fuentes, aislamiento tenant, permisos y reversión por FK. |
| `npm run test:security-boundaries` | Salida 0 |
| Pruebas dirigidas de autoridad de artefactos | 9/9 |
| `npm run typecheck`, ESLint dirigido, `git diff --check` | Salida 0 |
| `npm run db:migrations:check`, `npm run docs:check`, `npm run openspec:validate` | Salida 0 |
| QA en Chrome, fixture local con acción simulada | Menú visible a 390 × 420, Escape devuelve el foco, el diálogo requiere confirmación, muestra el bloqueo y retira la tarjeta tras éxito. |
| `npm run test:auth-bridge --workspace=apps/web` | Los casos de artefactos pasaron. La suite completa falla en dos casos de publicación porque el loader no resuelve el alias de `course-source-publication`. |
| `npm run verify:pr` | Salida 0 fuera del sandbox. El primer intento se detuvo porque el sandbox bloqueó la creación de repositorios Git temporales para el arnés. |

PGlite usa tablas históricas sintéticas junto a las migraciones documentales
reales. Chrome usa los componentes de la aplicación con CSS real y una
respuesta simulada. Queda por comprobar el esquema completo y el recorrido
autenticado en un entorno de prueba con un borrador prescindible. La migración
debe aplicarse antes del despliegue que consume la RPC.
