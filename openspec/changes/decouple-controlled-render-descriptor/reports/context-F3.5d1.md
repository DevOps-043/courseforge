# Continuidad F3.5.d1 — 2026-11-05

## Base y resultado

Base d1649f0f2153563d079feace8f5f381fb0ec4afa en staging. La componente circular
de QA queda eliminada: siete recorridos → cero, una componente → cero.
verify:pr termina 0 por primera vez en esta secuencia local y alcanza los pasos
de producto posteriores a architecture:cycles. TD-12 permanece abierto por
F3.5.e: corregir resolución de alias y aceptar advertencias clasificadas.
La meta global conserva todo el resto del plan; no se redefine alrededor del gate.

## Implementación

composition-controlled-render-descriptor.contract.ts declara las mismas seis
propiedades del descriptor: organizationId, revisionId, executionId, documentHash,
projectHash y CompositionConformanceContract. Este último es la salida del mismo
schema del contexto de autoridad; no se copia ni se degrada su unión versionada.

Fence, materialización, selección y medición importan ese tipo en lugar de
derivarlo de Parameters del executor/supervisor. ControlledSupervisorRenderer
y ControlledMaterializedExecutor mantienen sus rutas, resultado, workspace,
señal y controles, usando el descriptor neutral. El supervisor ya no necesita
un alias privado Context solo para derivar ese tipo.

No se mueven funciones o decisiones: seis módulos emiten exactamente el mismo
JavaScript CommonJS que la base. No hay cambios de permisos, validación, claves,
leases, aislamiento, sincronización, cancelación, checkpoints, comparación,
subida o finalización; tampoco formatos, hashes, motion o proveedor.

## Comprobación de tipos y emisión

verify-descriptor-extraction.mjs compara emisiones contra Git, conserva SHA256
y crea una fuente virtual de TypeScript. Esta compara el descriptor neutral con
la forma anterior, incluido el tipo real devuelto por authority.issue. Una prueba
negativa exige que cambiar projectHash a number produzca desigualdad de tipos.
No hay cast any, exclusiones de fuentes o supresiones de diagnósticos para pasar.

El primer intento de fuente virtual falló TS6053 porque Windows mezclaba barras
en la comparación del nombre. Se corrigió el host diagnóstico con path.resolve;
no se cambió producto para resolverlo. El resultado final exige cero diagnósticos
y conserva tanto la prueba positiva como la negativa. No se afirma igualdad del
bundle SWC/Next: la comparación de bytes es de TypeScript CommonJS.

```powershell
node --max-old-space-size=4096 openspec/changes/decouple-controlled-render-descriptor/reports/verify-descriptor-extraction.mjs d1649f0f2153563d079feace8f5f381fb0ec4afa
npm run test:hyperframes -w apps/web
npm run verify:pr
```

## Suites dirigidas y resultados

El script test:hyperframes no ejecuta estas suites de QA. Se ejecutaron con
node --test sobre apps/web/.tmp/hyperframes-tests/domains/production/composition-editor/__tests__,
después de compilar la suite existente:

- composition-controlled-execution-fence.test.js
- composition-controlled-owned-executor.test.js
- composition-controlled-owned-temporary-environment.test.js
- composition-controlled-render-materialization.test.js
- composition-controlled-html-authority.test.js
- composition-controlled-reference-measurement.test.js
- composition-render-authority.test.js
- composition-render-supervisor-signature.test.js
- composition-controlled-render-worker.test.js
- composition-controlled-render-deadline.test.js

Dos adicionales cubren consumidores materiales y eventos:
composition-controlled-event-seek.test.js y composition-html-editing-materialization.test.js.

Las diez primeras produjeron 126/134 aprobadas en ejecución restringida. Los ocho
fallos pertenecían al archivo de autoridad al guardar checkpoints temporales.
La repetición autorizada fuera de esa restricción, con los mismos archivos
compilados y sin cambiar implementación, aprobó 46/46 del archivo de autoridad.
Los otros nueve archivos no tenían fallos; las dos suites adicionales aprobaron
29/29. Se conservan los resultados originales, no se presenta la primera
ejecución como verde ni se debilitaron garantías de disco para hacerla pasar.

| Comprobación | Resultado | Salida completa local en .tmp/module-graph |
|---|---|---|
| Emisión y equivalencia, primer host virtual | 1 por TS6053 del diagnóstico | descriptor-emission.log |
| Emisión y equivalencia final | 0; seis emisiones y dos pruebas de tipos | descriptor-emission-final.log |
| Script HyperFrames completo | 0 | descriptor-hyperframes.log |
| Diez archivos de QA, restringido | 1; 126/134, ocho fallos de checkpoints en autoridad | descriptor-qa.log |
| Autoridad, repetición autorizada | 0; 46/46 | descriptor-authority-retry.log |
| Dos archivos adicionales | 0; 29/29 | descriptor-qa-extra.log |
| Madge API y Tarjan | 0; 2.288 archivos, cero recorridos/componentes, 582 avisos | descriptor-graph.log/json |
| verify:pr autorizado | 0; arnés 26/26, OpenSpec 47/47, lint cero errores/572 warnings sin diferencias, tipos, ciclos, migraciones, branding, seguridad, audio web/API, coverage-gaps y entrega de cursos aprobados | descriptor-gate.log |
| docs:check final | 0; 318 documentos | descriptor-docs.log |
| openspec:validate final | 0; 47/47 | descriptor-openspec.log |

El grafo conserva las entradas/extensiones/tsconfig del comando existente y
usa Tarjan de F0.3; no se ignoran dependencias de tipos. Los 582 avisos todavía
impiden presentar ese grafo como exhaustivo. F3.5.e debe resolver los alias y
probar canarios de importaciones no resueltas y ciclos antes de aceptar TD-12.

## Revisión adversarial propia y continuidad

Se revisaron los consumidores del descriptor antes de editar. Los que necesitan
workspace/resultado del executor conservan esa dependencia legítima; no se
duplica la interfaz completa en todos los sitios. El descriptor neutral no
importa implementaciones de QA ni contiene un lease o grant que pueda autorizar
una operación. La igualdad de tipos verifica también el contrato de conformidad
real de autoridad, no una aproximación manual de su forma.

Revisión del mismo agente, no independiente. Las pruebas usan fixtures y servicios
simulados, con filesystem local real para fence y checkpoints. No acreditan
aislamiento de SO real, SQL/RLS, despliegue, power-loss, cloud o evidencia del
proveedor. No se ejecutaron build/CI/QA visual ni se leyeron secretos. No cambia
geometría o coreografía. Todos los handles de esta verificación están terminales.

Reversión por commit local de F3.5.d1; no hay efectos remotos que compensar.
Siguiente unidad F3.5.e, resolvedor del grafo y canarios. F3.4/TD-31 conserva las
exclusiones de suites de QA/HTTP detectadas; scripts compilados no equivalen a
pruebas ejecutadas ni integración CI. Después continuar los lotes de autoridad,
datos, publicación, transporte, operación, editor y aceptación del plan íntegro.
