# Primer incremento: contrato y protección del importador

[Guía para continuar en otro chat](continuation.md).

Fecha: 2026-11-26. Ramas locales `codex/hybrid-publication-bridge` en Architect y
Academy. No se publica, aplica SQL ni cambia el estado del taller de prueba.

## Implementación

- Contrato portable de metadatos v2: identidad organizacional, publicación,
  revisión, currículo completo, destinos Academy, sesiones y recorrido ordenado.
- Verifica IDs únicos, referencias internas, cobertura completa y repaso explícito.
  No inventa fechas ni requiere videos de las lecciones exclusivas Hub.
- Copia vendorizada sincronizada desde Architect; fixture sintética común.
- Outbox v1 y fronteras de Academy (cron, aprobación, preview y mutaciones)
  rechazan modalidad/versión que no pueden conservar. Un v2 válido nunca llega
  al upsert posicional ni se convierte silenciosamente en v1.

## Evidencia ejecutada

- `npm run test:course-delivery -w apps/web`: 97/97, código 0.
- Academy: ejecución final conjunta de contrato/cron/aprobación/actividades v1,
  4 archivos, 9/9 pruebas, código 0.
  Se usan clientes instrumentados que fallan si se intenta escribir contenido.
- Primera ejecución de Academy: timeout iniciando un worker, no aprobada. Se
  repitieron las pruebas de servidor con entorno node y pasaron; la regresión
  de actividades conserva su entorno jsdom y también pasó.
- Script `sync-hybrid-publication-contract.mjs --check`: paridad verificada.
- OpenSpec del cambio: válido en modo estricto.
- `docs:check` final: 508 documentos; código 0. `git diff --check`: código 0.
- Lint Architect: 0 errores y 0 diferencias con los 558 warnings de baseline.
- Lint dirigido Academy: código 0.
- `npm run verify:pr` de Architect: código 0. Incluye 75 elementos OpenSpec,
  tipos, grafo (2477 módulos, 9803 aristas, cero ciclos), seguridad, audio,
  tooling, migraciones y entrega del curso 97/97.
- Tipos aislados del contrato en Academy con Zod 3: código 0.
- Tipos globales de features Academy: código 2 con 7 errores en componentes UI
  fuera del puente. La base virtual usa los 5 archivos de producción afectados
  desde HEAD, conservando los demás cambios locales, sin escribir/revertir ningún
  archivo. Devuelve los mismos 7 diagnósticos, comparados por archivo/línea/código
  y mensaje. Afectan LiaQuickActionsChips, PageShell, AdminCompaniesStatCard,
  FeatureVisual y Section; no se declara aprobada la comprobación global.

## Revisión adversarial del mismo agente

No es una revisión independiente. Se revisaron las entradas alternativas al
importador y se añadió protección también a preview y mutaciones públicas para
que no dependan únicamente del cron. Los IDs no se generan desde posiciones.
La revisión es un entero seguro en Zod 3 y 4. La validación estructural NO concede
autorización por tenant; ese control corresponde a la siguiente transacción.

La guarda de publicación híbrida permanece. No se habilita un importador
incompleto. El snapshot de preparación y sus archivos, la identidad persistida,
los permisos de revisión por organización y la transacción de aprobación siguen
pendientes en las tareas 2–4. El importador v1 conserva sus limitaciones previas;
este incremento no prueba preservación de progreso ni recepción remota v2.

Se preservaron los cambios previos de fechas/UI en Academy. Recuperación de esta
unidad: revertir conjuntamente las guardas, contrato vendorizado y pruebas; no
hay datos ni migraciones que revertir. Retirar las guardas permitiría de nuevo
descartar metadatos y no constituye una solución para habilitar híbridos.
