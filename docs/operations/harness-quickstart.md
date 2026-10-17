# Operar el arnés de Coursegen

Estado: vigente. Actualizado: 2026-10-15.

Abrir el checkout que contiene la rama de trabajo y leer AGENTS.md.
Codex, Claude y Antigravity apuntan a las mismas fuentes canónicas.
Los wrappers se generan desde ai-specs/skills: no editarlos directamente.

## Primera comprobación

```powershell
npm ci
npm run adapters:check
npm run verify:harness
```

Los scripts usan Node y Git; OpenSpec está fijado en el lockfile y no requiere
instalación global. El CI usa Node 22. No copiar .env ni configuraciones privadas
a worktrees de otro trabajo. Las pruebas del arnés no requieren credenciales.

## Ciclo

1. Enriquecer solicitud, contratos y riesgos con enrich-requirement.
2. Crear o actualizar openspec/changes/<nombre>: contexto, propuesta, diseño,
   escenarios y tareas. Mantener el alcance autorizado.
3. Aislar cambios materiales con using-git-worktrees.
4. Implementar una tarea a la vez con las skills del dominio.
5. Ejecutar pruebas dirigidas y npm run verify:pr; registrar códigos y límites.
6. Revisar de forma adversarial, entregar diff y evidencia.
7. Integrar, sincronizar especificaciones y archivar después de la integración.

Antigravity incluye workflows /openspec-propose, /openspec-apply,
/openspec-verify y /openspec-archive. Otros clientes siguen el mismo ciclo leyendo
los archivos del cambio. No hay despacho automático desde el registro de roles.

## Cambiar una skill

Editar ai-specs/skills/<nombre>/SKILL.md; mantener name/description y nombre del
directorio alineados. Ejecutar npm run adapters:sync y npm run adapters:check.
Un wrapper huérfano hace fallar la sincronización: revisar su contenido y retirar
solo el wrapper que corresponda, sin borrar trabajo ajeno automáticamente.

## Elegir verificación

verify:harness solo cubre infraestructura de agentes. verify:pr ejecuta además
la secuencia de producto existente; consultar [testing.md](../standards/testing.md)
para suites de dominio y QA multimedia. Las compilaciones de pruebas escriben
en .tmp. No afirmar que un build, render o servicio remoto pasó si no se ejecutó.

Si falla un gate, registrar comando, resultado y alcance; investigar la causa y
no ocultarla ampliando excepciones. docs:audit produce evidencia temporal para
el [protocolo documental](../PROTOCOLO_DE_INVESTIGACION_Y_SINCRONIZACION.md).

En CI, HARNESS_BASE_REF fija la base del PR/push y se descarga el historial completo.
En local se compara con HEAD; para incluir commits de la rama, fijar esa variable
a su base antes de verificar. Una referencia inexistente provoca fallo explícito.
