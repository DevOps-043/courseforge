**PRD**

# **SofLIA Engine — Editor**

Product Requirements Document técnico-funcional con trazabilidad de reunión a validación

| Propósito del documentoFuente de verdad para Product, Engineering y DevOps: Meeting → Evidence → Issue → Decision → Requirement → Ticket → QA → Validation. Los datos no soportados se conservan como \[Pendiente\]. |
| :---- |

&nbsp;

| Campo | Valor |
| ----- | ----- |
| **PRD ID** | PRD-2026-09-09-ENGINE-EDITOR-001 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Producto / Módulo** | SofLIA Engine / Editor |
| **Versión / fecha** | v0.1 / 2026-09-09 |
| **Estado** | Draft — listo para refinement; no todos los requerimientos están Ready for Development |
| **Fuente primaria** | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md |

&nbsp;

# **Document Control**

| Campo | Valor |
| ----- | ----- |
| **PRD ID** | PRD-2026-09-09-ENGINE-EDITOR-001 |
| **Producto** | SofLIA Engine |
| **Módulo** | Editor |
| **Versión** | v0.1 |
| **Fecha de creación** | 2026-09-09 |
| **Última actualización** | 2026-09-09 |
| **Product Owner** | \[Pendiente de validación — Ernesto Hernández Martínez actuó como principal decisor en la reunión\] |
| **Technical Owner** | [Pedro Alexis Echeverría Mendoza](mailto:pedro.echeverria@soflia.ai) |
| **Estado** | Draft / Under Analysis — con decisiones y Musts ya priorizados |
| **Fuente primaria** | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md |
| **Fuente / versión** | Transcripción editable; versión formal no indicada |

&nbsp;

| Regla de trazabilidadTodo elemento importante conserva Meeting ID, timestamp y Evidence ID. Tickets, sprints, builds y pruebas se dejan en \[Pendiente\] hasta que existan en el sistema de trabajo. |
| :---- |

&nbsp;

# **1\. Executive Summary**

La reunión del 9 de septiembre de 2026 fue una revisión funcional del SofLIA Engine — Editor apoyada por un usuario experto en edición de video. A partir de una demostración real se identificaron gaps de timeline, transiciones, color, texto, audio, performance y consistencia de render. La discusión evoluciona desde feedback de uso hacia decisiones de alcance y arquitectura.

La dirección de producto resultante es clara: el Editor debe convertirse en un módulo independiente, capaz de producir de forma recurrente material de calidad premium para los primeros cursos, sin intentar replicar un NLE completo como Adobe Premiere. Las funciones profesionales de uso frecuente deberán incorporarse; los casos avanzados o esporádicos podrán resolverse temporalmente en una herramienta externa.

La principal prueba de aceptación de la primera etapa es reproducir dentro del Editor el último video premium de referencia. La fuente identifica como gaps de alta prioridad: corrección básica de color, texto/captions nativos y capacidad suficiente de audio; también aparecen nesting, transiciones reales y performance del preview como necesidades relevantes. Existen dos defectos técnicos que requieren diagnóstico antes de considerar estable el pipeline: cambio de color no solicitado y reproducción saltada/lenta de un clip.

| Estado recomendadoEl PRD v0.1 es suficiente para crear épicas/tickets de discovery y desarrollo, pero no debe declararse completamente “Ready for Development” hasta cerrar OQ-001/002/003/004/008/010/011/012 y contar con estimación de Engineering. |
| :---- |

&nbsp;

# **2\. Meeting Record**

| Campo | Valor |
| ----- | ----- |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Nombre de la reunión** | SofLIA Engine \- Editor |
| **Producto** | SofLIA Engine |
| **Módulo** | Editor |
| **Fecha** | 2026-09-09 |
| **Hora de inicio** | 12:02 CST \[inferida del nombre de archivo; segundos no disponibles\] |
| **Hora de término** | \[No indicada\]. Aproximadamente 13:29 CST sólo si la hora 12:02 del archivo corresponde al inicio real. |
| **Duración** | Transcripción: 01:27:23 |
| **Zona horaria** | CST según nombre de archivo |
| **Lugar / medio** | \[No determinado; interacción remota con pantalla compartida es consistente con la transcripción, pero no se identifica plataforma\] |
| **Fuente primaria** | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md |
| **Fecha de generación de la fuente** | 2026-09-09 \[inferida del nombre/encabezado; hora exacta no indicada\] |
| **Versión de la fuente** | \[No determinada\] — transcripción editable |
| **Convocante** | \[No determinado\] |
| **Objetivo declarado** | Explorar el editor; Charlie debe dar recomendaciones y ayudar a evaluar cómo está. |
| **Objetivo inferido** | Evaluar si el editor actual puede soportar producción de video premium para SofLIA, identificar gaps y definir qué capacidades deben incorporarse en primera etapa. |
| **Producto o versión evaluada** | \[Build no identificado\] |
| **Ambiente evaluado** | \[No determinado — se menciona que aún están en pruebas\] |
| **Documentos relacionados** | Último video de referencia entregado a Charlie \[archivo no adjunto\]; grabaciones de conferencia mencionadas \[no adjuntas\] |
| **Grabación disponible** | No determinado |
| **Transcripción disponible** | Sí |

&nbsp;

## **Participantes**

| Participante | Rol organizacional | Rol dentro de la reunión | Tipo de participación |
| :---: | ----- | ----- | ----- |
| Ernesto Hernández Martínez | \[No indicado en la fuente\] | Decisor principal sobre alcance, calidad y dirección de producto | Stakeholder / decisor |
| Israel Martínez Arias | \[No indicado en la fuente\] | Presenta/Opera el editor; aporta contexto de implementación, assets, presets y render | Product/technical stakeholder / evaluador |
| guitarblueghost (llamado “Charlie” durante la reunión) | \[No indicado en la fuente\] | SME de edición de video; evalúa flujos y propone requerimientos | Usuario experto / SME / evaluador |

&nbsp;

# **3\. Meeting Classification**

| Campo | Valor |
| ----- | ----- |
| **Tipo principal de reunión** | Functional Review / Product Review |
| **Tipos secundarios** | Requirements Gathering; UX Review; User Feedback Session; Technical Discovery; Product Validation |
| **Objetivo real** | Usar un proyecto/video concreto para detectar gaps del editor y transformar feedback profesional en capacidades prioritarias para producción. |
| **Resultado esperado** | Lista priorizada de gaps, decisiones de alcance, bugs a diagnosticar y siguiente secuencia de desarrollo/validación. |
| **Fase del ciclo de producto** | Validation → Definition, con Technical Discovery sobre render y frame rate |

&nbsp;

La clasificación se basa en lo que ocurrió: el equipo mostró el editor, el SME lo usó/observó, comparó comportamientos con prácticas de edición profesional, señaló problemas, y Ernesto convirtió parte de ese feedback en decisiones explícitas de alcance y calidad.

# **4\. Meeting Timeline**

| Timestamp | Evento | Participante | Tipo | Resultado |
| :---: | ----- | ----- | ----- | ----- |
| 00:27:06 | Se inicia formalmente la exploración del editor y se pide evaluación/recomendaciones. | Israel | Acción / objetivo | Arranca la revisión funcional. |
| 00:29:24 | Se identifica la necesidad de anidar/agrupar capas. | Charlie | Requerimiento | Candidato FR-003. |
| 00:30:42 | Se propone vincular audio y video. | Charlie | Recomendación | Candidato FR-004. |
| 00:32:10 | Se detecta que no existen transiciones reales entre dos clips. | Charlie / Israel | Problema | ISSUE-003 / FR-005. |
| 00:33:41 | Se confirma que no hay edición de color; se define un mínimo profesional. | Israel / Charlie | Problema / requerimiento | ISSUE-004 / FR-006. |
| 00:36:40 | Se solicita edición de audio y presets. | Charlie | Requerimiento | FR-009 / FR-010. |
| 00:37:50 | Se explora keyframing; capacidad actual parcial. | Charlie / Israel | Pregunta | FR-011 en análisis. |
| 00:39:49 | Se propone shortcut de teclado; se valida zoom de preview. | Charlie / Israel | Recomendación / demo | FR-012; zoom \= existente. |
| 00:41:05 | Se valida rejilla y se confirma ausencia de texto nativo. | Charlie / Israel | Demo / problema | FR-008; rejilla \= existente. |
| 00:44:19 | Se evidencia calidad insuficiente de un avatar de prueba. | Charlie / Israel | Observación | ISSUE-014. |
| 00:46:53 | Se evidencia ruido/voz apagada; se recomienda tratamiento básico y presets. | Charlie / Israel | Problema | ISSUE-015 / FR-009. |
| 00:49:40 | Se delimita audio: resolver básico, no construir Pro Tools. | Charlie | Recomendación de alcance | Soporta DEC-004. |
| 00:52:51 | Clip de tren se percibe saltado/lento; se propone preview reducido. | Charlie / Israel | Bug / recomendación | BUG-002 / FR-013. |
| 00:55:13 | Israel se compromete a verificar si el defecto ya venía en la fuente. | Israel | Acción | ACT-004. |
| 00:56:33 | Se reitera importancia de texto y unificación de color. | Charlie | Requerimiento | FR-006 / FR-008. |
| 01:00:07 | Evaluación global: editor actual es básico y aún insuficiente para premium. | Charlie | Observación | ISSUE-010. |
| 01:01:33 | Se detecta cambio de color sin manipulación; se discute compresión/render como hipótesis. | Israel / Charlie | Bug / hipótesis | BUG-001. |
| 01:04:30 | Se plantea mismatch de frame rate como hipótesis. | Charlie / Israel | Hipótesis | FR-015 / OQ-005. |
| 01:07:24 | Se revisan presets/templates existentes y adaptación automática de assets. | Israel / Charlie | Demo / recomendación | FR-014. |
| 01:13:09 | Ernesto fija benchmark: último video debe salir del Editor; captions son gap. | Ernesto | Decisión | DEC-005 / FR-002 / FR-008. |
| 01:13:09 | Se decide desacoplar el Editor del flujo de cursos. | Ernesto | Decisión | DEC-003 / FR-001. |
| 01:16:30 | Se define enfoque híbrido con editor profesional externo para finishing avanzado. | Ernesto / Charlie | Decisión | DEC-006. |
| 01:17:44 | Se delimita que no se replicará Premiere; se priorizan funciones de uso frecuente. | Ernesto | Decisión | DEC-004. |
| 01:19:11 | Se abre línea futura de motion graphics. | Charlie | Idea futura | FR-017. |
| 01:20:13 | Se abre línea futura de edición AI-native por prompt/selección. | Ernesto / Charlie | Dirección futura | FR-016 / ACT-007. |
| 01:24:13 | Se refuerza rapidez de entrega y calidad premium. | Ernesto | Decisión | DEC-007. |
| 01:25:51 | Se acuerda continuar revisión al día siguiente. | Equipo | Acción | ACT-008. |

&nbsp;

# **5\. Product Context**

## **Producto / módulo analizado**

SofLIA Engine — Editor: editor de video actualmente integrado/embebido en el proceso de generación de cursos, con timeline por capas, preview, assets y proceso de ensamble/render.

## **Estado actual**

* Timeline por capas con audio y video separados.  
* Preview disponible; zoom de preview validado como existente.  
* Rejilla/guías de referencia aparentemente existentes.  
* Presets/plantillas de timeline existentes al menos parcialmente, incluyendo extracción/reutilización de una timeline.  
* No existe edición básica de color.  
* No existe creación nativa de texto según Israel.  
* Las “transiciones” actuales funcionan principalmente como animaciones de entrada/salida de un clip, no como transición de dos clips.  
* Keyframing/movimiento se describe como parcial.  
* El editor todavía no ha demostrado paridad con el último video premium de referencia.  
* El módulo está acoplado al flujo de generación de cursos y se pretende descentralizar.

## **Infraestructura / servicios mencionados**

Se menciona un ensamble/render en nube y preparación de archivos en un ZIP. El nombre del proveedor aparece de forma ambigua en la transcripción; debe validarse. También se mencionan herramientas/modelos externos de IA para video y Adobe Premiere como herramienta profesional de apoyo.

# **6\. Problem Statement**

El Editor permite ensamblar y reutilizar assets con ventajas importantes de velocidad, pero hoy no cubre varios controles recurrentes necesarios para producir video premium de forma autónoma y consistente. El equipo no puede aún demostrar que el último video de referencia se produzca completamente dentro del módulo. Además, se observaron posibles defectos de fidelidad de color y temporalidad que comprometen la confiabilidad del render.

