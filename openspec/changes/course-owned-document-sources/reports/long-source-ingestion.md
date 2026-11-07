# Ingesta larga y visor paginado

Prueba local de extracción y fragmentación con el mismo texto sintético en TXT y DOCX. Ambos conservaron las 211,541 unidades UTF-16, incluida la marca final con Unicode. El extractor de Temario mantuvo su rechazo por encima de 40,000.

| Archivo | Bytes del original | Tiempo local | Delta RSS observado |
| --- | ---: | ---: | ---: |
| TXT | 216,045 | 51 ms | 4,485,120 bytes |
| DOCX | 990 | 71 ms | 5,902,336 bytes |

El DOCX es sintético y altamente compresible. Los deltas RSS son lecturas antes y después en el proceso de pruebas, no picos de memoria ni garantías de producción.

`npm run test:course-sources`: 59 pruebas de dominio y 25 de PostgreSQL aislado aprobadas. `npm run db:migrations:check`: aprobado.

La prueba PostgreSQL aislada guardó más de 129,000 unidades en cinco escrituras y recuperó íntegra la sección final. Rechazó publicar con lotes faltantes y rechazó otro lease u organización. Verificó confirmación idempotente y acceso de navegador denegado. Chrome headless con API sintética verificó avanzar y regresar entre páginas, texto escapado y el flujo histórico de biblioteca. El límite de admisión activo sigue en 40,000 hasta conectar Base por lotes.
