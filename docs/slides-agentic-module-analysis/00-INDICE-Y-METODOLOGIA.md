# Diagnóstico del módulo de diapositivas

**Productos analizados:** SofLIA - Engine (`D:\Pulse Hub\courseforge`) y Pulse Hub (`D:\Pulse Hub\SofLIA-HUB`)  
**Fecha de corte:** 2026-08-15  
**Naturaleza del trabajo:** análisis estático de documentación y código; no se ejecutaron flujos contra proveedores ni se modificó código o base de datos.

## Nomenclatura

- **SofLIA - Engine** es el nombre actual del repositorio cuyo directorio conserva el nombre histórico `courseforge`.
- **Pulse Hub** es el nombre actual del repositorio cuyo directorio conserva el nombre histórico `SofLIA-HUB`.
- Los nombres históricos solo aparecen cuando forman parte de una ruta, identificador, texto persistido o evidencia literal.

## Índice

1. [Resumen ejecutivo](01-RESUMEN-EJECUTIVO.md)
2. [Mapa de SofLIA - Engine](02-MAPA-SOFLIA-ENGINE.md)
3. [Mapa de Pulse Hub](03-MAPA-PULSE-HUB.md)
4. [Matriz comparativa y brechas](04-MATRIZ-COMPARATIVA-Y-BRECHAS.md)
5. [Propuesta conceptual](05-PROPUESTA-CONCEPTUAL.md)
6. [Inventario de evidencia](06-INVENTARIO-DE-EVIDENCIA.md)
7. [Preguntas abiertas y decisiones](07-PREGUNTAS-ABIERTAS-Y-DECISIONES.md)

## Convenciones de evidencia

| Etiqueta | Significado |
|---|---|
| **[CÓDIGO]** | Comportamiento comprobable en la implementación versionada. No implica que se haya ejecutado en producción. |
| **[DOCUMENTADO]** | Afirmación presente en documentación, prompts, comentarios o manifiestos. |
| **[DISCREPANCIA]** | Documento, comentario, interfaz o nombre que no coincide con otro contrato o con la implementación observada. |
| **[INFERENCIA]** | Consecuencia técnica razonable derivada del código, pero no verificada ejecutando el flujo. |
| **[RECOMENDACIÓN]** | Propuesta para el módulo futuro; no describe una capacidad actual. |
| **[PREGUNTA ABIERTA]** | Decisión o dato que no puede resolverse con el repositorio. |

## Método

1. Se tomó `D:\Pulse Hub\SofLIA-HUB\docs\prompt_maestro.md` como punto de entrada obligatorio para Pulse Hub.
2. Se siguió la referencia canónica que el propio archivo declara hacia `docs/standards/engineering-practices.md`.
3. Se contrastaron contratos, prompts y comentarios con rutas ejecutables, persistencia, UI y pruebas.
4. En SofLIA - Engine se separaron cuatro superficies que suelen confundirse:
   - preparación de spec dentro del pipeline de video;
   - generación de decks ligada a componentes de materiales;
   - exportadores y adaptadores de producción;
   - skill y estudio de plantillas HTML.
5. En Pulse Hub se separaron el flujo principal de la Skill de escritorio, el workflow de WhatsApp y el generador PDF heredado.
6. No se asumió que un nombre como `agent.service.ts`, un prompt persistido o un comentario pruebe una llamada a IA; se verificaron las invocaciones efectivas a proveedores.

## Discrepancia de fuente principal en Pulse Hub

**[DOCUMENTADO]** `D:\Pulse Hub\SofLIA-HUB\docs\prompt_maestro.md` solo contiene un alias y declara que la fuente canónica extensa es `docs/standards/engineering-practices.md`; no documenta el flujo de diapositivas.

**[DISCREPANCIA]** El encargo identifica `prompt_maestro.md` como fuente principal de verdad para analizar diapositivas, mientras el archivo se autodefine como alias de prácticas generales. Para no escoger silenciosamente una versión:

- este diagnóstico registra lo que realmente dice el alias;
- usa `engineering-practices.md` para restricciones arquitectónicas generales;
- usa `ai-specs/skills/presentaciones-hyperframes-react/SKILL.md`, `src/prompts/skills/presentaciones.ts` y el código ejecutable como fuentes específicas del flujo;
- marca por separado las divergencias entre esos contratos.

## Límites

- No se validaron credenciales, proveedores externos, contenido de buckets o datos reales.
- No se ejecutaron migraciones ni consultas remotas.
- No se evaluó el pipeline completo de cursos salvo sus dependencias directas con slides.
- No se evaluaron capacidades generales de agentes, documentos o video salvo donde consumen o producen diapositivas.
- La presencia de pruebas demuestra intención y cobertura versionada, no que el estado actual de CI sea verde.