| Problema centralSofLIA necesita que el Editor reduzca radicalmente el tiempo de producción de video sin convertir al usuario en operador de un NLE complejo y sin introducir degradaciones de calidad invisibles durante preview/render. |
| :---- |

&nbsp;

# **7\. Product Goal**

## **Objetivo de negocio**

Acelerar la producción de cursos, talleres y video corporativo de SofLIA, sosteniendo un estándar premium y evitando que la capacidad de entrega quede limitada por tareas manuales de postproducción.

## **Objetivo de producto**

Convertir el Editor en una capacidad independiente y suficientemente completa para ejecutar el 80/20 del trabajo recurrente de SofLIA, reservando herramientas profesionales externas para finishing avanzado o excepcional. El porcentaje 80/20 es una formulación de producto, no una métrica aprobada; su umbral operativo debe definirse.

## **Objetivo del usuario**

Crear y ajustar video de calidad profesional con menos pasos, presets reutilizables y controles esenciales dentro de un solo flujo.

## **Objetivo técnico**

Garantizar que assets, timeline, preview y render conserven color, temporalidad y calidad de forma predecible; desacoplar el Editor del flujo de cursos y establecer contratos técnicos explícitos.

## **Estándar de calidad esperado**

“Premium”, operacionalizado inicialmente como paridad con el último video de referencia y posteriormente mediante criterios medibles de color, audio, render, performance y UX.

| Product Goal StatementEl objetivo del producto es permitir que el equipo de producción de SofLIA pueda crear y finalizar videos premium para cursos y contenido corporativo sin necesidad de depender de un editor profesional externo para las tareas recurrentes, manteniendo fidelidad visual/temporal, velocidad de edición y control suficiente sobre color, audio, texto y composición. |
| :---- |

&nbsp;

# **8\. Users**

| Usuario | Necesidad principal | Nivel de expertise esperado |
| :---: | ----- | ----- |
| Editor/creador de contenido SofLIA | Ensamblar, corregir y finalizar material recurrente de forma rápida. | Intermedio; no debe requerir conocimiento profundo de Premiere. |
| SME / editor profesional | Validar calidad, identificar gaps, crear presets y resolver excepciones. | Avanzado/profesional. |
| Product/QA | Comparar output con benchmark, reproducir bugs y aprobar releases. | Funcional/técnico. |
| Equipo de cursos/contenido | Consumir el editor desde procesos de Learning/Engine sin acoplamiento rígido. | Operativo. |

&nbsp;

# **9\. Current State**

El editor actual resuelve ensamblaje básico y ofrece ventajas relevantes en generación/reutilización de assets y presets. La evaluación experta lo considera útil para ciertos videos de SofLIA, pero todavía “básico” para un nivel premium de forma autónoma. Los videos premium mostrados previamente no habían sido producidos por completo dentro de este Editor.

## **Clasificación de capacidades actuales**

| Capacidad | Estado | Evidencia |
| :---: | ----- | ----- |
| Timeline por capas | Existente | EV-001/EV-002 |
| Audio y video separados | Existente | EV-001/EV-003 |
| Preview | Existente | EV-001 |
| Zoom de preview | Existente/validado | EV-008 |
| Guías/rejilla | Existente aparente | EV-009 |
| Textos/captions nativos | Inexistente | EV-009/EV-021 |
| Corrección de color | Inexistente | EV-005 |
| Transición de dos clips | Inexistente/limitada | EV-004 |
| Keyframes | Parcial | EV-007 |
| Presets de timeline | Existente/parcial | EV-019 |
| Audio post básico | Insuficiente/no confirmado | EV-006/EV-011 |
| Preview reducido/proxy | No confirmado / faltante | EV-013 |
| Editor independiente | Inexistente | EV-022 |

&nbsp;

# **10\. Target State**

* Editor accesible como módulo independiente y reutilizable por distintos flujos de SofLIA.  
* Capacidad de reproducir el video premium de referencia dentro del editor, con excepciones explícitas y controladas.  
* Controles esenciales de color, texto/captions y audio dentro del flujo principal.  
* Timeline manejable mediante nesting y relaciones de clips que reduzcan errores.  
* Transiciones reales y edición de motion suficiente para los casos recurrentes.  
* Preview fluido mediante calidad ajustable, sin degradar render final.  
* Pipeline de render determinista: sin cambios de color o temporalidad no solicitados.  
* Roadmap separado para motion graphics y edición AI-native avanzada.

# **11\. Evidence Register**

| ID | Fuente | Meeting ID | Timestamp | Participante | Síntesis | Tipo | Anchor |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| EV-001 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:27:06 | Israel Martínez Arias | Se declara que la sesión explorará el editor y que Charlie deberá dar recomendaciones y ayudar a evaluar su estado. | Observación / objetivo | L307–L323 |
| EV-002 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:29:24 | guitarblueghost (Charlie) | Identifica la necesidad de anidar/agrupar varias capas como un solo elemento para mantener limpia la timeline; lo describe como básico en edición profesional. | Comentario de usuario experto | L339–L377 |
| EV-003 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:30:42 | guitarblueghost (Charlie) | Propone vincular audio y video para conservar sincronización y evitar desplazamientos accidentales. | Recomendación | L377–L381 |
| EV-004 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:32:10 | guitarblueghost (Charlie) / Israel Martínez Arias | Se aclara que el editor tiene animaciones de entrada/salida sobre un clip, pero no una transición real que opere simultáneamente entre dos clips. | Demostración / limitación | L407–L421 |
| EV-005 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:33:41 | Israel Martínez Arias / guitarblueghost (Charlie) | Israel confirma que no hay edición de color. Charlie define como mínimo saturación, contraste y brillo para unificar material y sostener calidad profesional. | Demostración / requerimiento | L429–L449 |
| EV-006 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:36:40 | guitarblueghost (Charlie) | Solicita edición básica de audio: fades, efectos/limpieza y presets de voz; también explica el valor de presets reutilizables. | Recomendación experta | L453–L465 |
| EV-007 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:37:50 | guitarblueghost (Charlie) / Israel Martínez Arias | Se explora control temporal de posición/tamaño mediante keyframes; Israel indica que existe parcialmente. | Descubrimiento funcional | L469–L477 |
| EV-008 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:39:49 | guitarblueghost (Charlie) / Israel Martínez Arias | Se propone shortcut de teclado para play/pause. Se valida que el preview puede ampliarse sin alterar el tamaño real del video. | Recomendación \+ validación | L503–L529 |
| EV-009 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:41:05 | guitarblueghost (Charlie) / Israel Martínez Arias | Se valida la existencia de rejilla/guías. Israel confirma que no existe una opción nativa para agregar texto. | Validación / limitación | L533–L561 |
| EV-010 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:44:19 | guitarblueghost (Charlie) / Israel Martínez Arias | Se observa un avatar con apariencia desenfocada y baja calidad percibida; Israel lo atribuye a la calidad base del avatar y condiciones de captura. | Observación de calidad | L569–L615 |
| EV-011 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:46:53 | guitarblueghost (Charlie) / Israel Martínez Arias | Se detecta ruido/room tone y voz con poca presencia; se recomienda edición separada y presets de voz. Israel confirma que la voz ha sido un problema recurrente en pruebas. | Observación / problema recurrente | L625–L655 |
| EV-012 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:49:40 | guitarblueghost (Charlie) | Delimita alcance: no construir Pro Tools; la primera versión debe resolver problemas menores de audio y dejar trabajo avanzado a herramientas especializadas. | Recomendación de alcance | L659–L675 |
| EV-013 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:52:51 | guitarblueghost (Charlie) / Israel Martínez Arias | Se observa un clip de tren con reproducción saltada/lenta. Se recomienda preview a menor calidad; Israel confirma retrasos de carga del preview después de editar. | Observación / recomendación | L683–L715 |
| EV-014 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:55:13 | Israel Martínez Arias / guitarblueghost (Charlie) | Israel aclara que lo mostrado ya es ensamble final y debe verificar si el video fuente ya venía con el problema de movimiento. | Pregunta técnica / acción | L723–L735 |
| EV-015 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:56:33 | guitarblueghost (Charlie) | Reitera que texto nativo es importante y muestra una inconsistencia fuerte de luminosidad/color entre clips, reforzando la necesidad de unificación de color. | Observación / requerimiento | L745–L755 |
| EV-016 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:00:07 | guitarblueghost (Charlie) | Evalúa el editor actual como básico y suficiente para resolver ciertos casos, pero insuficiente para una calidad superior sin iteración y funciones adicionales. | Evaluación funcional | L781–L815 |
| EV-017 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:01:33 | Israel Martínez Arias / guitarblueghost (Charlie) | Se observa cambio de color no intencional. Israel plantea como hipótesis la preparación/compresión para render en nube; Charlie confirma que el cambio no debería ocurrir, pero no puede diagnosticar la causa. | Bug observado \+ hipótesis no confirmada | L817–L857 |
| EV-018 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:04:30 | guitarblueghost (Charlie) / Israel Martínez Arias | Se plantea que diferencias de frame rate (24/25/30 fps) podrían explicar pausas o ralentización; la causa no se confirma y el tema se difiere para análisis posterior. | Hipótesis técnica | L861–L889 |
| EV-019 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:07:24 | Israel Martínez Arias / guitarblueghost (Charlie) | Israel describe presets/plantillas de timeline ya existentes, incluyendo extracción de un timeline. Charlie recomienda que el material arrastrado se adapte automáticamente a tamaño y proporción del preset. | Funcionalidad existente \+ mejora | L895–L925 |
| EV-020 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:10:52 | guitarblueghost (Charlie) | Reconoce fortalezas actuales, especialmente generación de assets y ahorro de tiempo, pero indica que aún no ve un video premium producido completamente dentro del editor. | Evaluación de producto | L929–L937 |
| EV-021 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:13:09 | Ernesto Hernández Martínez | Aclara que el último video de referencia no se produjo en el editor y establece como objetivo reproducirlo desde el editor; identifica captions transparentes como una carencia conocida. | Decisión / objetivo de validación | L941–L963 |
| EV-022 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:13:09 | Ernesto Hernández Martínez | Define que el módulo actualmente está embebido en generación de cursos y debe descentralizarse para uso independiente; también indica que no se busca competir con Premiere. | Decisión de producto/arquitectura | L963–L991 |
| EV-023 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:16:30 | Ernesto Hernández Martínez / guitarblueghost (Charlie) | Se acuerda un enfoque híbrido: usar el editor para el flujo frecuente y herramientas profesionales externas para detalles que aún no resuelva; el editor debe incorporar lo básico indispensable de uso recurrente. | Decisión de alcance | L1003–L1029 |
| EV-024 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:19:11 | guitarblueghost (Charlie) | Describe motion graphics basados en templates como una fuente importante de calidad pero problemática en Premiere; abre oportunidad de simplificar esa edición. | Idea futura | L1033–L1069 |
| EV-025 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:20:13 | Ernesto Hernández Martínez / guitarblueghost (Charlie) | Se plantea explorar herramientas/modelos de IA para edición por instrucción y selección de regiones; Charlie propone selección visual directa para evitar descripciones largas. | Dirección futura / acción | L1073–L1119 |
| EV-026 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:24:13 | Ernesto Hernández Martínez | Establece la meta de reducir tiempos de entrega sin sacrificar calidad; al cierre exige que la entrega sea premium y que la primera etapa iguale la calidad del último video de referencia. | Decisión / estándar de calidad | L1125–L1167 |
| EV-027 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:25:51 | guitarblueghost (Charlie) | Explica que el salto de muy bueno a muy bueno/premium depende de múltiples detalles pequeños, entre ellos transiciones y foley. | Recomendación de calidad | L1151–L1171 |
| EV-028 | SofLIA Engine \- Editor\_ 2026\_09\_09 12\_02 CST \- Notas de Gemini(1).md | MTG-2026-09-09-ENGINE-EDITOR-001 | Fuente | Sistema de transcripción | La fuente se identifica como transcripción de “SofLIA Engine \- Editor”, fechada el 9 de septiembre de 2026, y advierte que fue generada por computadora y puede contener errores o ediciones posteriores. | Metadato / calidad de fuente | L1–L5; L1177–L1179 |

&nbsp;

# **12\. Issues / Pain Points**

