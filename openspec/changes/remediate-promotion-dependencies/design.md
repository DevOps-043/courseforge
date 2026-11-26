# Diseño

Actualizar dentro de las versiones mayores actuales salvo la API, que migra
explícitamente Zod 3 a 4. Conservar esquemas y rechazos; adaptar solo las APIs
incompatibles que demuestren las comprobaciones. Unificar la versión de Remotion
usada por scaffolds y manifiestos, manteniendo todos sus paquetes alineados.
Netlify CLI pasa de la rama 23 a 27.20.1; su requisito Node >=22.13.0 es
compatible con Node 22.23.5 observado en CI. Comprobar versión y ayuda de los
comandos de desarrollo, sin iniciar sesión ni ejecutar despliegues como prueba.

Su árbol mantiene NFT 1.3.1 y minimatch 10. Los overrides se limitan a
descendientes de Netlify CLI: NFT 1.11.15 y minimatch 11.0.9 para consumidores de
la rama 10. El changelog de minimatch 11 retira APIs internas; se revisan los
consumidores de Netlify y se prueban `Minimatch`, `globParts`, archivos ocultos,
negación, trazado y ZIP de una función con dependencia local. No se sustituyen
las ramas antiguas de minimatch usadas por otros consumidores del monorepo.
[Cambios del proveedor](https://github.com/isaacs/minimatch/blob/main/changelog.md).

No usar `npm audit fix --force`, excepciones de auditoría ni flags que ignoren
peer dependencies. Revisar cada cambio de lockfile y cualquier dependencia
fijada que impida corregir transitivas. Repetir pruebas de audio, integridad,
Remotion y la compuerta del PR, más el build y audit remoto.

Recuperación: revertir juntos código, manifiestos y lockfile y reinstalar desde
el lockfile anterior. No hay cambios de base de datos. Ese rollback recupera
también las versiones vulnerables y solo constituye una mitigación temporal.
