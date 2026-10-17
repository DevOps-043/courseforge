# Procedencia del arnés

Estado: vigente. Actualizado: 2026-10-15.

La adaptación directa proviene del arnés de desarrollo de SofLIA Hub, documentado
en docs/architecture/development-harness.md y su guía de portabilidad en ese
repositorio. La revisión del receptor se hizo desde Courseforge 7e16e8c3.

El registro histórico de Hub identifica
[LIDR Academy / lidr-specboot](https://github.com/LIDR-academy/lidr-specboot),
commit d19d286e9895bdf9be54b3e97070b9fe081c93af observado el 2026-07-21, junto
con un PDF «Resumen - Arnes.pdf». Esa procedencia histórica se conserva como
atribución; no se volvió a inspeccionar el PDF ni a comparar el árbol de ese commit.

Se adoptan fuente canónica, skills, enriquecimiento, especificaciones, tareas,
aislamiento y revisión con evidencia. Se adaptan al receptor dominios web/jobs,
tenancy, multimedia y sus scripts existentes. No se importan Electron, IPC,
catálogos runtime o supuestos de bases de datos del Hub.

OpenSpec se incorpora como dependencia de desarrollo fijada a 1.8.0 y con su CLI
local. Las versiones futuras requieren evaluar compatibilidad y actualizar lockfile.
Los adaptadores se generan como archivos ordinarios para evitar depender de symlinks.

Las guías previas quedan en docs/archive/project-guides como material histórico.
[La arquitectura actual](../architecture/development-harness.md) y las pruebas
del cambio son la evidencia de lo implementado aquí.