| ID | Fecha | Timestamp | Quién | Evidencia | Usuario | Impacto / problema | Severidad | Estado | Tipo |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| ISSUE-001 | 2026-09-09 | 00:29:24 | Charlie | EV-002 | Editor de video | Timeline crece por capas unitarias y puede volverse difícil de gestionar sin agrupación/anidado. | High | Confirmado | Limitación funcional / UX |
| ISSUE-002 | 2026-09-09 | 00:30:42 | Charlie | EV-003 | Editor de video | Audio y video relacionados pueden desplazarse de forma independiente; riesgo de perder sincronización. | Medium | Identificado | Workflow / UX |
| ISSUE-003 | 2026-09-09 | 00:32:10 | Charlie | EV-004 | Editor de video | No existen transiciones reales de dos clips; solo animaciones de entrada/salida aplicadas a un clip. | Medium | Confirmado | Limitación funcional |
| ISSUE-004 | 2026-09-09 | 00:33:41 | Charlie / Israel | Editor de video | No existe corrección de color básica para homogeneizar clips. | High | Priorizado | Limitación funcional / calidad |  |
| ISSUE-005 | 2026-09-09 | 00:41:05 | Israel / Charlie | Editor de video | No existe creación nativa de texto; captions transparentes del video de referencia siguen faltando. | High | Priorizado | Limitación funcional |  |
| ISSUE-006 | 2026-09-09 | 00:46:53 | Charlie / Israel | Producción de audio | No hay herramientas suficientes para limpieza, fades y tratamiento básico de voz dentro del flujo. | High | Confirmado | Calidad / limitación funcional |  |
| ISSUE-007 | 2026-09-09 | 00:52:51 | Charlie / Israel | Editor / Preview | Preview presenta retraso de carga después de cambios y puede reproducirse a saltos con material pesado. | Medium | Confirmado | Performance |  |
| ISSUE-008 | 2026-09-09 | 01:01:33 | Israel / Charlie | Render final | Se observa cambio de color no solicitado entre material/origen y ensamble final. Causa no confirmada. | High | En análisis | Bug / calidad |  |
| ISSUE-009 | 2026-09-09 | 01:04:30 | Charlie / Israel | Render / Timeline | Manejo de clips con 24/25/30 fps no está confirmado; existe riesgo de stutter o ralentización por interpretación temporal. | High | En análisis | Arquitectura / compatibilidad |  |
| ISSUE-010 | 2026-09-09 | 01:13:09 | Ernesto | Producto | El editor todavía no reproduce de extremo a extremo el último video premium de referencia. | High | Priorizado | Product gap |  |
| ISSUE-011 | 2026-09-09 | 01:13:09 | Ernesto | Arquitectura de producto | El editor está embebido en el proceso de generación de cursos y mezcla responsabilidades; debe desacoplarse. | High | Priorizado | Arquitectura / workflow |  |
| ISSUE-012 | 2026-09-09 | 00:37:50 | Charlie / Israel | Motion / Editing | Control temporal de posición/tamaño existe solo parcialmente. | Medium | Identificado | Funcionalidad parcial |  |
| ISSUE-013 | 2026-09-09 | 00:39:49 | Charlie | UX | Faltan atajos de teclado de transporte para edición rápida. | Low | Identificado | UX |  |
| ISSUE-014 | 2026-09-09 | 00:44:19 | Charlie / Israel | Assets de avatar | Calidad de ciertos avatares/base visual puede llegar desenfocada o plana, afectando resultado premium. | High | Confirmado | Calidad de asset / dependencia externa |  |
| ISSUE-015 | 2026-09-09 | 00:46:53 | Charlie / Israel | Assets de voz | Voces de prueba presentan ruido/room tone y poca presencia; Israel señala recurrencia. | High | Confirmado | Calidad de asset / audio |  |
| ISSUE-016 | 2026-09-09 | 01:19:11 | Charlie | Motion graphics | Motion graphics avanzados y templates paramétricos no están cubiertos de forma fluida en el editor actual. | Low | Diferido | Funcionalidad futura |  |
| ISSUE-017 | 2026-09-09 | 00:35:18 | Charlie | Color / UX | No se confirmó una vista de referencia/compare ni una función de igualación de color. | Medium | Identificado | Mejora sugerida |  |

&nbsp;

# **13\. Functional Requirements**

Los requisitos siguientes se derivan de evidencia y decisiones. “Approved/Prioritized” sólo se usa cuando la reunión contiene una decisión explícita. “Under Analysis” indica necesidad válida todavía pendiente de definición o aprobación formal.

