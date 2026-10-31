# Consolidación y limpieza — 2026-10-31

## Alcance autorizado

Publicar las mejoras recuperadas en `codex/fix-clip-range-export`. El usuario
integrará después en `staging`. Posteriormente solicitó eliminar todos los
worktrees de este repositorio. No se crearon ramas ni worktrees, no se integró
en `staging`, no se desplegó ni se aplicó SQL remoto.

## Implementaciones conservadas

Base común: `13774405f90d5d3dd1d87989673c6b4976269f54`.

| Funcionalidad | Origen | Commit en la rama de entrega |
| --- | --- | --- |
| Intervalos y descarga individual MP4/WAV | Cambios locales contrastados con snapshots | `5f435d3c` |
| Capas y animaciones de intros/outros; conservación al reaplicar | `968fe2fe` | `c4a66063` |
| Bucle de videos extendidos durante buffering | `e7b5213a` | `3a664464` |
| Agrupaciones anidadas | `064ecb32` | `21bd6a89` |

Se guardó el trabajo local antes de integrar. Los conflictos documentales
conservan los contratos de ambas funcionalidades. El manifiesto web mantiene
los scripts de exportación y de grupos. La especificación final de grupos
sustituye su diseño inicial, también preservado en el historial. Se contrastó
el preview integrado con el commit de agrupaciones para verificar que conserva
los controles y operaciones adicionales de exportación.

## Limpieza de worktrees

Los worktrees secundarios no tenían cambios pendientes cuando se inspeccionaron.
Durante la limpieza se detectaron registros cuyo archivo `.git` ya no existía,
causa del error `validation failed, cannot remove working tree`. Se retiraron
esos registros y se respaldó el código residual antes de borrar sus carpetas.

Los junctions se enumeraron sin recorrer sus destinos y se retiraron antes del
borrado recursivo. Las rutas absolutas se validaron contra padres explícitos;
el checkout principal quedó excluido. Se eliminaron los restos de branding,
agrupaciones, bucle, flujo sincrónico, routing de despliegue y captions presentes
en las carpetas de worktrees de este repositorio. Los respaldos locales están
en `.tmp/recovery-20261031-deleted-files/worktree-cleanup/`; no se copiaron
secretos, archivos de entorno, HAR, logs ni dependencias a esos ZIP.

Verificación: `git worktree list --porcelain` devuelve únicamente el checkout
principal; `.git/worktrees` y `.tmp/worktrees` ya no existen. Se retiró
`extensions.worktreeconfig`. Las ramas y sus commits no se eliminaron.

AGENTS.md, el estándar base y la skill canónica de aislamiento ahora establecen
que no deben crearse ni reabrirse worktrees sin solicitud explícita del usuario.

## Verificaciones ejecutadas

| Verificación | Resultado |
| --- | --- |
| Compilación de la suite HyperFrames antes de retirar carpetas residuales | Aprobada, salida 0 |
| 15 archivos de pruebas dirigidas: exportación, grupos, branding, patches, timeline, persistencia, transporte y standalone | 193 pruebas aprobadas, 0 fallos |
| SQL de agrupaciones con PGlite 0.3.14, sin BD remota | 6 pruebas aprobadas |
| Arnés | 20 pruebas aprobadas |
| ESLint de los archivos de código de la entrega | Salida 0 |
| Chrome: exportación individual | MP4/WAV reales, recorte central desde React, descarga, cancelación y rechazo de codificador aprobados |
| Chrome: agrupaciones | Selección aditiva, capacidad, dos niveles, navegación, Escape y desagrupación aprobados |
| Chrome: intros/outros | Accesos, selección, cursor, capas, animación, reaplicación y retiro aprobados |
| Versiones de migraciones | 213 SQL verificados, sin nuevas colisiones |
| Adaptadores y arnés estructural, repetidos tras cambiar instrucciones | 27 adaptadores y validación aprobados |
| Enlaces documentales durante verify:pr | 170 documentos verificados |
| verify:pr | Se detiene en `diagnose-font-catalog`; 23 ítems OpenSpec aprobados y 1 fallido |

El cambio `diagnose-font-catalog` ya está en la base y no fue modificado por esta
entrega. No se afirma que la compuerta general esté en verde.

## Incidencias del entorno y límites

La reinstalación con `npm ci --ignore-scripts --no-audit --no-fund` terminó con
salida 0: 2265 paquetes en 17 minutos. Dos compilaciones iniciadas antes de
finalizar la instalación fueron detenidas expresamente y no cuentan como pruebas
aprobadas. Los ejecutables de npm se regeneraron con
`npm rebuild --ignore-scripts --bin-links=true`, salida 0.

Las comprobaciones posteriores a la limpieza encontraron paquetes de los scopes
`@google` y `@remotion` ausentes. En esos intentos, tipos web, Remotion y la suite
HyperFrames completa no pasaron por módulos faltantes; el smoke de bucle tampoco
pudo arrancar sin `@remotion/renderer`. Son resultados de esos intentos, no
pruebas funcionales aprobadas ni evidencia suficiente para atribuir todos los
errores derivados al código. Se inició una reparación incremental desde el
lockfile y caché, sin una segunda reinstalación completa.

Para los tres smokes aprobados se usó Chrome instalado y un esbuild temporal
0.28.1. Playwright 1.56.1 y PGlite quedaron únicamente en carpetas temporales;
no son dependencias nuevas de producción. No se repitieron QA de Storage
autenticado, otros navegadores, carga multiusuario, render cloud ni build de CI.

## Revisión adversarial y habilitación

Revisión del mismo agente, sin atribuir independencia. Se preservaron límites,
cancelación, selección posterior al corte, autoguardado antes de exportar y
controles tenant/rol/hash. La negociación de grupos no concede autoridad.

La descarga individual solo aplica recortes temporales: no incluye motion,
color, volumen ni mezcla. Sigue rechazando bucles, cambios de velocidad y
congelación; máximo diez minutos y 256 MiB. La corrección de bucle del preview
no amplía este contrato de exportación.

Las agrupaciones requieren validar y aplicar, bajo autorización, las migraciones
`20261029230000_nested_composition_groups.sql` y
`20261029230100_nested_narrative_fragment_groups.sql`, en ese orden; después
habilitar `COMPOSITION_NESTED_GROUPS_ENABLED=true` y confirmar el RPC de capacidad.
No retirar lectores compatibles tras guardar el primer documento jerárquico.
OpenSpec permanece abierto hasta la integración en la rama objetivo.
