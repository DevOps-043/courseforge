# Continuidad F3.5.b — 2026-11-05

## Base y resultado

Base b83fa4c2fd188901450bcdc0120139789a40e9d2, staging. F3.5.b cierra localmente
el grupo documento/plan/fuentes, sin cerrar TD-12 ni el objetivo global.
Madge pasa de diez a ocho recorridos y de tres a dos componentes. Las dos
restantes son HTTP narrativa y QA; ninguna contiene documento, clip, plan o
lector/contrato de fuentes. Avisos: 582, sin cambios de configuración o ignores.

## Implementación y compatibilidad

- composition-clip.contract.ts posee schemas y validaciones de un clip, layout,
  crop, media-fit y resolución de su asset. Es una extracción de 249 líneas.
- composition-font-reference.contract.ts posee los schemas, límite y tipo de
  referencia; el lector conserva su lógica y tipo de entrada de documento.
- composition-schema-primitives.ts centraliza las tres reglas compartidas de ID,
  número finito y segundos acotados; evita duplicarlas entre documento y clip.
- La tolerancia y comparación de fronteras se trasladan a constants existente.
- El documento conserva schemas de pistas, mezcla, grupos e invariantes globales;
  importa el schema de clip y sigue llamando al plan completo para su presupuesto.
- El plan importa CompositionClip del contrato y acepta solamente
  { clips: readonly CompositionClip[] }, compatible con el documento actual.
  Algoritmo, límites y errores no cambian. La entrada no se modifica.
- Las rutas públicas anteriores conservan todos sus nombres de export, valores
  y tipos mediante reexports. Las pruebas comprueban identidad de schemas,
  constantes, array media-fit y resolución de assets; no se crean copias Zod.

Sin cambios de formato, defaults, orden de campos, refinamientos, mensajes,
hash canónico, persistencia, motion, tiempos, preview/render, assets, permisos,
proveedores o SQL. La fuente canónica recibe la nueva dirección de dependencias.
Los cinco documentos heredados y auditoría/plan se preservan fuera del commit.

## Evidencia y reproducción

Se compiló la suite antes de extraer. snapshot-contracts.mjs usa únicamente
fixtures sintéticas deterministas: captions con una fuente y dos videos de
transiciones. Captura documentos serializados, hashes canónicos, planes,
referencias, defaults de clip y errores Zod de diez documentos inválidos más
cuatro listas de fuentes inválidas. Tras extraer, deepEqual compara la salida
completa con la base, sin normalizar campos para ocultar diferencias.

verify-moved-schemas.mjs compara AST con Git: 22 inicializadores o cuerpos de
función permanecen textualmente idénticos. También compara el conjunto completo
de exports públicos de los dos módulos anteriores. Esa comprobación cubre los
schemas completos de documento/clip/layout/crop/mezcla/grupos/pistas/fuentes,
primitivas, tolerancia, lector y dos funciones del plan, además de las fixtures.
No equivale a probar todos los valores posibles ni al build real del bundler.

```powershell
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.hyperframes-test.json
node openspec/changes/decouple-composition-document-contracts/reports/snapshot-contracts.mjs before
# Ejecutar before sobre la base, antes de aplicar la extracción.
node openspec/changes/decouple-composition-document-contracts/reports/snapshot-contracts.mjs after
node openspec/changes/decouple-composition-document-contracts/reports/verify-moved-schemas.mjs b83fa4c2fd188901450bcdc0120139789a40e9d2
npm run test:hyperframes -w apps/web
npm run verify:pr
```

Para reproducir snapshots históricos hace falta compilar la base en una copia
descartable autorizada; no ejecutar before en el código nuevo y llamarlo línea
base. Los snapshots locales de esta ejecución conservan la captura previa real.
No se creó worktree ni se sobrescribió el checkout principal para reproducirla.

Salidas completas locales: .tmp/module-graph.

| Comprobación | Resultado | Evidencia local |
|---|---|---|
| Compilación previa a la extracción | 0 | handle terminal 99405 |
| Captura previa | 0 | contracts-before.log/json |
| Compilación posterior | 0 | contracts-compile.log |
| Equivalencia de captura completa | 0 | contracts-after.log/json |
| Identidad de cuerpos/exports frente a Git | 0; 22 declaraciones y dos módulos | contracts-source-identity.log |
| HyperFrames completo | 0; incluye identidad de reexports y plan con clips readonly | contracts-hyperframes.log |
| verify:pr | 1 por ocho ciclos; arnés 26/26, OpenSpec 45/45, lint cero errores/572 warnings sin diferencias y tipos aprobados | contracts-gate.log |
| Madge API + Tarjan | 0; 2.286 archivos, ocho recorridos, 582 avisos, dos componentes, ninguna del grupo | contracts-graph.log/json |
| docs:check final | 0; 308 documentos | contracts-docs.log |
| openspec:validate final | 0; 45/45 | contracts-openspec.log |

El análisis API conserva exactamente las entradas/extensiones/tsconfig del gate
y usa cyclicComponents de F0.3 para comprobar también recorridos alternativos.
No se atribuyen los tests posteriores a architecture:cycles al gate, que se
detiene allí. HyperFrames se ejecutó separado. Sin CI, build, servicios externos,
render cloud, SQL o acceso a secretos. No cambia geometría o coreografía, por
lo que no se repitió QA visual de navegador.

## Revisión adversarial propia y continuidad

Se revisaron imports y consumidores antes de mover bloques. Se conservaron los
objetos y sus nombres públicos; no se reemplazaron tipos fuertes por any ni
se excluyeron import type del grafo. La firma mínima del plan sigue exigiendo
clips completamente tipados y conserva su discriminación de fuentes.
Las únicas correcciones durante verificación fueron líneas vacías finales;
no cambió lógica tras las pruebas. Revisión del mismo agente, no independiente.

Reversión: revertir el commit local de F3.5.b. No hay efectos externos que
compensar. Próxima unidad F3.5.c, contrato neutral de autoridad HTTP narrativa;
después F3.5.d1… QA y F3.5.e resolvedor con canarios. El resto de fases y lotes
de autorización mantiene el alcance íntegro del plan principal.
