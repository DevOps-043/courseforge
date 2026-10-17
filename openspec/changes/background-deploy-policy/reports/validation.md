# Evidencia de la política de despliegue

Fecha: 2026-10-17. Base: `64606f73` (main). Rama: `codex/background-deploy-policy`.
Worktree: `D:/Pulse Hub/courseforge/.tmp/background-deploy-policy`.

## Diagnóstico

La captura aportada muestra un POST al worker del sitio principal en el horario
de la generación iniciada desde staging. Ambos resolvers internos priorizaban URL.
La referencia local de main anterior a la integración conservaba el contrato de 120;
la versión remota exacta que ejecutó ese job no se verificó directamente.

## Implementación y revisión

- Captura únicamente un origen público en el build; el JSON versionado conserva null.
- API y bootstrap comparten el mismo resolver. No cambian la URL pública general,
  firmas, expiración, protección contra repetición ni controles tenant.
- Sin metadatos ni DEPLOY_URL explícito, se rechaza el despacho desplegado antes
  del fetch. La configuración inválida no recurre a otro entorno.
- No se usa el Host del request ni se serializa el entorno completo.
- El agente implementador hizo la revisión adversarial; no fue una revisión independiente.

## Verificaciones ejecutadas

- Captura de build: 4/4 pruebas; incluye ejecutar el CLI desde otro cwd y verificar
  su manifiesto sin credenciales, origen inválido y limpieza de metadatos en local.
- Entorno y resolución de workers: 10/10 pruebas, compiladas con la configuración
  de security-boundaries. Staging, preview, producción, precedencia del build,
  runtime sin DEPLOY_URL, desarrollo y rechazo explícito.
- `npm run test:security-boundaries --workspace=apps/web`: exit 0.
- `npm run test:materials-generation --workspace=apps/web`: 29 + 5 pruebas pasadas
  tras actualizar la expectativa de encadenamiento a DEPLOY_URL en lugar de URL.
  La ejecución final también pasa la comprobación de no enviar sin destino.
- `npm run test:harness`: 20/20 pasadas. La primera ejecución no pudo crear los
  repositorios temporales por permisos del sandbox; se repitió con elevación.
- ESLint sobre los cuatro módulos TypeScript del resolver y sus adaptadores: exit 0.
- `git diff --check`: exit 0.
- `adapters:check`, `harness:validate`, `docs:check`: exit 0.
- `npm run verify:pr`: detenido en openspec:validate por ejecutable openspec ausente.
- `npm run typecheck`: exit 2; 11 diagnósticos TS7016 por @types/react-dom ausente
  en node_modules compartido. Ya está declarado en apps/web/package.json. No se
  añadieron declaraciones ficticias ni se modificaron las dependencias para ocultarlo.
- `npm run verify`: interrumpido durante ESLint global; no se acredita como pasado.

## Límites y validación posterior

No se ejecutaron build completo, generación pagada, despliegue ni publicación.
El worktree utiliza node_modules del checkout padre por resolución de Node;
no se copiaron .env, credenciales ni configuración personal. La instalación no
está completa (openspec y tipos de react-dom ausentes).

Antes de integrar/desplegar: completar instalación desde lockfile y ejecutar
verify:pr y build. En Netlify confirmar que se conserva el comando de netlify.toml
con la captura antes de compilar. Comprobar en los logs que el destino usa el
dominio inmutable del mismo deploy. La protección de acceso de Netlify también
debe permitir la invocación firmada; no se añade bypass automático de protección.

## Observación separada: QA WARN

El badge QA WARN · 9 concatena qa_report.status y findings.length. No expresa una
cantidad de imágenes faltantes. El validador actual emite warnings por densidad,
diversidad/repetición de layouts y gráficas sin referencias. Los incumplimientos de
imágenes listas son errores. No se recibieron los nueve findings del caso real y
no se modificó el planificador de imágenes ni se eliminaron controles de QA.
