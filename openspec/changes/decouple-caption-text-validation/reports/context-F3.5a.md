# Continuidad F3.5.a — 2026-11-05

## Objetivo y cambio

Base: 799e398c en staging. La extracción de captions definida por F0.3 queda
cerrada localmente. TD-12, F3.5 y la meta del plan completo siguen abiertos.

El schema de cues dependía del servicio de efectos para validar énfasis. Ese
servicio importaba tipos de cues y text-presentation, que también depende de los
tipos de cues. La componente de tres módulos desaparece al dirigir el schema a
un módulo neutral, composition-caption-text-validation.ts.

Se movieron exactamente isCaptionTextBoundary y captionEmphasisIssues, con su
segmentador de grafemas, sin cambiar el algoritmo. El nuevo módulo solo importa
un tipo del contrato de efectos. El servicio conserva ambos exports mediante
reexports. Su segmentador de palabras y las demás funciones permanecen iguales.
El schema solo cambia el origen de un import; conserva superRefine, mensajes,
schemas y reglas. Sin cambios de serialización, defaults, formato v2, hashes,
motion, tiempos, assets, snapshots, credenciales, proveedor, UI ni render.

## Caracterización y verificación

Antes de extraer, se añadieron dos pruebas por la interfaz pública existente:
fronteras UTF-16 de emoji ZWJ, acentos combinantes y banderas; rechazo de rangos
divididos/solapados y límites externos; adyacencia y entrada desordenada sin
mutación. Aprobaron junto con las 15 pruebas previas, total 17/17.

Salidas completas en .tmp/module-graph:

| Comando / observación | Resultado | Log |
|---|---|---|
| npm run test:composition-caption-effects -w apps/web, antes de extraer | 0; 17/17 | caption-before.log |
| npm run test:composition-caption-presets -w apps/web, después | 0; 57/57 en cinco archivos | caption-presets-after.log |
| npm run test:hyperframes -w apps/web | 0; suite completa | caption-hyperframes.log |
| npm run verify:pr, autorizado para repositorios temporales | 1 solo por diez ciclos; arnés 26/26, OpenSpec 44/44, lint cero errores/572 warnings sin diferencias y tipos aprobados | caption-verify-pr.log |
| API Madge, mismas entradas/extensiones/tsconfig, y Tarjan de F0.3 | 0; 2.283 archivos, diez recorridos, 582 avisos; tres componentes, ninguna con los módulos del grupo captions | caption-graph.log/json |
| npm run docs:check, final | 0; 303 documentos comprobados | caption-docs-final.log |
| npm run openspec:validate, final | 0; 44/44 | caption-openspec-final.log |

Madge usa exactamente apps/web/src, apps/web/netlify/functions, extensiones
ts/tsx y apps/web/tsconfig.json. El conteo pasa de once a diez recorridos y de
cuatro a tres componentes, sin cambiar scripts, ignores o versiones. Se conserva
el bloqueo del gate por los demás grupos. El análisis completo de consumidores
se puede regenerar con inventory.mjs de F0.3; no sobrescribir su resumen histórico
con la captura de una fase posterior.

No se ejecutaron comandos posteriores a architecture:cycles dentro del gate;
HyperFrames se ejecutó por separado. Sin CI, build, navegador, render cloud,
servicios externos, SQL ni lectura de secretos. La QA visual no se repitió porque
no se modifican HTML, estilos, geometría o coreografía; los tests existentes
comprueban compilación, programación GSAP y estado tras seeks.

## Revisión adversarial propia y reversión

Revisados todos los consumidores actuales de las funciones: el schema era el
único importador directo y ahora usa el módulo neutral. Los reexports preservan
la interfaz pública para consumidores externos; las pruebas la siguen usando.
El nuevo módulo no importa CompositionCaptionCue ni el servicio, y no se crean
schemas alternativos, lógica duplicada o dependencias nuevas.
No se cambió la validación para hacer pasar casos previamente inválidos ni se
eliminó import type del grafo. La reducción está comprobada por el gate y las
componentes completas, no solo por ausencia de un nombre en sus once recorridos.
Esta revisión la hizo el mismo agente, sin atribuir independencia.

Reversión: revertir el commit local de F3.5.a. El commit excluye los cinco
documentos heredados, la auditoría y el plan no versionados por estas unidades.
La fuente canónica multimedia sí recibe una nota de la nueva dirección de
dependencias y evidencia. Los contratos del proveedor no cambiaron; no corresponde
una actualización de compliance ni despliegue.

## Continuidad

Siguiente unidad F3.5.b: documento/plan de captions/fuentes, previa lectura de
sus contratos y consumidores. Después F3.5.c narrativa y F3.5.d1… QA, además
de corregir la resolución del analizador con canarios en F3.5.e. Los lotes HTTP
F1.3.c.3.c.4 y restantes conservan su alcance; el plan global incluye todavía
datos, publicación, transporte, operación, editor y aceptación de ambiente.