### **FR-001 — Editor desacoplado y utilizable como módulo independiente**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:13:09 |
| **Solicitado / identificado por** | Ernesto Hernández Martínez |
| **Evidence ID** | EV-022 |
| **Issue relacionado** | ISSUE-011 |
| **Prioridad** | Must |
| **Estado** | Approved → Prioritized |
| **Owner de producto** | \[Pendiente de validación — Ernesto actuó como decisor\] |
| **Owner técnico** | \[Pendiente por asignar\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Separar el editor del flujo específico de generación de cursos para que pueda abrirse y utilizarse como capacidad de edición independiente dentro del ecosistema SofLIA.

**Problema que resuelve:** La implementación actual mezcla el editor con el proceso de cursos y limita su reutilización por otros usuarios y flujos.

**Usuario:** Editor/creador de contenido SofLIA.

**Trigger:** El usuario necesita editar o ensamblar un video, independientemente de estar construyendo un curso.

**Precondiciones:** Usuario autenticado y acceso autorizado al módulo; assets disponibles.

**Flujo principal:** Abrir Editor → crear/abrir proyecto → incorporar assets → editar → preview → render/exportar. El acceso no debe depender de iniciar un flujo de curso.

**Resultado esperado:** El editor puede operar como módulo independiente sin romper el flujo de cursos existente.

**Edge cases:** Proyectos existentes embebidos; permisos; referencias a assets generados por otros módulos.

**Dependencias:** DEP-007; definición de límites del módulo y contratos con generación de assets/render.

&nbsp;

### **FR-002 — Paridad funcional con el video premium de referencia**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:13:09 / 01:25:51 |
| **Solicitado / identificado por** | Ernesto Hernández Martínez |
| **Evidence ID** | EV-021, EV-026 |
| **Issue relacionado** | ISSUE-010 |
| **Prioridad** | Must |
| **Estado** | Approved → Prioritized |
| **Owner de producto** | \[Pendiente de validación — Ernesto actuó como decisor\] |
| **Owner técnico** | \[Pendiente por asignar\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** El editor debe permitir producir, dentro de su flujo principal, un video equivalente al último video de referencia utilizado por SofLIA, incluyendo los elementos recurrentes necesarios para los primeros cursos.

**Problema que resuelve:** El video de referencia fue producido fuera del editor; todavía no existe evidencia de que el flujo interno alcance la calidad objetivo.

**Usuario:** Equipo de producción de contenido SofLIA.

**Trigger:** Se toma un proyecto de referencia y se intenta reproducir de extremo a extremo desde el editor.

**Precondiciones:** Contar con el video de referencia, sus assets originales y criterios de comparación.

**Flujo principal:** Reconstruir proyecto → aplicar edición → captions/texto → color/audio/transiciones requeridas → render → comparar contra referencia.

**Resultado esperado:** Existe evidencia verificable de paridad suficiente para producción de los primeros cursos.

**Edge cases:** Elementos deliberadamente fuera de alcance que requieran herramienta externa; diferencias atribuibles al asset fuente.

**Dependencias:** FR-006, FR-008, FR-009 y diagnóstico de BUG-001/BUG-002; referencia de aceptación aún por formalizar.

&nbsp;

### **FR-003 — Anidado / agrupación de elementos de timeline**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:29:24–00:30:42 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-002 |
| **Issue relacionado** | ISSUE-001 |
| **Prioridad** | Must |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending / Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Permitir seleccionar múltiples clips/capas relacionados y convertirlos en una unidad lógica editable, con posibilidad de entrar al grupo para modificar sus elementos internos.

**Problema que resuelve:** Timelines con múltiples capas se vuelven extensas, confusas y propensas a errores.

**Usuario:** Editor de video.

**Trigger:** El usuario selecciona dos o más elementos que forman una composición o sub-secuencia.

**Precondiciones:** Elementos existentes en timeline y compatibles con agrupación.

**Flujo principal:** Seleccionar elementos → “Anidar/Agrupar” → crear unidad → manipularla como un solo elemento → abrir unidad → editar internamente → volver a timeline principal.

**Resultado esperado:** La timeline principal permanece limpia y el grupo conserva sincronía/relaciones internas.

**Edge cases:** Elementos con duraciones diferentes; grupos dentro de grupos; eliminación de un asset; undo/redo.

**Dependencias:** Modelo de timeline y persistencia de secuencias; definición exacta de nesting.

&nbsp;

### **FR-004 — Vinculación de audio y video**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:30:42 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-003 |
| **Issue relacionado** | ISSUE-002 |
| **Prioridad** | Should |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Permitir vincular uno o varios clips de audio con un clip de video para que movimientos, recortes o desplazamientos que deban conservar sincronía se ejecuten coordinadamente.

**Problema que resuelve:** Mover audio o video por separado puede romper lip-sync, narración o sincronización con acciones.

**Usuario:** Editor de video.

**Trigger:** Usuario selecciona clips relacionados y ejecuta “Vincular”.

**Precondiciones:** Clips compatibles en timeline.

**Flujo principal:** Seleccionar → vincular → mover/recortar conforme a reglas → opción de desvincular.

**Resultado esperado:** La relación temporal se conserva y el usuario evita desincronizaciones accidentales.

**Edge cases:** Un audio vinculado a varios clips; trim asimétrico; bloqueo parcial; unlink.

**Dependencias:** Modelo de relaciones de timeline; reglas de trim y snapping.

&nbsp;

### **FR-005 — Transiciones reales entre clips**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:32:10 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-004 |
| **Issue relacionado** | ISSUE-003 |
| **Prioridad** | Should |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Implementar transiciones que operen sobre el final de un clip y el inicio del siguiente (por ejemplo, disolvencia), diferenciándolas de animaciones de entrada/salida de un solo clip.

**Problema que resuelve:** La funcionalidad actual no permite una transición compuesta entre dos clips.

**Usuario:** Editor de video.

**Trigger:** Dos clips adyacentes se solapan o comparten un punto de corte y el usuario aplica una transición.

**Precondiciones:** Dos clips compatibles y suficiente material de handles si la implementación lo requiere.

**Flujo principal:** Seleccionar unión → elegir transición → ajustar duración/parámetros → preview → render.

**Resultado esperado:** La transición afecta correctamente a ambos clips y coincide en preview/render.

**Edge cases:** Clips sin handles; duración mayor al material; audio asociado; transición en corte no contiguo.

**Dependencias:** Motor de composición/render.

&nbsp;

### **FR-006 — Corrección básica de color**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:33:41 / 01:14:58 |
| **Solicitado / identificado por** | Charlie; confirmación de necesidad mínima por Ernesto |
| **Evidence ID** | EV-005, EV-022 |
| **Issue relacionado** | ISSUE-004, ISSUE-017 |
| **Prioridad** | Must |
| **Estado** | Approved → Prioritized |
| **Owner de producto** | \[Pendiente de validación — Ernesto actuó como decisor\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Incorporar controles básicos de corrección de color por clip. La fuente menciona explícitamente saturación, contraste y brillo como mínimo; controles adicionales requieren definición de Product.

**Problema que resuelve:** Material de distintas fuentes presenta diferencias visibles que impiden una apariencia unificada/premium.

**Usuario:** Editor de video.

**Trigger:** Usuario selecciona un clip y abre controles de color.

**Precondiciones:** Clip de imagen/video en timeline.

**Flujo principal:** Seleccionar clip → ajustar parámetros → visualizar cambio en preview → reset/undo → render.

**Resultado esperado:** El usuario puede homogeneizar material sin salir del editor y los cambios se conservan fielmente en el render.

**Edge cases:** Clips HDR/SDR o espacios de color distintos; valores extremos; múltiples clips; reset.

**Dependencias:** Diagnóstico de color pipeline; BUG-001; definición de interpretación/espacio de color.

&nbsp;

### **FR-007 — Vista de referencia / comparación para color y composición**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:35:18 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-005 |
| **Issue relacionado** | ISSUE-017 |
| **Prioridad** | Could |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Permitir visualizar lado a lado el frame/proyecto actual y una imagen o frame de referencia para comparar color, posición y composición. La igualación automática de color se mantiene como mejora opcional separada.

**Problema que resuelve:** La homogeneización manual es difícil sin una referencia visible simultáneamente.

**Usuario:** Editor de video.

**Trigger:** Usuario activa modo de comparación y selecciona referencia.

**Precondiciones:** Referencia disponible.

**Flujo principal:** Abrir comparación → seleccionar referencia → ajustar clip → cerrar comparación.

**Resultado esperado:** El usuario puede comparar visualmente sin alterar el contenido final.

**Edge cases:** Diferentes aspect ratios; referencia externa; zoom independiente.

**Dependencias:** UI de preview; FR-006.

&nbsp;

### **FR-008 — Texto y captions nativos**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:41:05 / 01:13:09 |
| **Solicitado / identificado por** | Israel, Charlie y Ernesto |
| **Evidence ID** | EV-009, EV-021 |
| **Issue relacionado** | ISSUE-005, ISSUE-010 |
| **Prioridad** | Must |
| **Estado** | Approved → Prioritized |
| **Owner de producto** | \[Pendiente de validación — requisito ligado a referencia\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Permitir crear y editar capas de texto/captions directamente en el editor, incluyendo el estilo de captions transparentes requerido por el video de referencia.

**Problema que resuelve:** Hoy el texto no puede crearse nativamente y uno de los elementos faltantes para replicar el video de referencia son captions transparentes.

**Usuario:** Editor/creador de contenido.

**Trigger:** Usuario agrega texto/caption a un punto de timeline.

**Precondiciones:** Proyecto abierto.

**Flujo principal:** Agregar texto → editar contenido → posición/tamaño/estilo → duración → preview → render.

**Resultado esperado:** Texto/captions quedan integrados, editables y consistentes en render.

**Edge cases:** Fuentes no disponibles; line wrapping; safe areas; animaciones; captions largos.

**Dependencias:** Sistema de capas, tipografía, render y definición visual de captions.

&nbsp;

### **FR-009 — Edición básica de audio y presets de voz**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:36:40–00:49:40 |
| **Solicitado / identificado por** | guitarblueghost (Charlie); problema confirmado por Israel |
| **Evidence ID** | EV-006, EV-011, EV-012 |
| **Issue relacionado** | ISSUE-006, ISSUE-015 |
| **Prioridad** | Must |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending / audio SME input required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Incorporar herramientas básicas de audio suficientes para producción recurrente: fades, ajuste/limpieza básica de ruido y tratamiento/presets de voz. La especificación exacta de filtros y parámetros queda pendiente de validación con especialista de audio.

**Problema que resuelve:** Las voces pueden tener ruido, room tone o poca presencia y el usuario necesita resolver problemas comunes sin salir del editor.

**Usuario:** Editor/creador de contenido.

**Trigger:** Usuario selecciona un clip de audio.

**Precondiciones:** Audio en timeline.

**Flujo principal:** Seleccionar audio → aplicar ajuste/preset → preescuchar → modificar intensidad → render.

**Resultado esperado:** Problemas comunes se corrigen dentro del editor; problemas avanzados pueden enviarse a herramienta especializada.

**Edge cases:** Clipping; audio multicanal; ruido variable; voz ya procesada; múltiples presets apilados.

**Dependencias:** DEP-005; motor de audio; definición de presets y límites de primera versión.

&nbsp;

### **FR-010 — Presets reutilizables de efectos**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:36:40 / 01:07:24 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) / Israel Martínez Arias |
| **Evidence ID** | EV-006, EV-019 |
| **Issue relacionado** | ISSUE-006, ISSUE-012 |
| **Prioridad** | Should |
| **Estado** | Under Analysis — existe capacidad parcial de presets de timeline |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Extender el concepto existente de presets/plantillas para reutilizar configuraciones frecuentes de audio, video, texto o motion sin reconstruir manualmente parámetros.

**Problema que resuelve:** Repetir ajustes consume tiempo y genera inconsistencia.

**Usuario:** Editor de video.

**Trigger:** Usuario guarda un conjunto de parámetros o aplica uno existente.

**Precondiciones:** Efecto/ajuste compatible.

**Flujo principal:** Configurar → guardar preset → nombrar → reutilizar mediante selección/drag-drop → editar copia si procede.

**Resultado esperado:** Configuraciones repetitivas se aplican rápidamente de forma consistente.

**Edge cases:** Versionado de presets; compatibilidad entre tipos de asset; parámetros faltantes.

**Dependencias:** Arquitectura de efectos y sistema de presets actual.

&nbsp;

### **FR-011 — Control temporal de posición/tamaño mediante keyframes**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:37:50 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) / Israel Martínez Arias |
| **Evidence ID** | EV-007 |
| **Issue relacionado** | ISSUE-012 |
| **Prioridad** | Could |
| **Estado** | Partially Existing → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Completar un mecanismo de keyframes para cambiar posición, escala u otras propiedades a lo largo del tiempo.

**Problema que resuelve:** La edición de movimiento precisa requiere cambios temporales más allá de una transformación estática.

**Usuario:** Editor de video.

**Trigger:** Usuario define un valor de propiedad en tiempos distintos.

**Precondiciones:** Elemento transformable en timeline.

**Flujo principal:** Seleccionar propiedad → crear keyframes → modificar valores por tiempo → interpolar → preview.

**Resultado esperado:** El elemento cambia de forma predecible entre keyframes.

**Edge cases:** Interpolación; keyframes fuera de clip; cambios de duración; easing.

**Dependencias:** Estado actual parcial no documentado; motor de animación.

&nbsp;

### **FR-012 — Atajos de teclado de transporte**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:39:49 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-008 |
| **Issue relacionado** | ISSUE-013 |
| **Prioridad** | Could |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Habilitar atajos de teclado para operaciones frecuentes de reproducción, comenzando por play/pause (espacio propuesto por el SME).

**Problema que resuelve:** La interacción exclusivamente con mouse ralentiza edición repetitiva.

**Usuario:** Editor de video.

**Trigger:** Foco en editor y pulsación de shortcut.

**Precondiciones:** No existir conflicto con campo de texto activo u otro contexto de captura.

**Flujo principal:** Pulsar shortcut → ejecutar acción → mantener foco y estado.

**Resultado esperado:** Operaciones de transporte se ejecutan sin mover el cursor.

**Edge cases:** Campo de texto enfocado; accesibilidad; combinación de navegador/SO.

**Dependencias:** Mapa global de shortcuts y prevención de conflictos.

&nbsp;

### **FR-013 — Selector de calidad de preview**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 00:52:51–00:53:57 |
| **Solicitado / identificado por** | guitarblueghost (Charlie); validado como buena idea por Israel |
| **Evidence ID** | EV-013 |
| **Issue relacionado** | ISSUE-007 |
| **Prioridad** | Should |
| **Estado** | Identified → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Permitir reducir la calidad/resolución del preview para priorizar fluidez durante ensamblaje y edición, sin afectar la calidad del render final. El SME menciona 1/2, 1/4 y 1/8 como patrón de referencia; niveles definitivos pendientes.

**Problema que resuelve:** El preview puede retrasarse o reproducirse a saltos al procesar material pesado.

**Usuario:** Editor de video.

**Trigger:** Usuario cambia la calidad de preview o el sistema recomienda una opción reducida.

**Precondiciones:** Proyecto con material reproducible.

**Flujo principal:** Seleccionar calidad → preview usa representación reducida/proxy → editar → render final usa fuente/calidad configurada.

**Resultado esperado:** Mejora perceptible de fluidez sin degradar salida final.

**Edge cases:** Cambios de calidad durante playback; proxies no disponibles; 4K; efectos intensivos.

**Dependencias:** Arquitectura de preview/proxy/cache y métricas de performance.

&nbsp;

### **FR-014 — Plantillas de timeline adaptativas a assets**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:07:24–01:10:52 |
| **Solicitado / identificado por** | Israel Martínez Arias / guitarblueghost (Charlie) |
| **Evidence ID** | EV-019, EV-020 |
| **Issue relacionado** | \[No aplica — mejora sobre capacidad existente\] |
| **Prioridad** | Should |
| **Estado** | Partially Existing → Under Analysis |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Pending\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Conservar y ampliar la capacidad existente de extraer/reutilizar timelines como presets, procurando que assets reemplazados se adapten automáticamente a tamaño, proporción y parámetros esperados.

**Problema que resuelve:** La producción a granel requiere replicar estructuras sin reajustar manualmente cada asset.

**Usuario:** Equipo de producción de contenido.

**Trigger:** Usuario crea proyecto desde preset o sustituye un asset placeholder.

**Precondiciones:** Preset válido y asset compatible.

**Flujo principal:** Elegir preset → reemplazar/arrastrar asset → autoajuste según reglas → revisión → edición.

**Resultado esperado:** Se reduce drásticamente el trabajo repetitivo y se conserva consistencia visual.

**Edge cases:** Aspect ratios incompatibles; recorte vs letterbox; safe area; diferentes duraciones.

**Dependencias:** Sistema actual de presets y reglas de fit/fill.

&nbsp;

### **FR-015 — Manejo explícito de frame rate de secuencia y clips**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:04:30–01:07:24 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-018 |
| **Issue relacionado** | ISSUE-009 |
| **Prioridad** | Could |
| **Estado** | Deferred / Engineering Decision Required |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Definir y exponer reglas seguras para secuencias con material de diferentes frame rates, ya sea mediante conformado/interpolación automática o restricciones/validaciones al importar.

**Problema que resuelve:** Diferencias 24/25/30 fps podrían provocar stutter o cambios de velocidad; la causa actual no está confirmada.

**Usuario:** Editor de video.

**Trigger:** Se incorpora un clip cuyo frame rate difiere del proyecto/secuencia.

**Precondiciones:** Metadatos de media disponibles.

**Flujo principal:** Detectar diferencia → aplicar política definida o alertar → preview → render consistente.

**Resultado esperado:** No se introducen pausas/ralentización inesperadas por incompatibilidad temporal.

**Edge cases:** VFR; 23.976/29.97; audio sync; slow motion intencional.

**Dependencias:** Diagnóstico BUG-002; motor de render; definición de política técnica.

&nbsp;

### **FR-016 — Edición asistida por IA mediante selección de región e instrucción**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:20:13–01:22:50 |
| **Solicitado / identificado por** | Ernesto Hernández Martínez / Charlie |
| **Evidence ID** | EV-025 |
| **Issue relacionado** | ISSUE-016 |
| **Prioridad** | Could |
| **Estado** | Future Scope / Discovery |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Explorar edición donde el usuario selecciona visualmente una región/objeto del video y emite una instrucción para modificarlo mediante un modelo de IA.

**Problema que resuelve:** Ciertas ediciones/motion graphics son lentas y complejas en herramientas tradicionales.

**Usuario:** Editor creativo.

**Trigger:** Usuario selecciona región y describe el cambio.

**Precondiciones:** Modelo/proveedor compatible; permisos; archivo soportado.

**Flujo principal:** Seleccionar región → escribir instrucción → generar variante → comparar → aceptar/rechazar.

**Resultado esperado:** Ediciones complejas pueden realizarse con menor fricción.

**Edge cases:** Tracking temporal; identidad visual; artefactos; costo/latencia; derechos de assets.

**Dependencias:** DEP-006; evaluación de proveedores/modelos; gobernanza y costos.

&nbsp;

### **FR-017 — Motion graphics reutilizables / generación simplificada**

| Campo | Valor |
| ----- | ----- |
| **Fecha de origen** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp de origen** | 01:19:11 |
| **Solicitado / identificado por** | guitarblueghost (Charlie) |
| **Evidence ID** | EV-024 |
| **Issue relacionado** | ISSUE-016 |
| **Prioridad** | Could |
| **Estado** | Future Scope / Discovery |
| **Owner de producto** | \[Product Decision Required\] |
| **Owner técnico** | \[Engineering Decision Required\] |
| **Sprint / release objetivo** | \[Pendiente por definir\] |
| **Ticket de desarrollo** | \[Pendiente por crear\] |
| **Fecha objetivo** | \[Pendiente por definir\] |
| **Última actualización** | 2026-09-09 |
| **Fuente de última modificación** | MTG-2026-09-09-ENGINE-EDITOR-001 |

&nbsp;

**Descripción:** Evaluar una forma de incorporar motion graphics de alta calidad mediante templates paramétricos o generación por IA, evitando flujos pesados y bloqueo de herramientas tradicionales.

**Problema que resuelve:** Los motion graphics elevan calidad pero su edición puede ser lenta y frágil.

**Usuario:** Editor creativo.

**Trigger:** Necesidad de una animación reusable/personalizable.

**Precondiciones:** Template/modelo disponible.

**Flujo principal:** Elegir/generar motion → reemplazar parámetros/branding → preview → render.

**Resultado esperado:** Se eleva calidad visual con menor costo de operación.

**Edge cases:** Render pesado; branding; compatibilidad; modelos generativos inconsistentes.

**Dependencias:** FR-016; proveedor/modelos; motor de render.

# **14\. Non-Functional Requirements**

| ID | Fecha | Meeting | Timestamp | Evidence | Categoría | Requerimiento | Métrica verificable | Prioridad | Owner | Estado | Riesgo |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| NFR-001 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:01:33 | EV-017 | Fidelidad de color | Sin ajuste explícito del usuario, el pipeline de preview/render no debe introducir cambios visibles de color respecto del asset fuente. | \[Métrica por definir: delta de color/criterio de comparación\] | Must | \[Technical Owner pendiente\] | Under Analysis | El resultado puede verse no profesional y no reproducible. |
| NFR-002 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:52:51 / 01:04:30 | EV-013, EV-018 | Fidelidad temporal | El render final no debe introducir stutter, ralentización o pérdida/repetición de frames no solicitada. | \[Métrica por definir; prueba con clips de distintos fps\] | Must | \[Technical Owner pendiente\] | Under Analysis | Defectos visibles en entrega final. |
| NFR-003 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:52:51 | EV-013 | Performance de preview | La edición debe disponer de un modo de preview reducido que mejore la fluidez en proyectos pesados. | \[Objetivo de fps/latencia por definir\] | Should | \[Technical Owner pendiente\] | Identified | Edición lenta y experiencia frustrante. |
| NFR-004 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:52:51 | EV-013 | Calidad de render | Reducir calidad del preview no debe reducir la calidad del render/export final. | \[Métrica por definir: resolución/bitrate/codec objetivo\] | Must | \[Technical Owner pendiente\] | Identified | Salida degradada por optimizaciones de edición. |
| NFR-005 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:46:53 | EV-011 | Calidad de audio | El pipeline no debe agregar ruido, clipping o alteraciones no solicitadas; los presets deben producir resultados repetibles. | \[Métrica por definir: loudness/noise/clipping\] | Must | \[Technical Owner pendiente\] | Identified | Voces inconsistentes o poco profesionales. |
| NFR-006 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:24:13 | EV-026 | Calidad de producto | La primera etapa debe alcanzar un estándar “premium” operacionalizado mediante paridad con el video de referencia acordado. | Checklist de comparación \[Pendiente de definir\] | Must | Product \+ QA | Prioritized | El producto puede ser funcional pero no aceptable para clientes. |
| NFR-007 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:13:09 | EV-022 | Modularidad | El editor debe desacoplarse del flujo de cursos sin romper la integración existente. | Pruebas de acceso independiente \+ regresión de flujo de cursos | Must | \[Technical Owner pendiente\] | Prioritized | Acoplamiento limita evolución y reutilización. |
| NFR-008 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 00:49:40 / 01:16:30 | EV-012, EV-023 | Usabilidad / complejidad | El producto debe priorizar funciones de uso frecuente y evitar introducir complejidad profesional rara cuando una herramienta externa sea suficiente. | \[Métrica por definir: pruebas de tarea/UX\] | Should | Product/UX | Identified | Curva de aprendizaje y scope creep. |
| NFR-009 | 2026-09-09 | MTG-2026-09-09-ENGINE-EDITOR-001 | 01:01:33–01:07:24 | EV-017, EV-018 | Observabilidad técnica | Propuesto: registrar metadatos relevantes del pipeline (asset, fps, codec/espacio de color, transformaciones y render job) para diagnosticar desviaciones de calidad. | \[Engineering Decision Required\] | Should | \[Technical Owner pendiente\] | Proposed | Sin telemetría, bugs de render pueden ser difíciles de reproducir y cerrar. |

&nbsp;

# **15\. User Stories**

| ID | User Story | FR | Issue | Evidence | Prioridad | Estado | Owner | Ticket |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| US-001 | Como editor de contenido, quiero abrir el Editor fuera del flujo de cursos, para editar proyectos de video como una capacidad independiente. | FR-001 | ISSUE-011 | EV-022 | Must | Approved/Prioritized | \[PO pendiente\] | \[Pendiente\] |
| US-002 | Como equipo de producción, quiero reproducir el video premium de referencia desde el Editor, para validar que los primeros cursos pueden producirse en el flujo SofLIA. | FR-002 | ISSUE-010 | EV-021, EV-026 | Must | Approved/Prioritized | \[PO pendiente\] | \[Pendiente\] |
| US-003 | Como editor, quiero anidar varias capas en una sub-secuencia, para mantener la timeline legible y manipular una composición como una unidad. | FR-003 | ISSUE-001 | EV-002 | Must | Under Analysis | \[PO pendiente\] | \[Pendiente\] |
| US-004 | Como editor, quiero vincular audio y video, para evitar perder sincronización al mover clips. | FR-004 | ISSUE-002 | EV-003 | Should | Under Analysis | \[PO pendiente\] | \[Pendiente\] |
| US-005 | Como editor, quiero aplicar transiciones entre dos clips, para crear cambios visuales continuos y profesionales. | FR-005 | ISSUE-003 | EV-004 | Should | Under Analysis | \[PO pendiente\] | \[Pendiente\] |
| US-006 | Como editor, quiero ajustar brillo, contraste y saturación, para unificar visualmente material de distintas fuentes. | FR-006 | ISSUE-004 | EV-005, EV-022 | Must | Approved/Prioritized | \[PO pendiente\] | \[Pendiente\] |
| US-007 | Como editor, quiero crear texto y captions nativos, para producir el contenido requerido sin convertir texto en assets externos. | FR-008 | ISSUE-005 | EV-009, EV-021 | Must | Approved/Prioritized | \[PO pendiente\] | \[Pendiente\] |
| US-008 | Como editor, quiero aplicar correcciones de audio y presets de voz, para resolver problemas comunes sin salir del editor. | FR-009 | ISSUE-006, ISSUE-015 | EV-011, EV-012 | Must | Under Analysis | \[PO pendiente\] | \[Pendiente\] |
| US-009 | Como editor, quiero bajar temporalmente la calidad del preview, para trabajar con fluidez sin degradar el render final. | FR-013 | ISSUE-007 | EV-013 | Should | Under Analysis | \[PO pendiente\] | \[Pendiente\] |
| US-010 | Como editor, quiero crear proyectos desde templates que adapten los assets automáticamente, para reducir trabajo repetitivo. | FR-014 | — | EV-019 | Should | Partially Existing | \[PO pendiente\] | \[Pendiente\] |
| US-011 | Como editor, quiero que clips con distintos frame rates se manejen de forma segura, para evitar stutter o cambios de velocidad involuntarios. | FR-015 | ISSUE-009 | EV-018 | Could | Deferred | \[PO pendiente\] | \[Pendiente\] |
| US-012 | Como editor creativo, quiero seleccionar una región del video y pedir a la IA un cambio, para ejecutar ediciones complejas con menos pasos manuales. | FR-016 | ISSUE-016 | EV-025 | Could | Future/Discovery | \[PO pendiente\] | \[Pendiente\] |

&nbsp;

# **16\. Acceptance Criteria**

## **US-001 — FR-001**

* Given un usuario con permisos de edición, When accede al Editor sin iniciar un curso, Then puede crear o abrir un proyecto y completar el flujo de edición.  
* Given un curso existente que usa el Editor, When se desacopla el módulo, Then el flujo de cursos sigue funcionando sin regresiones funcionales.

## **US-002 — FR-002**

* Given el proyecto y assets del video de referencia, When el equipo lo reproduce íntegramente desde el Editor, Then el output cumple el checklist de paridad aprobado.  
* Given una capacidad fuera de alcance, When se requiere finishing externo, Then queda documentada como excepción y no como defecto oculto del Editor.

## **US-003 — FR-003**

* Given múltiples clips seleccionados, When el usuario ejecuta Anidar/Agrupar, Then aparece una unidad lógica en la timeline principal.  
* Given una unidad anidada, When el usuario la abre, Then puede editar sus elementos internos y volver a la timeline principal sin perder sincronía.

## **US-004 — FR-004**

* Given audio y video vinculados, When el usuario mueve el conjunto, Then ambos conservan su offset temporal definido.  
* Given clips vinculados, When el usuario ejecuta Desvincular, Then puede manipularlos independientemente.

## **US-005 — FR-005**

* Given dos clips adyacentes, When se aplica una transición soportada, Then el efecto modifica simultáneamente la salida/entrada de ambos clips.  
* Given una transición configurada, When se renderiza, Then el resultado coincide con el preview dentro de tolerancias definidas.

## **US-006 — FR-006**

* Given un clip sin ajustes, When el usuario modifica brillo/contraste/saturación, Then el preview cambia de forma inmediata o dentro de la latencia acordada.  
* Given ajustes de color guardados, When se renderiza, Then el output conserva esos ajustes y no introduce cambios adicionales no solicitados.

## **US-007 — FR-008**

* Given un proyecto abierto, When el usuario agrega texto/caption, Then puede editar contenido, posición, tamaño/estilo y duración.  
* Given captions del estilo de referencia, When se renderiza el proyecto, Then permanecen legibles y visualmente consistentes con el diseño aprobado.

## **US-008 — FR-009**

* Given un clip de voz, When se aplica un preset aprobado, Then se obtiene un resultado reproducible y el usuario puede comparar/bypassear el efecto.  
* Given un clip con problema fuera de las capacidades básicas definidas, When el usuario intenta corregirlo, Then el producto no promete funciones no soportadas y el flujo externo queda permitido.

## **US-009 — FR-013**

* Given un proyecto pesado, When el usuario selecciona una calidad de preview reducida, Then la reproducción usa esa representación sin cambiar el asset fuente.  
* Given preview reducido, When se ejecuta render final, Then la salida respeta la calidad final configurada y no hereda la reducción del preview.

## **US-010 — FR-014**

* Given un template válido, When el usuario reemplaza un placeholder por un asset compatible, Then el sistema aplica las reglas de tamaño/proporción definidas.  
* Given un asset con proporción incompatible, When se inserta, Then el sistema aplica o solicita una política de fit/fill/crop sin deformarlo silenciosamente.

## **US-011 — FR-015**

* Given un clip con fps distinto a la secuencia, When se importa, Then el sistema aplica la política aprobada o informa al usuario.  
* Given un clip mezclado en una secuencia, When se renderiza, Then no aparece stutter/ralentización no intencional atribuible al conformado.

## **US-012 — FR-016**

* Given una región seleccionable y modelo disponible, When el usuario selecciona una región y escribe una instrucción, Then obtiene una variante previa antes de aplicarla.  
* Given un resultado generado, When el usuario lo rechaza, Then el original permanece sin cambios.

# **17\. Bugs / Technical Issues**

## **BUG-001 — Cambio de color no solicitado en ensamble/render**

| Campo | Valor |
| ----- | ----- |
| **Fecha de detección** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp** | 01:01:33 |
| **Detectado por** | Israel Martínez Arias |
| **Build / ambiente** | \[Build no identificado\] / \[Ambiente no identificado\] |
| **Evidence ID** | EV-017 |
| **Severidad** | High |
| **Frecuencia** | \[No determinada\] |
| **Hipótesis de causa** | Hipótesis: proceso de render/compresión/interpretación de color. La fuente no confirma causa. |
| **¿Causa confirmada?** | No |
| **Owner** | \[Owner pendiente\] |
| **Ticket** | \[Pendiente\] |
| **Estado** | En análisis |
| **Fecha de resolución** | \[Pendiente\] |
| **Build de resolución** | \[Pendiente\] |
| **Validado por** | \[Pendiente\] |
| **Fecha de validación** | \[Pendiente\] |

&nbsp;

**Descripción:** El aspecto de color de un clip cambia entre estados sin que el usuario haya aplicado corrección de color.

**Comportamiento observado:** La cara de Israel aparece con tono distinto (“vivo” vs. “muerto”) en dos estados/outputs mostrados.

**Comportamiento esperado:** El mismo asset debe conservar apariencia de color salvo ajuste explícito.

**Pasos aproximados para reproducir:** 1\) Abrir/ensamblar asset de referencia. 2\) No aplicar corrección de color. 3\) Ejecutar render/ensamble. 4\) Comparar fuente, preview y salida.

