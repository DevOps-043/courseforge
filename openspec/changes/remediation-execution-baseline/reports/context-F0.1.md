# Continuidad F0.1 — 2026-11-04

## Objetivo y base

Responsable de ejecución local: Codex. Unidad F0.1; no cierra TD-08/12/31.
Fecha y zona: 2026-11-04, America/Mexico_City.
Rama staging; HEAD base 37dcf7dcfb89d6289369b4c962423a02097b5293.
Node v24.19.0, npm 11.19.0; CI usa Node 22. Dependencias ya instaladas.
SHA256 de package-lock.json:
481690538CD0DF697BAC88EA65CF9339814FC771E823BFF38725B27662340538.

Cambios heredados, confirmados con la conversación «Audita deuda técnica de
SofLIA» (01a1a880-71b0-7440-b28a-79a15611b00b): README.md,
TECHNICAL_DEBT_AUDIT.md, docs/README.md, docs/TECHNICAL_DEBT_ANALYSIS.md,
docs/architecture/system-context.md, docs/technical-debt/ y
openspec/changes/audit-technical-debt-2026-11/. Se preservan sin incluirlos en
un commit de esta unidad. El listado capturado git-status-initial.log incluye
además el nuevo OpenSpec de esta unidad, creado antes de capturarlo.

## Alcance y decisiones

Solo este OpenSpec añade propuesta, diseño, contrato, tareas y evidencia. Sin
cambios en producto, roles, APIs, esquema, dependencias ni reglas de lint.
No se ejecuta npm ci sobre este checkout con trabajo pendiente. Instalación
limpia y equivalencia Node 22 quedan para F0.2 en entorno descartable.
La autorización actual permite iniciar unidades; la restricción histórica de
«solo planificar» describe la auditoría previa, no esta solicitud.

## Mapa de comandos

| Comando | Propósito / límite |
|---|---|
| npm run verify:pr | adapters → harness → docs → OpenSpec → test:harness → verify; corta al primer error |
| npm run verify | lint → tipos → ciclos → migraciones → branding → seguridad → audio → coverage-gaps → course-delivery |
| npm run typecheck | Tipos web; no sustituye build ni tipos API |
| npm run architecture:cycles | Madge ts/tsx con tsconfig web; no distingue por sí solo ciclos de tipos/runtime |
| npm ls eslint eslint-config-next eslint-plugin-react-hooks --all | Árbol instalado; no acredita instalación limpia |
| npm run test:auth-bridge --workspace=apps/web | Próxima frontera de identidad, no ejecutada en F0.1 |
| npm run test:security-boundaries | Próxima frontera de seguridad, no ejecutada en F0.1 |

El workflow quality.yml agrega Node 22/npm ci, compliance, QA Chromium, SQL
aislado, build y audit. gate-plan.mjs no ejecuta esas comprobaciones adicionales.
El inventario flujo→suite→CI corresponde a F3.4; no queda certificado aquí.

## Resultados confirmados

- Estado final: F0.1 cerrado por caracterización local; hallazgos sin cierre.
- verify-pr-retry.log: código 2 con subprocesos habilitados; adapters, harness,
  docs, OpenSpec y test:harness aprueban. verify se detiene en lint.
- lint.log: código 2; configuración efectiva no encuentra plugin react-hooks
  para react-hooks/immutability. Reproduce TD-08; no es fallo nuevo.
- git diff --check: código 0. HEAD y hash del lockfile permanecen iguales.
- Verificación documental final: docs-final.log código 1 por Git EPERM;
  docs-final-retry.log código 0 con subprocesos habilitados. OpenSpec final:
  openspec-final.log código 0 (39/39). No se confunde bloqueo con enlace roto.
- typecheck.log: código 0.
- architecture-cycles.log: código 1; 2.262 archivos, 11 ciclos, 577 warnings.
  Coincide con la base histórica; clasificación detallada pendiente de F0.3.
- verify-pr.log: código 1, adapters aprueba (27); harness falla spawnSync git
  EPERM. Bloqueo de sandbox, no evidencia de regresión del producto.
- lint-dependencies.log: npm ls código 0; ESLint 9.39.5 y plugin hooks 7.1.1
  presentes. Presencia instalada no implica resolución correcta de configuración.
- Primer intento de captura no ejecutó npm porque faltaba reports/; corregida
  la carpeta, se ejecutaron comandos. El código 0 del wrapper inicial no cuenta.

## Riesgos, revisión y reversión

Revisión propia: no se rebajan reglas, no se atribuye éxito a pasos omitidos y
no se cierra deuda por caracterización. No hay revisión independiente.
Sin npm ci, servicios, SQL, build, QA visual o cargas. No se leyeron secretos.
Reversión: retirar solo openspec/changes/remediation-execution-baseline/;
preservar todos los cambios heredados. Sin efectos remotos que revertir.

## Siguiente unidad

F1.1: leer hallazgo TD-26 en docs/technical-debt/findings.md, paquete S del plan,
reports/reproduce.mjs de la auditoría y tenant-context/artifact-action-auth,
session/platform-role, login/switch-organization y tests Auth Bridge.
Crear OpenSpec de autoridad antes de modificar contratos. Confirmar fuente de
membresías/roles, revocación y sesiones legacy con pruebas negativas. F0.2 y F0.3
permanecen independientes pendientes. Ningún hallazgo de producto queda cerrado.

## Historial

| Fecha | Transición | Evidencia | Siguiente acción |
|---|---|---|---|
| 2026-11-04 | planificado → en curso | HEAD/runtime/estado y logs separados | Completar gate y registro final |
| 2026-11-04 | en curso → cerrado | Gate repetido: 2 por lint; tipos 0; grafo 1 | F1.1 habilitada; sin cierres de hallazgos |
