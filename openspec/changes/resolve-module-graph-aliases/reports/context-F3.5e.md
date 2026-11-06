# Continuidad F3.5.e — 2026-11-05

## Base, alcance y aceptación

Base d1197e2273ed659fa0be5624d6cd26c5d0d54144, staging. Fuentes de producto sin
cambios frente a ese HEAD durante la comparación. F3.5.e queda cerrada localmente;
TD-12 queda **resuelto pendiente de verificación en CI**, no cerrado globalmente.
La meta íntegra mantiene autorización, datos, publicación, transporte, operación,
editor y aceptación de ambiente. El gate verde no sustituye esas unidades.

## Causa y corrección

Madge 8.0.0 recibe un tsconfig como ruta y lo convierte en compilerOptions ya
parseados. filing-cabinet vuelve a convertir ese objeto y pierde pathsBasePath.
El runner ahora parsea con TypeScript 5.9.3 y base absoluta y entrega { options }
a la API instalada, que conserva esas opciones sin reconvertirlas.

Mismas entradas apps/web/src y apps/web/netlify/functions, extensiones ts/tsx,
sin exclusiones ni skipTypeImports. El comando público architecture:cycles
mantiene su posición en verify. test:harness incorpora trece canarios reales.
No cambian producto, tsconfig, dependencias o lockfile.

| Sobre el mismo HEAD y fuentes | Módulos | Aristas | Ciclos | Referencias omitidas por Madge |
|---|---|---|---|---|
| API con configuración anterior | 2.288 | 6.708 | 0 | 582 |
| Runner corregido | 2.288 | 8.923 | 0 | 2, ambas justificadas |

Se recuperan 2.215 aristas. Los 580 avisos restantes se resuelven, incluida la
referencia CSS por alias. Los dos casos visibles se justifican por recursos:

- tailwindcss: exports["."].style del paquete instalado apunta a index.css y el
  recurso existe dentro del paquete. Una ruta que escape del paquete se rechaza.
- server-only: createServerOnlyClientOnlyAliases del Next instalado proporciona
  los alias de servidor y cliente y ambos recursos resuelven y existen.

No es una lista que tolere cualquier import fallido. Referencias desconocidas,
ciclos o recursos que ya no existan hacen fallar el resultado. La clasificación
de server-only no prueba la separación cliente/servidor del bundle; eso sigue
siendo responsabilidad del build de Next.

## Herramientas y reporte

module-graph.mjs analiza y aplica la política; module-graph-bundler.mjs comprueba
los dos recursos especiales; check-module-graph.mjs es el runner público. El
reporte .tmp/module-graph/latest.json conserva versiones, HEAD, cambios de fuentes
reportados por Git (staged/unstaged y untracked no ignorados), hashes de tsconfig,
lockfile, package y scripts del runner, grafo, ciclos y clasificación.
No incluye cuerpos de fuentes, variables de entorno o secretos.

Los canarios usan Madge real: alias válido, ciclo por alias, ciclo solo de tipos,
alias inexistente, import CSS inexistente, recursos CSS existentes/ausentes,
escape de paquete, recursos de servidor/cliente de Next, variaciones no toleradas,
wiring del gate/arnés y configuración ausente. Un intento intermedio exigía que
una fixture de import TS a un paquete produjera un aviso, pero no lo producía;
esa suposición se retiró. Se prueba en cambio un @import CSS inexistente real y
la existencia/ausencia de recursos, sin cambiar la política para esconder fallos.

Un canario adicional ejecuta el runner real en tres procesos: fixture válida,
ciclo de tipos e import desconocido, comprobando códigos 0/1/1 y sus reportes.
Usa --entry/--tsconfig y --report para limitar y separar esas fixtures; sin
argumentos el comando público sigue analizando las dos entradas canónicas.
La clasificación usa el bundler del directorio del tsconfig analizado, no el de
otro proyecto. Un segundo canario de proceso elimina un recurso del Next de
la fixture y exige código 1, aunque el repositorio padre tenga un Next válido.

## Verificación

```powershell
node --test scripts/quality/module-graph.test.mjs
npm run architecture:cycles
npm run verify:pr
```

Salidas completas locales en .tmp/module-graph:

| Comprobación | Resultado | Evidencia |
|---|---|---|
| API anterior, comparación emparejada | 0; 6.708 aristas/582 avisos | resolver-legacy.log/json |
| Canarios finales, Node 24.19.0 | 0; 13/13, incluidos procesos del comando real | resolver-canaries-complete.log |
| Canario intermedio con suposición inválida | 1; expectativa de conteo, sin defecto de producto | resolver-canaries-final.log |
| Node 22 offline dentro de restricción | 1; ENOTCACHED de su caché separada | resolver-node22.log |
| Canarios Node 22.23.4, caché local autorizada | 0; 13/13, incluidos procesos del comando real | resolver-node22-complete.log |
| Grafo final Node 24.19.0 | 0; cero ciclos/desconocidos, dos clasificados | resolver-gate-complete.log, latest-node24-complete.json |
| Grafo completo Node 22.23.4 | 0; mismo grafo, conteos y clasificación | resolver-root-node22-complete.log, latest-node22-complete.json |
| Igualdad entre runtimes | 0; deepEqual de HEAD/cambios/entradas/hashes/grafo/conteos/clasificación | resolver-runtime-parity-complete.log |
| verify:pr autorizado, primer runner | 0; arnés 37/37, OpenSpec 48/48, lint cero errores/572 warnings sin diferencias, tipos y verificación de producto completa | resolver-gate.log |
| verify:pr con primeros canarios de CLI | 0; arnés 38/38, OpenSpec 48/48, lint/tipos/grafo y verificación de producto completa aprobados | resolver-gate-final.log |
| verify:pr final | 0; arnés 39/39, OpenSpec 48/48, lint/tipos/grafo y verificación de producto completa aprobados | resolver-gate-complete.log |
| docs:check final | 0; 322 documentos | resolver-docs.log |
| openspec:validate final | 0; 48/48 | resolver-openspec.log |

SHA256 tsconfig: 55da79a2910ca2986c6aa22f948311abacfd2253a125346824ae09f33d259ab9.
SHA256 lockfile: 481690538cd0df697bac88ea65cf9339814fc771e823bff38725b27662340538.
Node 22 se ejecutó desde caché local sin red ni instalación global; no se cambió
el runtime del usuario o dependencias del proyecto. La comparación CommonJS de
F3.5.d1 y las suites dirigidas de QA permanecen como evidencia de sus extracciones.

## Revisión propia y continuidad

Se intentó refutar resolución, ciclos de tipos, recursos ausentes y rutas fuera
del paquete. La política falla cerrada; no agrega ignores, tolerancias por conteo,
dependencias o cambios de tsconfig para hacer pasar el gate. Los canarios se
ejecutan dentro de test:harness, no quedan como archivos solo compilados.
La revisión no es independiente. El grafo es estático; no demuestra ejecución de
imports dinámicos no literales ni seguridad cliente/servidor del bundle.

No se ejecutaron CI remoto, build o QA visual. La aceptación allí corresponde
a F5 y los pendientes de TD-08/31; no se declara despliegue o comportamiento cloud.
Reversión por commit local de F3.5.e; volver al runner anterior restauraría su
blindspot de alias y debe tratarse como regresión de la compuerta.

Siguiente unidad: F1.3.c.3.c.4, operaciones/clips/jobs HeyGen, en el tablero de
tenant-authorization-authority. Después continuar las unidades pendientes del
plan completo. Los cinco documentos y la auditoría heredados quedan preservados
fuera del commit de esta unidad; no archivar OpenSpecs pendientes de integración.