**Impacto:** Compromete calidad/reproducibilidad del producto; ver severidad.

## **BUG-002 — Clip con reproducción saltada / aparente cámara lenta**

| Campo | Valor |
| ----- | ----- |
| **Fecha de detección** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp** | 00:52:51 |
| **Detectado por** | Charlie / Israel |
| **Build / ambiente** | \[Build no identificado\] / \[Ambiente no identificado\] |
| **Evidence ID** | EV-013, EV-014, EV-018 |
| **Severidad** | High |
| **Frecuencia** | \[No determinada\] |
| **Hipótesis de causa** | Hipótesis A: el video fuente ya venía así. Hipótesis B: mismatch de 24/25/30 fps. No confirmado. |
| **¿Causa confirmada?** | No |
| **Owner** | Israel debe verificar fuente; Technical Owner pendiente |
| **Ticket** | \[Pendiente\] |
| **Estado** | En análisis |
| **Fecha de resolución** | \[Pendiente\] |
| **Build de resolución** | \[Pendiente\] |
| **Validado por** | \[Pendiente\] |
| **Fecha de validación** | \[Pendiente\] |

&nbsp;

**Descripción:** Un clip de tren se reproduce con saltos o lentitud en el material mostrado.

**Comportamiento observado:** Movimiento percibido como saltado/cámara lenta.

