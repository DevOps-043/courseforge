# Segundo incremento: contrato completo y recepción privada

Fecha: 2026-11-26. [Guía de continuidad](continuation.md).

## Implementación

- Architect define el paquete v2 con lecciones asíncronas por ID, plantilla por
  sesión, documentos del aula, notas privadas y referencias acotadas de archivos.
  Academy consume el mismo contrato con Zod 3 y Architect usa Zod 4. Se
  sincronizó también el contrato de preparación de Hub con Academy.
- Academy prepara el esquema privado en la migración `20261126120000` y el
  RPC `receive_hybrid_publication` en `20261126121000`. El RPC valida un
  vínculo de organización previamente provisionado, el slug vigente y
  membresía activa de propietario o admin. Conserva una sola revisión
  inmutable y la confirmación previa ante un reintento idéntico.
- Los roles de navegador carecen de acceso a las tablas y al RPC. Al rol de
  servidor se le concede lectura y ejecución del RPC, sin escritura directa.
  Los snapshots y notas residen en tablas privadas.
- Academy incorpora `supabase/scripts/hybrid-publication-preflight.sql`
  para inspeccionar esquemas, índices, referencias y RLS sin leer datos de
  alumnos ni ejecutar mutaciones.

## Verificación local

- Architect pasó `npm run test:course-delivery -w apps/web`, 101 pruebas.
  OpenSpec validó el cambio en modo estricto y `docs:check` comprobó
  510 documentos. Lint registró cero errores y cero cambios en el baseline.
- Academy ejecutó seis archivos de prueba con Vitest en Node, un worker y
  `--pool=threads`. Pasaron 20 pruebas, incluidas las regresiones del importador
  legacy y del contrato del aula. PGlite ejecutó ambas migraciones dos veces
  y comprobó autorización, conflicto de revisión, reversión de reserva, decisión
  terminal y reintento exacto incluso después de un cambio de slug.
- La paridad de fuentes y fixtures de Architect y Academy se verificó con
  `scripts/sync-hybrid-publication-contract.mjs --check`. Hub usó
  `scripts/quality/sync-learning-studio.mjs --check`.
- Academy pasó lint y tipos dirigidos del contrato. El contrato vendorizado de
  Hub pasó tipos aislados y seis pruebas de dominio del aula con una
  configuración temporal de Vitest en Node. La configuración estándar de
  Vitest agotó el arranque del worker en este entorno.
- La revisión adversarial del mismo agente comprobó los permisos explícitos,
  la serialización por artefacto, el límite UTF-8 y el alcance de los archivos.
  Se ajustó el reintento para conservar el recibo cuando cambia el slug.

## Límites del incremento

La guarda de publicación híbrida permanece activa. El RPC no está conectado al
inbox ni a un endpoint HTTP. La aprobación, custodia de binarios, negociación de
capacidad y piloto siguen pendientes. Las referencias de archivo de la fixture
son sintéticas. Las comprobaciones SQL locales usan PGlite y no demuestran
concurrencia real entre conexiones ni preservación de progreso por la futura
aprobación. Se requiere reconciliar el esquema de la instancia SOFIA antes de
aplicar migraciones. No hubo escrituras remotas, despliegues ni publicación.

La revisión detectó que las rutas de catálogo empresarial consultan cursos
mediante service role. La futura aprobación no puede activar un curso v2 hasta
aplicar el ámbito de organización en esos lectores y en las asignaciones. Ver
la [decisión de diseño](../design.md) y la [operación del puente](../../../../docs/architecture/hybrid-publication-bridge.md).