**Comportamiento esperado:** El clip debe reproducirse con temporalidad equivalente a la fuente, salvo edición intencional.

**Pasos aproximados para reproducir:** 1\) Identificar asset exacto. 2\) Reproducir fuente fuera del editor. 3\) Importar/ensamblar. 4\) Comparar preview y render. 5\) Registrar fps fuente/secuencia.

**Impacto:** Compromete calidad/reproducibilidad del producto; ver severidad.

## **BUG-003 — Latencia de actualización del preview después de editar**

| Campo | Valor |
| ----- | ----- |
| **Fecha de detección** | 2026-09-09 |
| **Meeting ID** | MTG-2026-09-09-ENGINE-EDITOR-001 |
| **Timestamp** | 00:53:57 |
| **Detectado por** | Israel Martínez Arias |
| **Build / ambiente** | \[Build no identificado\] / \[Ambiente no identificado\] |
| **Evidence ID** | EV-013 |
| **Severidad** | Medium |
| **Frecuencia** | Tendencia observada por Israel |
| **Hipótesis de causa** | Decodificación/carga/render de preview; no confirmada. |
| **¿Causa confirmada?** | No |
| **Owner** | \[Owner pendiente\] |
| **Ticket** | \[Pendiente\] |
| **Estado** | Identificado |
| **Fecha de resolución** | \[Pendiente\] |
| **Build de resolución** | \[Pendiente\] |
| **Validado por** | \[Pendiente\] |
| **Fecha de validación** | \[Pendiente\] |

&nbsp;

**Descripción:** Después de una edición el preview puede tardar en cargar/reflejarla.

**Comportamiento observado:** Retraso perceptible antes de reproducir el cambio.

**Comportamiento esperado:** El preview debe actualizarse con una latencia aceptable o disponer de modo proxy/qualidad reducida.

**Pasos aproximados para reproducir:** 1\) Aplicar edición. 2\) Reproducir inmediatamente. 3\) Medir tiempo hasta actualización.

**Impacto:** Compromete calidad/reproducibilidad del producto; ver severidad.

# **18\. UX Requirements**

| ID | Tema | Requerimiento UX | Evidencia | Prioridad |
| :---: | ----- | ----- | ----- | ----- |
| UX-001 | Timeline legible | Agrupar/anidar composiciones para evitar “lasañas” de capas y permitir navegación a sub-secuencias. | EV-002 | Must candidate |
| UX-002 | Prevención de errores | Vincular clips relacionados para reducir desincronización accidental. | EV-003 | Should |
| UX-003 | Eficiencia de operación | Atajos de teclado para acciones frecuentes de transporte. | EV-008 | Could |
| UX-004 | Inspección visual | Conservar zoom de preview y guías/rejilla sin afectar el video final. | EV-008, EV-009 | Existing / protect in regression |
| UX-005 | Edición directa de texto | Texto/captions deben ser objetos editables nativos, no depender de generar PNG/PDF externos. | EV-009, EV-021 | Must |
| UX-006 | Control progresivo | Priorizar funciones frecuentes; mantener funciones raras/avanzadas fuera o bajo progressive disclosure para evitar complejidad innecesaria. | EV-012, EV-023 | Should |
| UX-007 | Preview vs output | El usuario debe entender claramente qué ajustes afectan sólo el preview y cuáles el render final. | EV-008, EV-013 | Must |
| UX-008 | Presets | Permitir aplicar configuraciones repetitivas con mínima interacción y sin reconstrucción manual. | EV-006, EV-019 | Should |

&nbsp;

# **19\. Decision Log**

| ID | Fecha | Timestamp | Decisión | Decidida por | Involucrados | Motivo | Alternativas | Impacto | Reqs | Estado | Superseded by |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| DEC-001 | 2026-09-09 | 00:33:41 | El editor se orientará a un nivel de calidad profesional/premium, no únicamente a un editor mínimo. | Ernesto Hernández Martínez | Charlie, Israel | Ernesto responde que buscan “algo muy fresa”, habilitando evaluación contra necesidades profesionales. | Editor básico / nivel CapCut no se selecciona como meta. | Eleva estándar de alcance y calidad. | FR-002, FR-006, FR-008, FR-009 | Vigente | — |
| DEC-002 | 2026-09-09 | 01:14:58 | La corrección básica de color es parte del mínimo necesario. | Ernesto Hernández Martínez | Charlie, Israel | Ernesto retoma explícitamente el tema de color como elemento mínimo requerido. | Dejar color para herramientas externas. | Prioriza FR-006. | FR-006 | Vigente | — |
| DEC-003 | 2026-09-09 | 01:13:09 | El editor debe desacoplarse del sistema de generación de cursos para poder utilizarse independientemente. | Ernesto Hernández Martínez | Israel, Charlie | La arquitectura actual mezcla responsabilidades y limita el uso del editor por otros perfiles. | Mantenerlo embebido en cursos. | Cambio de arquitectura/product boundary. | FR-001 | Vigente | — |
| DEC-004 | 2026-09-09 | 01:13:09–01:17:44 | SofLIA no intentará replicar Premiere completo; incorporará las funciones recurrentes indispensables, incluso si alguna es avanzada. | Ernesto Hernández Martínez | Charlie, Israel | Evitar scope creep y priorizar lo que se utiliza frecuentemente. | Clonar editor profesional completo. | Define MVP/V1 y out of scope. | Todos | Vigente | — |
| DEC-005 | 2026-09-09 | 01:13:09 | El último video de referencia debe poder producirse desde el editor; captions transparentes son un gap explícito. | Ernesto Hernández Martínez | Charlie, Israel | Se necesita una prueba concreta para validar que el editor sirve a los primeros cursos. | Seguir usando el video externo sin prueba interna. | Crea criterio de aceptación de producto. | FR-002, FR-008 | Vigente | — |
| DEC-006 | 2026-09-09 | 01:16:30–01:25:51 | En la transición se acepta un flujo híbrido: editor SofLIA para la mayor parte del trabajo y Premiere/u otra herramienta profesional para detalles avanzados que aún no existan. | Ernesto Hernández Martínez | Charlie | Permite operar con clientes antes de completar toda la madurez del editor. | Esperar a tener todo internamente antes de producir. | Reduce riesgo de salida al mercado, mantiene dependencia externa temporal. | FR-002; Out of Scope | Vigente | — |
| DEC-007 | 2026-09-09 | 01:24:13–01:25:51 | La entrega debe ser premium y la velocidad de producción debe mejorar sin sacrificar calidad. | Ernesto Hernández Martínez | Charlie, Israel | Diferenciador comercial y necesidad de primeros cursos/clientes. | Optimizar solo velocidad o solo calidad. | Eleva NFR-006 y Definition of Done. | FR-002; NFR-006 | Vigente | — |
| DEC-008 | 2026-09-09 | 01:20:13–01:22:50 | Se explorará una vía de edición AI-native donde capacidades de herramientas/modelos externos puedan incorporarse al flujo SofLIA. | Ernesto Hernández Martínez | Charlie, Israel | Reducir trabajo manual y aprovechar capacidades generativas actuales. | Mantener solo edición manual tradicional. | Abre discovery futuro; no constituye todavía una implementación aprobada. | FR-016, FR-017 | Vigente como dirección de discovery | — |

&nbsp;

# **20\. Action Items**

| ID | Acción | Fecha origen | Responsable | Fecha compromiso | Dependencia | Estado | Evidencia cierre | Nota |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| ACT-001 | Preparar informe de la conferencia/plataformas observadas y su comunicación. | 2026-09-09 | Ernesto Hernández Martínez | 2026-09-09 (dijo “hoy”) | Material grabado de la conferencia | Open | \[Pendiente\] | Contextual; no pertenece al backlog del Editor. |
| ACT-002 | Realizar, si hace falta, una sesión demostrativa específica para explicar visualmente el anidado/nesting y dejarla grabada. | 2026-09-09 | guitarblueghost (Charlie) | \[Fecha pendiente\] | Disponibilidad del equipo | Open | \[Pendiente\] | Compromiso ofrecido; ejecución no confirmada. |
| ACT-003 | Consultar con especialistas/ingenieros de audio y, cuando el editor esté listo, obtener una revisión de lo básico necesario para edición de audio decente. | 2026-09-09 | guitarblueghost (Charlie) | \[Fecha pendiente\] | Madurez del módulo de audio / disponibilidad de especialistas | Open | \[Pendiente\] | Israel responde afirmativamente a la propuesta. |
| ACT-004 | Verificar si el clip del tren ya presentaba stutter/lentitud en el archivo fuente o si apareció en el ensamble/render. | 2026-09-09 | Israel Martínez Arias | \[Fecha pendiente\] | Asset original y output final | Open | \[Pendiente\] | Acción explícita: “tengo que asegurar esa parte”. |
| ACT-005 | Completar las pruebas para reproducir dentro del editor el último video de referencia e identificar los gaps restantes. | 2026-09-09 | \[Owner pendiente — equipo de producto/ingeniería\] | \[Fecha pendiente\] | Video de referencia, captions, color, audio, render | In Progress | \[Pendiente\] | Ernesto indica que las pruebas estaban terminándose entre el día anterior y el día de la reunión. |
| ACT-006 | Desacoplar/descentralizar el módulo Editor respecto del flujo de generación de cursos. | 2026-09-09 | \[Technical Owner pendiente\] | \[Fecha pendiente\] | Arquitectura del producto | Open | \[Pendiente\] | Pedro es mencionado como trabajando en modificaciones, pero no se asigna explícitamente esta acción a él. |
| ACT-007 | Mostrar a Charlie 2–3 herramientas de IA específicas para video para aprender capacidades y evaluar cuáles reproducir/incorporar. | 2026-09-09 | Israel Martínez Arias | \[Fecha pendiente\] | Herramientas/modelos de IA; coordinación con Charlie | Open | \[Pendiente\] | Ernesto asigna a Israel la demostración mientras Pedro modifica el editor. |
| ACT-008 | Continuar la revisión del editor en la reunión del día siguiente. | 2026-09-09 | Equipo de la reunión | 2026-09-10 \[hora pendiente\] | Disponibilidad / convocatoria | Open | \[Pendiente\] | Se confirma que habrá reunión “mañana”; hora no indicada. |

&nbsp;

# **21\. Dependencies**

| ID | Descripción | Tipo | Reqs afectados | Owner | Estado | Bloqueante |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- |
| DEP-001 | Pipeline/servicio de render en nube mencionado en la reunión; el nombre del proveedor no es inequívoco en la transcripción. | Infraestructura | FR-002, FR-005, FR-006, FR-013, FR-015 | \[Owner pendiente\] | En análisis | Sí |
| DEP-002 | Calidad y parámetros de assets generados, especialmente avatar y voz. | Producto / tercero | FR-002, FR-006, FR-009 | \[Owner pendiente\] | Activo | Sí |
| DEP-003 | Premiere/u otro editor profesional como herramienta externa temporal para finishing avanzado. | Tercero / workflow | FR-002 | Charlie / equipo de producción | Activo | No |
| DEP-004 | SME de edición de video (Charlie) para especificar/validar funciones profesionales recurrentes. | Contenido / decisión | FR-003–FR-017 | Charlie | Activo | No |
| DEP-005 | Especialistas de audio para cerrar el alcance de filtros/presets básicos. | Contenido / tercero | FR-009 | Charlie coordina; owner técnico pendiente | Pendiente | No |
| DEP-006 | Modelos/herramientas de IA para edición de video. | Proveedor / ingeniería | FR-016, FR-017 | Israel / \[Technical Owner pendiente\] | Discovery | No |
| DEP-007 | Flujo actual de generación de cursos y contratos internos con assets/timeline/render. | Producto / ingeniería | FR-001 | \[Technical Owner pendiente\] | Activo | Sí |

&nbsp;

# **22\. Risks**

| ID | Riesgo | Fecha | Origen | Prob. | Impacto | Mitigación | Owner | Estado |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| RISK-001 | Que el editor sea funcional pero no alcance el estándar premium exigido para clientes. | 2026-09-09 | EV-020, EV-026 | High | High | Usar video de referencia como benchmark; DoD de calidad; validación con SME. | Product \+ QA | Open |
| RISK-002 | Cambios de color no intencionales en render pueden degradar entregables y dificultar confianza en el pipeline. | 2026-09-09 | BUG-001 | Medium | High | Crear prueba reproducible fuente→preview→render; inspeccionar color/codec/transformaciones; instrumentar pipeline. | \[Technical Owner pendiente\] | Open |
| RISK-003 | Manejo incorrecto de frame rate puede generar stutter, ralentización o desincronización. | 2026-09-09 | BUG-002 / EV-018 | Medium | High | Verificar fuente del clip; registrar fps; definir política de conformado/validación. | \[Technical Owner pendiente\] | Open |
| RISK-004 | Scope creep hacia un NLE completo tipo Premiere puede retrasar el producto. | 2026-09-09 | DEC-004 | High | High | Priorizar funciones recurrentes; mantener lista explícita de fuera de alcance; estimación Engineering por fase. | Product Owner | Mitigating |
| RISK-005 | Agregar muchas funciones profesionales sin jerarquía puede aumentar la curva de aprendizaje. | 2026-09-09 | EV-012, EV-023 | Medium | Medium | Progressive disclosure, presets y foco en tareas frecuentes; UX validation. | Product/UX | Open |
| RISK-006 | Dependencia temporal de Premiere puede crear doble flujo y retrabajo. | 2026-09-09 | DEC-006 | Medium | Medium | Definir punto de handoff y qué se resuelve dentro/fuera; reducir dependencia por releases. | Product \+ Production | Accepted temporarily |
| RISK-007 | Assets de origen deficientes (avatar/voz) pueden confundirse con defectos del editor. | 2026-09-09 | ISSUE-014, ISSUE-015 | High | High | Separar QA de asset source, editor y render; conservar originales y metadata. | Production \+ QA | Open |
| RISK-008 | Sin métricas de performance, color, audio y calidad, QA puede quedar subjetivo. | 2026-09-09 | NFR-001–NFR-006 | High | Medium | Definir métricas/benchmarks antes de cerrar tickets; usar Validation Records. | Product \+ Engineering \+ QA | Open |

&nbsp;

# **23\. Prioritization**

| ID | Capacidad | MoSCoW | Impacto | Esfuerzo | Impacto vs esfuerzo | Estado |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- |
| FR-001 | Editor desacoplado y utilizable como módulo independiente | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Approved → Prioritized |
| FR-002 | Paridad funcional con el video premium de referencia | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Approved → Prioritized |
| FR-003 | Anidado / agrupación de elementos de timeline | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-004 | Vinculación de audio y video | Should | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-005 | Transiciones reales entre clips | Should | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-006 | Corrección básica de color | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Approved → Prioritized |
| FR-007 | Vista de referencia / comparación para color y composición | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-008 | Texto y captions nativos | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Approved → Prioritized |
| FR-009 | Edición básica de audio y presets de voz | Must | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-010 | Presets reutilizables de efectos | Should | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Under Analysis — existe capacidad parcial de presets de timeline |
| FR-011 | Control temporal de posición/tamaño mediante keyframes | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Partially Existing → Under Analysis |
| FR-012 | Atajos de teclado de transporte | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-013 | Selector de calidad de preview | Should | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Identified → Under Analysis |
| FR-014 | Plantillas de timeline adaptativas a assets | Should | High | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Partially Existing → Under Analysis |
| FR-015 | Manejo explícito de frame rate de secuencia y clips | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Deferred / Engineering Decision Required |
| FR-016 | Edición asistida por IA mediante selección de región e instrucción | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Future Scope / Discovery |
| FR-017 | Motion graphics reutilizables / generación simplificada | Could | Medium | \[Engineering estimation required\] | \[Quadrant pending Engineering estimate\] | Future Scope / Discovery |

&nbsp;

| Nota de priorizaciónLa reunión aporta evidencia suficiente para impacto/prioridad de producto, pero no contiene sizing de Engineering. Por ello no se inventa el cuadrante de esfuerzo. |
| :---- |

&nbsp;

# **24\. MVP Scope**

* FR-001 — Editor independiente/desacoplado.  
* FR-002 — Paridad con video premium de referencia como gate de aceptación.  
* FR-006 — Corrección básica de color (mínimo explícito: saturación, contraste, brillo).  
* FR-008 — Texto/captions nativos, incluyendo el estilo requerido por la referencia.  
* FR-009 — Audio básico suficiente para problemas recurrentes, especificación final pendiente de SME de audio.  
* Diagnóstico y cierre de BUG-001 (color) y BUG-002 (stutter/fps) antes de declarar pipeline estable.  
* FR-003 — Nesting como candidato Must por frecuencia/impacto expresado por el SME; aprobación formal pendiente.  
* FR-013 — Preview reducido como candidato de performance para hacer viable la edición de material pesado.

# **25\. V1 Scope**

* FR-004 — Vinculación audio/video.  
* FR-005 — Transiciones reales de dos clips.  
* FR-010 — Presets reutilizables de efectos.  
* FR-012 — Atajos de teclado.  
* FR-014 — Templates adaptativos a assets.  
* FR-007 — Vista de referencia/compare si Product la prioriza.  
* FR-011 — Keyframes completos si se confirma gap de uso frecuente.

# **26\. Future Scope**

* FR-015 — Manejo avanzado/expreso de frame rate, después de diagnóstico del bug y decisión de arquitectura.  
* FR-016 — Edición AI-native por selección de región \+ prompt.  
* FR-017 — Motion graphics paramétricos o generados por IA.  
* Igualación automática de color a referencia, si se valida valor frente a corrección manual básica.  
* Foley y finishing detallado dentro del editor, sólo si se demuestra frecuencia suficiente.

# **27\. Out of Scope**

| Categoría | Primera etapa |
| ----- | ----- |
| Capacidades esenciales | Sí: producir el flujo recurrente de SofLIA con texto, color, audio, timeline, preview/render confiable y benchmark premium. |
| Capacidades deseables | Transiciones avanzadas, presets extensos, compare view, shortcuts y motion adicional según priorización. |
| Capacidades profesionales avanzadas | No se pretende replicar Premiere/Final Cut/Pro Tools completos. Corrección de color cinematográfica, audio especializado y finishing raro pueden seguir externos. |
| Capacidades externas temporales | Premiere u otro editor profesional para detalles que el Editor SofLIA todavía no cubra. |
| IA avanzada | Edición generativa por región/prompt y motion graphics generativos quedan en discovery/futuro; no son requisito de MVP aprobado. |

&nbsp;

# **28\. Technical Considerations**

| Tema | Qué necesita el producto | Posible implicación técnica | Clasificación |
| :---: | ----- | ----- | ----- |
| Decoupling | Editor independiente, sin romper cursos. | Extraer límites de módulo, contratos de proyecto/assets/render, permisos y navegación. | Confirmed need; Engineering Decision Required |
| Color fidelity | Sin cambios no solicitados. | Auditar espacio de color, codec, transcodificación, render service y browser decode. | Need confirmed; cause hypothesis |
| Frame rate | Sin stutter/slowdown involuntario. | Detectar fps/VFR, definir sequence timebase y política de conformado/interpolación/rechazo. | Engineering Decision Required |
| Preview performance | Preview fluido con opción de menor calidad. | Proxy/cache/transcode/streaming de preview; niveles y umbrales por definir. | Proposed implementation |
| Audio | Correcciones básicas y presets. | DSP en cliente/servidor; cadena exacta pendiente de SME; conservar original/bypass. | Product need confirmed; implementation TBD |
| Nesting | Sub-secuencias editables. | Modelo de timeline jerárquico, duración derivada, referencias y undo/redo. | Engineering Decision Required |
| Transitions | Operar sobre dos clips. | Handles, overlap/compositor y consistencia preview/render. | Engineering Decision Required |
| Observability | Diagnóstico reproducible de quality bugs. | Logs de job, fingerprints de assets y metadata técnica. | Proposed — Engineering Decision Required |
| AI editing | Selección visual \+ prompt. | Segmentación/tracking/model provider/cost/latency/versioning. | Future hypothesis/discovery |

&nbsp;

# **29\. Open Questions**

| ID | Pregunta | Fecha | Origen / timestamp | Responsable | Reqs | Fecha requerida | Estado | Respuesta | Decisión resultante |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| OQ-001 | ¿Quién es formalmente Product Owner y quién Technical Owner del Editor? | 2026-09-09 | Meeting Record | \[Owner pendiente\] | Todos | Antes de Ready for Development | Open | \[Pendiente\] | — |
| OQ-002 | ¿Qué build/commit y ambiente exacto se evaluó en la reunión? | 2026-09-09 | 00:39:49 | \[Technical Owner pendiente\] | BUG-001–003 | Antes de reproducir bugs | Open | \[Pendiente\] | — |
| OQ-003 | ¿Cuál es la causa real del cambio de color no solicitado? | 2026-09-09 | 01:01:33 | \[Technical Owner pendiente\] | FR-006, BUG-001, NFR-001 | Antes de cerrar FR-006/BUG-001 | Open | \[Pendiente\] | — |
| OQ-004 | ¿El clip del tren ya venía con stutter o el defecto aparece en preview/render? | 2026-09-09 | 00:55:13 | Israel Martínez Arias | BUG-002 | Próxima revisión | Open | \[Pendiente\] | — |
| OQ-005 | ¿Cómo maneja hoy el editor clips 23.976/24/25/29.97/30 fps y VFR? | 2026-09-09 | 01:04:30 | \[Technical Owner pendiente\] | FR-015, BUG-002 | Antes de decisión FR-015 | Open | \[Pendiente\] | — |
| OQ-006 | ¿Cuáles transiciones de dos clips son imprescindibles para primera etapa? | 2026-09-09 | 00:32:10 | Product \+ Charlie | FR-005 | Refinement | Open | \[Pendiente\] | — |
| OQ-007 | Además de saturación, contraste y brillo, ¿qué controles de color entran en MVP? | 2026-09-09 | 00:33:41 | Product \+ Charlie | FR-006 | Refinement | Open | \[Pendiente\] | — |
| OQ-008 | ¿Qué cadena mínima de audio y presets se aprueba tras revisión con especialistas? | 2026-09-09 | 00:48:18 | Charlie \+ Product \+ Engineering | FR-009 | Antes de desarrollo audio | Open | \[Pendiente\] | — |
| OQ-009 | ¿Qué niveles de preview y qué objetivo de fluidez/latencia se consideran aceptables? | 2026-09-09 | 00:52:51 | Product \+ Engineering | FR-013, NFR-003 | Refinement | Open | \[Pendiente\] | — |
| OQ-010 | ¿Qué comportamiento/estilo exacto deben tener los captions transparentes del video de referencia? | 2026-09-09 | 01:13:09 | Product/Design | FR-008, FR-002 | Antes de implementación FR-008 | Open | \[Pendiente\] | — |
| OQ-011 | ¿Cuál es el boundary técnico del Editor independiente y qué APIs/contratos conserva con Engine? | 2026-09-09 | 01:13:09 | Engineering | FR-001 | Antes de implementación FR-001 | Open | \[Pendiente\] | — |
| OQ-012 | ¿Cuál es el checklist objetivo de paridad contra el último video de referencia? | 2026-09-09 | 01:24:13 | Product \+ Charlie \+ QA | FR-002, NFR-006 | Antes de QA de primera etapa | Open | \[Pendiente\] | — |
| OQ-013 | ¿Cuáles funciones avanzadas son de uso recurrente y deben entrar pese a no ser “básicas”? | 2026-09-09 | 01:17:44 | Product \+ Charlie | MVP/V1 | Roadmap refinement | Open | \[Pendiente\] | — |
| OQ-014 | ¿Cuál es el proveedor/servicio de render exacto, y qué transformaciones realiza sobre codec, color, resolución y fps? | 2026-09-09 | 01:01:33 | Engineering | BUG-001, BUG-002, DEP-001 | Diagnóstico inmediato | Open | \[Pendiente\] | — |
| OQ-015 | ¿Qué capacidades de keyframes/motion existen hoy realmente y cuáles faltan? | 2026-09-09 | 00:37:50 | Engineering \+ Product | FR-011 | Refinement | Open | \[Pendiente\] | — |
| OQ-016 | ¿El sistema actual de presets ya autoajusta assets a proporción/tamaño o sólo replica la timeline? | 2026-09-09 | 01:07:24 | Engineering \+ Israel | FR-014 | Refinement | Open | \[Pendiente\] | — |

&nbsp;

# **30\. Requirement Traceability Matrix**

| Problema | Evidencia | Req | User Story | Decisión | Ticket | Sprint | Build | Prueba | Estado |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| ISSUE-011 | EV-022 | FR-001 | US-001 | DEC-003 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized |
| ISSUE-010 | EV-021, EV-026 | FR-002 | US-002 | DEC-005/007 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized |
| ISSUE-001 | EV-002 | FR-003 | US-003 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-002 | EV-003 | FR-004 | US-004 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-003 | EV-004 | FR-005 | US-005 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-004 / ISSUE-008 | EV-005, EV-022 | FR-006 | US-006 | DEC-002 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized |
| ISSUE-017 | EV-005 | FR-007 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-005 / ISSUE-010 | EV-009, EV-021 | FR-008 | US-007 | DEC-005 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized |
| ISSUE-006 / ISSUE-015 | EV-006, EV-011, EV-012 | FR-009 | US-008 | DEC-004 (scope) | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-006 | EV-006, EV-019 | FR-010 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Under Analysis — existe capacidad parcial de presets de timeline |
| ISSUE-012 | EV-007 | FR-011 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Partially Existing → Under Analysis |
| ISSUE-013 | EV-008 | FR-012 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| ISSUE-007 | EV-013 | FR-013 | US-009 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis |
| — | EV-019, EV-020 | FR-014 | US-010 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Partially Existing → Under Analysis |
| ISSUE-009 / BUG-002 | EV-018 | FR-015 | US-011 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Deferred / Engineering Decision Required |
| ISSUE-016 | EV-025 | FR-016 | US-012 | DEC-008 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Future Scope / Discovery |
| ISSUE-016 | EV-024 | FR-017 | \[Pendiente\] | DEC-008 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | Future Scope / Discovery |

&nbsp;

# **31\. Development Tracking**

| ID | Requerimiento | Owner | Prioridad | Ticket | Sprint | Estado | Bloqueador | Fecha objetivo | Últ. actualización |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| FR-001 | Editor desacoplado y utilizable como módulo independiente | \[Pendiente por asignar\] | Must | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-002 | Paridad funcional con el video premium de referencia | \[Pendiente por asignar\] | Must | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-003 | Anidado / agrupación de elementos de timeline | \[Pending / Engineering Decision Required\] | Must | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-004 | Vinculación de audio y video | \[Pending\] | Should | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-005 | Transiciones reales entre clips | \[Pending\] | Should | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-006 | Corrección básica de color | \[Pending\] | Must | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-007 | Vista de referencia / comparación para color y composición | \[Pending\] | Could | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-008 | Texto y captions nativos | \[Pending\] | Must | \[Pendiente\] | \[Pendiente\] | Approved → Prioritized | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-009 | Edición básica de audio y presets de voz | \[Pending / audio SME input required\] | Must | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-010 | Presets reutilizables de efectos | \[Pending\] | Should | \[Pendiente\] | \[Pendiente\] | Under Analysis — existe capacidad parcial de presets de timeline | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-011 | Control temporal de posición/tamaño mediante keyframes | \[Engineering Decision Required\] | Could | \[Pendiente\] | \[Pendiente\] | Partially Existing → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-012 | Atajos de teclado de transporte | \[Pending\] | Could | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-013 | Selector de calidad de preview | \[Engineering Decision Required\] | Should | \[Pendiente\] | \[Pendiente\] | Identified → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-014 | Plantillas de timeline adaptativas a assets | \[Pending\] | Should | \[Pendiente\] | \[Pendiente\] | Partially Existing → Under Analysis | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-015 | Manejo explícito de frame rate de secuencia y clips | \[Engineering Decision Required\] | Could | \[Pendiente\] | \[Pendiente\] | Deferred / Engineering Decision Required | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-016 | Edición asistida por IA mediante selección de región e instrucción | \[Engineering Decision Required\] | Could | \[Pendiente\] | \[Pendiente\] | Future Scope / Discovery | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |
| FR-017 | Motion graphics reutilizables / generación simplificada | \[Engineering Decision Required\] | Could | \[Pendiente\] | \[Pendiente\] | Future Scope / Discovery | \[Ver OQ/DEP relacionado\] | \[Pendiente\] | 2026-09-09 |

&nbsp;

# **32\. Definition of Done**

## **Funcionalidad**

* Implementación cumple FR y Acceptance Criteria aprobados.  
* No existen gaps conocidos ocultos; excepciones se registran como Out of Scope o deuda.  
* Undo/redo, persistencia y reapertura se validan cuando apliquen.

## **UX**

* Flujo es ejecutable por usuario objetivo sin workaround no documentado.  
* Shortcuts/controles no interfieren con navegación, texto o navegador.  
* Estados de preview vs render son comprensibles.

## **Calidad visual**

* No hay cambios de color, escala, aspect ratio o temporalidad no solicitados.  
* Output se compara con benchmark/reference cuando aplique.  
* Texto/captions son legibles y respetan diseño aprobado.

## **Audio**

* No se introduce clipping/ruido por el pipeline.  
* Presets aprobados producen resultado repetible y reversible/bypassable.

## **Render**

* Preview y render son funcionalmente consistentes.  
* Calidad de preview reducida no degrada salida final.  
* Job de render conserva metadata/diagnóstico suficiente para investigar fallos.

## **Performance**

* Se cumplen umbrales acordados de latencia/fps \[pendientes de definir\].  
* Proyectos benchmark pueden editarse sin bloqueos críticos.

## **QA**

* Casos positivos, edge cases y regresión ejecutados.  
* BUG relacionados cerrados o explícitamente aceptados/diferidos con owner.  
* Evidencia adjunta al ticket/Validation Record.

## **Documentación**

* PRD, ticket y changelog reflejan cualquier desviación aprobada.  
* Comportamientos nuevos y limitaciones se documentan para usuarios/soporte.

## **Observabilidad**

* Para fallos de render existe identificación de job/build/asset y metadata técnica suficiente \[si NFR-009 se aprueba\].

## **Validación de usuario**

* SME/Product ejecutan criterios de aceptación y registran Pass/Fail.  
* La funcionalidad sólo pasa a Done después de aceptación, no al terminar código.

| Cadena de cierre obligatoriaImplementación → prueba → evidencia → validación de usuario/producto → aceptación → Done. |
| :---- |

&nbsp;

# **33\. Validation Records**

No existen requerimientos cerrados en la fuente. Se deja el registro preparado para completar durante QA/User Validation.

| Requirement ID | Ticket | Build | Ambiente | Fecha prueba | Probado por | AC ejecutados | Resultado | Evidencia | Fecha aceptación | Aceptado por |
| :---: | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| FR-001 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-002 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-003 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-006 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-008 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-009 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |
| FR-013 | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] | \[Pendiente\] |

&nbsp;

# **34\. Recommended Next Sprint / Development Sequence**

La secuencia siguiente es una recomendación de Product basada en riesgo y dependencia. No sustituye estimación de Engineering.

| Secuencia | Trabajo | Prioridad | Racional |
| :---: | ----- | ----- | ----- |
| 0\. Baseline & reproducibility | Congelar build/ambiente evaluado; reunir video de referencia y assets originales; crear caso reproducible para BUG-001/002; registrar metadata de fuente/sequence/render. | Must | Reduce riesgo de construir sobre un pipeline no confiable. |
| 1\. Quality gate | Cerrar diagnóstico de color shift y stutter; definir checklist de paridad con referencia. | Must | NFR/bugs bloqueantes para calidad premium. |
| 2\. MVP content controls | FR-006 color \+ FR-008 texto/captions \+ alcance aprobado FR-009 audio. | Must | Gaps explícitos para primeros cursos y benchmark. |
| 3\. Timeline productivity | FR-003 nesting; evaluar FR-004 linking y FR-005 true transitions. | Must/Should | Reduce complejidad operativa y eleva calidad. |
| 4\. Preview performance | FR-013 calidad de preview \+ medición NFR-003/004. | Should | Facilita proyectos pesados sin comprometer render. |
| 5\. Modularization | FR-001 desacoplar Editor, en paralelo o después del baseline según arquitectura. | Must | Habilita uso independiente y evita deuda estructural. |
| 6\. Template acceleration | FR-010/014 presets y templates adaptativos. | Should | Captura ventaja de velocidad ya reconocida por el SME. |
| 7\. V1 polish | Shortcuts, keyframes, compare view y paquete de transiciones según uso real. | Could/Should | Mejora productividad/quality sin bloquear MVP. |
| 8\. Future discovery | FR-016/017 AI editing \+ motion graphics; FR-015 según resultados de bug/fps. | Future | Evita mezclar discovery avanzado con estabilización del editor. |

&nbsp;

## **Backlog inicial sugerido para creación de tickets**

* ENG-DISCOVERY: Reproducir BUG-001 color shift con comparación source/preview/render.  
* ENG-DISCOVERY: Reproducir BUG-002 stutter y validar fps de fuente/secuencia.  
* PRODUCT/QA: Formalizar benchmark del último video y checklist de paridad.  
* FEATURE: Basic Color Controls (FR-006).  
* FEATURE: Native Text/Captions (FR-008).  
* SPIKE \+ FEATURE: Basic Audio Post \+ Presets (FR-009).  
* FEATURE: Nested Sequences/Groups (FR-003), sujeto a aprobación final.  
* FEATURE: Preview Quality Selector (FR-013).  
* ARCH: Decouple Editor from Course Generation (FR-001).

Los nombres anteriores son títulos de backlog sugeridos, no tickets existentes. Deben convertirse en IDs reales del sistema DevOps una vez creados.

# **35\. PRD Change Log**

| Versión | Fecha | Cambio | Motivo | Autor | Requerimientos afectados |
| :---: | ----- | ----- | ----- | ----- | ----- |
| v0.1 | 2026-09-09 | PRD generado a partir de reunión; se crean Meeting Record, Evidence Register, Issues, FR/NFR, Stories, Decisions, Actions, Bugs, Dependencies, Risks, Open Questions y Traceability Matrix. | Convertir la revisión del Editor en especificación auditable y ejecutable. | ChatGPT — basado exclusivamente en la transcripción proporcionada | FR-001–FR-017 / NFR-001–NFR-009 |

&nbsp;

# **Appendix A — Functional Candidate Inventory by Domain**

| Dominio | Candidatos | Estado actual | Horizonte |
| :---: | ----- | ----- | ----- |
| Timeline & Editing | Nesting; linking; templates adaptativos; keyframes | Parcial/Faltante | MVP/V1 |
| Audio | Fades; limpieza básica; voice presets; audio independiente | Faltante/insuficiente | MVP |
| Video | Transformaciones; mixed-fps handling | Parcial / no confirmado | V1/Futuro |
| Color | Brillo, contraste, saturación; compare/match | Faltante | MVP / V1 |
| Preview | Zoom y grid existentes; quality selector faltante | Parcial | MVP/V1 |
| Text | Texto/captions nativos; captions transparentes | Faltante | MVP |
| Transitions | Transiciones de dos clips | Faltante | V1; priorización por Product |
| Motion Graphics | Templates/motion reutilizable | Faltante/externo | Futuro |
| Presets / Templates | Timeline presets existentes; ampliar a effects/audio/text | Parcial | V1 |
| Asset Management | Generación de assets valorada; calidad de avatar/voz requiere control | Existente \+ quality gap | MVP quality |
| Rendering | Cloud render; color/fps fidelity en análisis | Existente con bugs | MVP blocker |
| Performance | Preview load delay; proxy/quality selector | Gap | MVP/V1 |
| AI-assisted Editing | Selección de región \+ prompt; generation | Discovery | Futuro |
| UX / Keyboard Shortcuts | Space/play-pause y otros frecuentes | Faltante | V1 |
| Integraciones externas | Premiere como finishing temporal; modelos IA para discovery | Workflow externo | Temporal/Futuro |

&nbsp;

# **Appendix B — Source Interpretation Rules**

* “Hecho observado” sólo cuando la transcripción muestra/afirma un comportamiento concreto.  
* “Decisión” sólo cuando un participante con autoridad de facto en la reunión establece explícitamente una dirección; el rol formal sigue pendiente si no está en la fuente.  
* Las recomendaciones de Charlie se registran como requirements candidatos o Under Analysis salvo cuando Ernesto las convierte explícitamente en mínimo/objetivo.  
* Las causas técnicas sugeridas (compresión, frame rate, interpretación de color) se conservan como hipótesis hasta reproducirse.  
* Los términos que parecen errores de transcripción (nombres de proveedor, room tone, captions, etc.) no se normalizan como nombres propios definitivos sin validación.  
* Los datos inferidos del nombre de archivo (12:02 CST) se etiquetan como inferidos y no como timestamp confirmado del meeting system.