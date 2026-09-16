# PRD — Editor de video de SofLIA Engine

- **Producto:** SofLIA Engine / Courseforge
- **Módulo:** Editor y ensamblador de video para producción de cursos y piezas corporativas
- **Fuente analizada:** `SofLIAEngine-Editor_ 2026_09_09 12_02 CST-Notas de Gemini.md`
- **Fecha de la reunión:** 9 de septiembre de 2026
- **Versión del PRD:** 0.1
- **Estado del documento:** Ready for Product Review
- **Nivel general de confianza:** Medio
- **Alcance temporal identificado:** MVP, V1 y Futuro; el calendario no fue definido
- **Corte del estado actual:** lo demostrado o declarado durante la reunión. El repositorio se usa sólo como contraste técnico posterior y no sustituye la evidencia de la sesión.
- **Supuestos principales:** `guitarblueghost` corresponde a Charlie; el “último video entregado” es un artefacto de referencia accesible al equipo, aunque no fue adjuntado; “editor fresa” y “premium” expresan una aspiración de calidad, no métricas; “descentralizar” se interpreta como permitir uso fuera del flujo de generación de cursos, sujeto a validación de arquitectura y permisos.

## Registro de evidencia clave

| Ref. | Categoría | Timestamp y participante | Evidencia breve | Interpretación | Confianza |
|---|---|---|---|---|---|
| EVD-001 | CONTEXTO | [00:27:06 — Israel Martínez Arias] | Se inicia la exploración del editor para evaluarlo y generar recomendaciones. | La sesión sustantiva es una revisión funcional y de UX. | Alta |
| EVD-002 | HECHO OBSERVADO | [00:27:06 — guitarblueghost / Israel Martínez Arias] | Se identifica timeline por capas, preview y pistas de audio y video separadas. | Hay un editor básico operativo con composición multicapa. | Alta |
| EVD-003 | NECESIDAD EXPRESADA | [00:29:24–00:30:42 — guitarblueghost] | Se pide anidar o agrupar capas para reducir complejidad visual. | La edición de composiciones complejas necesita agrupación jerárquica. | Alta |
| EVD-004 | NECESIDAD EXPRESADA | [00:30:42 — guitarblueghost] | Se propone vincular audio y video para conservar sincronía al moverlos. | Hace falta una relación temporal protegida entre clips. | Alta |
| EVD-005 | HECHO OBSERVADO | [00:30:42–00:32:10 — guitarblueghost / Israel Martínez Arias] | Los controles existentes actúan como entradas/salidas sobre un clip, no como transición entre dos clips. | La capacidad mostrada no cubre transiciones cross-clip reales. | Alta |
| EVD-006 | DECISIÓN TOMADA | [00:33:41–00:35:18; 01:14:58 — Ernesto Hernández Martínez / guitarblueghost] | Se declara que el editor busca un nivel alto y que la corrección de color mínima es indispensable. | Debe incorporarse ajuste básico de color; su profundidad profesional no está definida. | Alta |
| EVD-007 | NECESIDAD EXPRESADA | [00:36:40–00:37:50; 00:46:53–00:51:19 — guitarblueghost / Israel Martínez Arias] | Se requieren ajustes básicos de audio, fades y presets; se reportan voz opaca, ruido y falta de presencia. | El flujo necesita corrección suficiente para problemas recurrentes, no una DAW completa. | Alta |
| EVD-008 | HECHO OBSERVADO | [00:39:49–00:42:40 — guitarblueghost / Israel Martínez Arias] | El zoom del preview y la rejilla existen; no se encontró creación nativa de texto. | Hay ayudas de inspección/alineación, pero el texto depende de assets externos o no está disponible. | Media |
| EVD-009 | NECESIDAD EXPRESADA | [00:39:49 — guitarblueghost] | Se solicita controlar play/pause mediante teclado. | Los comandos frecuentes deben ser más eficientes. | Alta |
| EVD-010 | NECESIDAD EXPRESADA | [00:42:40; 00:56:33 — guitarblueghost] | Se considera importante agregar texto dentro del editor. | Texto y captions son una brecha funcional; el alcance tipográfico no se definió. | Alta |
| EVD-011 | HECHO OBSERVADO | [00:42:40–00:45:35 — guitarblueghost / Israel Martínez Arias] | Un avatar se percibe opaco y desenfocado; se atribuye parcialmente al material base. | Existe una brecha visual, pero la causa no fue aislada. | Media |
| EVD-012 | BUG SOSPECHADO | [00:51:19–00:55:13 — guitarblueghost / Israel Martínez Arias] | Un clip de tren se ve lento o entrecortado; no se confirma si el original ya era así. | Requiere comparación source-preview-render antes de declararlo defecto. | Baja |
| EVD-013 | NECESIDAD EXPRESADA | [00:52:51–00:53:57 — guitarblueghost / Israel Martínez Arias] | Se propone preview a menor resolución por retrasos al cargar ediciones. | Debe poderse priorizar fluidez del preview sin degradar el render final. | Alta |
| EVD-014 | HIPÓTESIS TÉCNICA | [01:01:33–01:05:50 — Israel Martínez Arias / guitarblueghost] | Se sugieren compresión cloud, interpretación de color o mezcla de FPS como causas de cambios visuales o stutter. | Son líneas de investigación, no causas comprobadas. | Alta |
| EVD-015 | HECHO OBSERVADO | [01:07:24–01:09:13 — Israel Martínez Arias] | Se declara que una timeline puede extraerse y reutilizarse como preset. | Hay una capacidad de plantillas/presets según declaración, no validada en la demo transcrita. | Media |
| EVD-016 | CONTRADICCIÓN | [01:09:13–01:13:09 — guitarblueghost / Ernesto Hernández Martínez] | Se asumió que videos previos se hicieron en el editor; Ernesto aclara que el último no se produjo allí. | La calidad del editor no puede inferirse de ese video; éste pasa a ser benchmark objetivo. | Alta |
| EVD-017 | DECISIÓN TOMADA | [01:13:09–01:17:44 — Ernesto Hernández Martínez] | Se decide descentralizar el módulo, no competir con Premiere e incorporar funciones usadas recurrentemente. | La estrategia es un editor enfocado, reusable y ampliable, con herramientas externas para casos excepcionales. | Alta |
| EVD-018 | RECOMENDACIÓN | [01:16:30; 01:25:51 — guitarblueghost / Ernesto Hernández Martínez] | En la etapa inicial se plantea un flujo híbrido con afinación en Premiere. | Workaround transitorio aceptado; no equivale a integración técnica confirmada. | Alta |
| EVD-019 | RECOMENDACIÓN | [01:17:44–01:22:50 — participantes] | Se discuten motion graphics y edición/generación de video por IA con selección visual o prompts. | Capacidad exploratoria para futuro; no hay compromiso ni proveedor definido. | Alta |
| EVD-020 | DECISIÓN TOMADA | [01:25:51 — Ernesto Hernández Martínez] | La primera etapa debe igualar la calidad del último video entregado. | Se establece un benchmark, pero falta un rubric verificable y el archivo fuente. | Alta |

## 1. Executive Summary

La reunión evaluó un editor de video embebido en el flujo de producción de cursos. La demostración mostró un timeline por capas, preview, pistas separadas, zoom y rejilla, además de capacidades declaradas de presets. La revisión concluyó que la herramienta sirve para ensamble básico y puede ahorrar tiempo por el acceso a assets generados, pero no demostró todavía que pueda producir de extremo a extremo el nivel visual y sonoro usado como referencia comercial.

El problema principal no es “carecer de todas las funciones de Premiere”, sino no contar aún con el conjunto recurrente de controles y garantías de fidelidad que permita producir cursos y piezas corporativas con calidad consistente sin abandonar el flujo principal. Las brechas más claras son corrección de color, texto/captions, edición básica de audio, organización de capas, transiciones entre clips y fluidez/diagnóstico del preview y render.

Están confirmadas tres direcciones: desacoplar el editor del pipeline de cursos para uso más general, incorporar las funciones de uso frecuente sin buscar paridad total con Premiere y usar el último video entregado como benchmark de la primera etapa. La corrección básica de color fue la única capacidad concreta ratificada explícitamente como mínima durante la conversación.

El MVP recomendado es primero un **MVP de validación productiva**: fijar el benchmark, reproducir el caso real en el editor, comparar source/preview/render y cerrar las brechas indispensables que el ejercicio evidencie. Los bloqueadores son la ausencia del archivo/rubric de referencia, la falta de un inventario aprobado de “funciones recurrentes”, y dos posibles defectos —cambio de color y stutter— cuya causa no fue reproducida.

## 2. Meeting Classification

- **Tipo principal:** Functional Review.
- **Tipos secundarios:** UX Review, Product Validation, Requirements Gathering y Technical Discovery inicial.
- **Objetivo real:** evaluar si el editor actual permite producir el tipo de video requerido por SofLIA y descubrir las capacidades faltantes.
- **Resultado esperado:** recomendaciones y una primera delimitación del estándar mínimo.
- **Dinámica observada:** demostración guiada, evaluación heurística por un editor de video, exploración de ideas y cierre estratégico de alcance.

| Participante | Rol declarado | Rol observado en la reunión | Evidencia | Confianza |
|---|---|---|---|---|
| Israel Martínez Arias | No determinado | Demostrador, operador del editor y enlace técnico/producto | Guía la interfaz, describe implementación y formula hipótesis de render [00:27:06–01:09:13]. | Alta |
| Ernesto Hernández Martínez | No determinado | Sponsor y decisor de dirección/alcance | Define descentralización, no-paridad con Premiere y benchmark [01:13:09–01:25:51]. | Alta |
| guitarblueghost (Charlie) | Se describe como editor de video y perfil creativo | Experto de dominio, evaluador UX y usuario profesional objetivo | Compara el flujo con Premiere/Final Cut y propone capacidades [00:27:06–01:22:50]. | Alta |
| Israel Martínez Arias's Presentation | No aplica | Audio/video reproducido en la demostración | Intervenciones automáticas de la transcripción durante playback. | Alta |

Los roles formales, ownership y autoridad de aprobación contractual no fueron declarados; sólo se documenta el rol observado.

## 3. Product Context

- **Producto/módulo:** editor de composición de video dentro de SofLIA Engine, asociado al proceso de creación de cursos.
- **Objetivo de negocio:** producir cursos y contenido corporativo con mayor velocidad y sin rechazar demanda por límites operativos [01:22:50–01:24:13].
- **Objetivo del producto:** concentrar el flujo habitual de edición y ensamble en SofLIA Engine, reutilizando assets y automatización.
- **Objetivo del usuario:** ensamblar y corregir videos recurrentes con menos trabajo manual, preservando control sobre los detalles relevantes.
- **Objetivo técnico:** permitir uso modular del editor y asegurar que la transformación entre source, preview y render no introduzca degradación no solicitada.
- **Estándar de calidad esperado:** “premium” y equivalente al último video entregado. Sigue sin ser verificable hasta definir dimensiones de imagen, audio, captions, transiciones, resolución, FPS y tolerancias.
- **Usuarios principales:** editor/creativo de video; operador de producción; equipo que prepara assets y cursos. Los clientes finales sólo aparecen como consumidores indirectos.
- **Casos de uso:** video educativo con avatar, slides/B-roll/voz; onboarding corporativo con footage propio; reutilización de una timeline como plantilla; afinación externa para casos especializados.
- **Herramientas externas actuales:** HeyGen o herramienta de avatar [Transcripción ambigua: “deen/Heer”], Adobe Premiere y potencialmente software especializado de audio.

### Contexto técnico suplementario del repositorio

El repositorio actual contiene un dominio `composition-editor` con documento versionado, tracks, clips, trim, snap, presets, mezcla de audio, motion y FPS configurables; también existe una experiencia standalone. Esto **no prueba** que dichas capacidades estuvieran en la build demostrada, fueran accesibles al usuario o cumplieran el comportamiento esperado. La discrepancia se registra en OQ-001 y exige una auditoría de versión antes de convertir el PRD en tickets.

## 4. Problem Statement

El equipo de producción necesita crear videos educativos y corporativos de calidad consistente dentro de SofLIA Engine. En la build evaluada, el editor permite ensamble básico, pero carece o no demuestra controles recurrentes para organizar composiciones, unificar color y audio, crear textos/captions y gestionar transiciones; además, existen dudas sobre fidelidad de color y cadencia entre source, preview y render.

Esto afecta principalmente al editor/creativo y al operador de producción: deben aceptar una salida inferior, invertir tiempo en correcciones externas o arriesgar entregables inconsistentes. No actuar mantendría dependencia operativa de herramientas externas para tareas habituales, debilitaría la promesa de velocidad y dificultaría escalar producción sin degradar calidad.

## 5. Product Goal

- **Objetivo de negocio:** reducir tiempo de producción manteniendo capacidad de entrega ante mayor demanda.
- **Objetivo del producto:** resolver dentro del editor las operaciones recurrentes del flujo SofLIA.
- **Objetivo del usuario:** producir y ajustar una composición sin reconstruirla manualmente en otra herramienta.
- **Objetivo técnico:** preservar sincronización y fidelidad entre assets, preview y render; desacoplar el módulo del pipeline de cursos.
- **Estándar de calidad:** igualar el benchmark acordado [Métrica por definir].

> El objetivo del producto es permitir que el equipo de producción pueda ensamblar videos educativos y corporativos recurrentes sin necesidad de trasladar cada proyecto completo a un editor profesional externo, manteniendo una calidad visual, sonora y temporal equivalente al benchmark aprobado.

No se persigue en esta etapa: sustituir Premiere/Final Cut/Pro Tools, cubrir corrección cinematográfica avanzada, replicar cada función de un editor profesional ni eliminar inmediatamente toda herramienta externa.

## 6. Users

| Actor | Necesidad | Contexto y experiencia | Problema principal | Permisos/responsabilidades | Evidencia |
|---|---|---|---|---|---|
| Editor/creativo de video | Control eficiente sobre timeline, imagen, audio y acabado | Experiencia profesional; usa Premiere y presets | El editor básico no cubre varias operaciones recurrentes | Editar, revisar y decidir cuándo escalar a herramienta externa [Permisos por validar] | [00:27:06–01:19:11] |
| Operador de producción | Ensamblar assets generados y reutilizar plantillas | Conoce el pipeline y la build actual | Variabilidad de assets y necesidad de resolver excepciones | Preparar, ensamblar, renderizar y validar [Permisos por validar] | [00:39:49–01:09:13] |
| Equipo de producción de cursos | Entregar más rápido con calidad consistente | Trabajo colaborativo con assets, avatar y material corporativo | Dependencia de afinación externa y controles insuficientes | Producir cursos y talleres; ownership no definido | [01:13:09–01:25:51] |
| Cliente/estudiante final | Recibir contenido claro y con acabado profesional | Consumidor, no usuario directo del editor | Inconsistencia visual/sonora reduce percepción y comprensión | No aplica | Inferencia recomendada a partir de [01:24:13–01:25:51] |

## 7. Current State

| Capacidad | Estado en la reunión | Evidencia | Limitación | Confianza |
|---|---|---|---|---|
| Timeline multicapa | Existente y verificada | [00:27:06] | Los elementos se manejan unitariamente. | Alta |
| Preview | Existente y verificada | [00:27:06; 00:39:49] | Se reporta carga/atraso tras ediciones. | Alta |
| Audio y video separados | Existente y verificada | [00:27:06] | No se verificó vinculación. | Alta |
| Agrupación/anidación | Inexistente según declaración | [00:29:24] | Composiciones grandes elevan carga cognitiva. | Alta |
| Entrada/salida animada | Existente y verificada | [00:30:42–00:32:10] | No equivale a transición simultánea entre dos clips. | Alta |
| Corrección de color | Inexistente según declaración | [00:33:41] | No permite unificar fuentes visuales. | Alta |
| Edición de audio | Parcial/no verificada | [00:36:40] | Corte parece posible; fades, limpieza y presets no se verificaron. | Media |
| Keyframes/nodos | Parcial según declaración | [00:37:50] | Alcance y UX no fueron demostrados. | Baja |
| Zoom del preview | Existente y verificada | [00:39:49–00:41:05] | Escala máxima/controles no quedaron documentados. | Alta |
| Rejilla de alineación | Existente según declaración | [00:41:05] | Ajustabilidad y snapping no se verificaron. | Media |
| Texto/captions nativos | Inexistente según declaración | [00:41:05–00:42:40; 01:10:52] | Requiere asset externo; captions transparentes no se reproducían. | Alta |
| Preview de resolución reducida | Inexistente/no verificada | [00:52:51–00:53:57] | No hay control visible para fluidez. | Media |
| Presets de timeline | Existente según declaración | [01:07:24–01:09:13] | Extracción/aplicación no se demostró. | Media |
| Render cloud | Existente según declaración | [01:01:33–01:02:58] | Se sospecha degradación de color; causa no aislada. | Media |
| Módulo standalone | En desarrollo/objetivo | [01:13:09] | En ese momento estaba embebido en cursos. | Alta |
| Salida con calidad benchmark | No verificada | [01:10:52–01:13:09] | El video de referencia fue creado fuera del editor. | Alta |

## 8. Target State

### Target confirmado

- El editor puede abrirse y usarse como módulo independiente del pipeline de cursos.
- Incluye las funciones recurrentes necesarias para los tipos de video de SofLIA, sin perseguir paridad total con Premiere.
- La primera etapa puede reproducir dentro del editor la calidad del último video entregado.
- Incluye al menos corrección básica de color.

### Target recomendado

- Source, preview y render se comparan mediante un flujo de QA reproducible.
- La edición frecuente de timeline, texto y audio se ejecuta sin pérdida involuntaria de sincronía.
- Un proyecto que exceda el alcance puede exportarse y afinarse externamente sin bloquear la producción.

### Target pendiente de decisión

- Lista exacta de operaciones recurrentes que componen MVP y V1.
- Alcance de captions, presets, keyframes, motion graphics e IA generativa.
- Grado y duración aceptable de dependencia de Premiere.

## 9. Key Problems

| ID | Tipo | Problema | Evidencia | Usuario afectado | Impacto | Frecuencia | Severidad | Confianza |
|---|---|---|---|---|---|---|---|---|
| PROB-001 | Problema de calidad | El editor no ha demostrado igualar el benchmark externo. | EVD-016, EVD-020 | Equipo de producción | Retrabajo y riesgo comercial | Por proyecto | High | Alta |
| PROB-002 | Limitación funcional | No hay corrección básica de color. | EVD-006, EVD-011 | Editor | Fuentes visuales inconsistentes | Frecuente según experto | High | Alta |
| PROB-003 | Problema UX | No hay agrupación/anidación de capas. | EVD-003 | Editor | Timeline difícil de manejar | [Frecuencia por determinar] | Medium | Alta |
| PROB-004 | Riesgo funcional | Audio y video pueden perder sincronía al editarse por separado. | EVD-004 | Editor | Desfase de narración/acción | [Frecuencia por determinar] | High | Media |
| PROB-005 | Limitación funcional | No se demostraron transiciones cross-clip. | EVD-005 | Editor/espectador | Cortes o acabados limitados | Frecuente en acabado | Medium | Alta |
| PROB-006 | Problema de calidad | Voz/sonido pueden presentar ruido, baja presencia o inconsistencia. | EVD-007 | Editor/espectador | Menor claridad y percepción | Recurrente en las pruebas | High | Alta |
| PROB-007 | Limitación funcional | No hay creación nativa de texto/captions demostrada. | EVD-010, EVD-016 | Editor/estudiante | No puede reproducirse el benchmark completo | Frecuente | High | Alta |
| PROB-008 | Performance/UX | El preview puede tardar en reflejar ediciones o reproducirse con poca fluidez. | EVD-013 | Editor | Iteración lenta o diagnósticos falsos | [Frecuencia por determinar] | Medium | Media |
| PROB-009 | Bug sospechado | El color podría cambiar sin intención entre source y render. | EVD-011, EVD-014 | Editor | Degradación del entregable | No reproducida | Critical si se confirma | Baja |
| PROB-010 | Bug sospechado | Clips con FPS distintos podrían verse lentos/entrecortados. | EVD-012, EVD-014 | Editor/espectador | Cadencia incorrecta | No reproducida | High si se confirma | Baja |
| PROB-011 | Riesgo arquitectónico | El editor está acoplado al pipeline de cursos. | EVD-017 | Equipo de producción | Impide uso transversal | Persistente | High | Alta |
| PROB-012 | Problema de definición | “Premium” no tiene criterios observables. | EVD-020 | Product/QA/Engineering | No se puede estimar ni aceptar | Persistente | High | Alta |
| PROB-013 | Riesgo de producto | Incorporar funciones avanzadas sin priorización puede aumentar complejidad. | [00:49:40–00:51:19; 01:17:44] | Editor/equipo | Curva de aprendizaje y scope creep | Persistente | Medium | Alta |

## 10. Functional Requirements

### FR-001 — Uso standalone del editor

- **Estado:** Confirmado.
- **Descripción:** un usuario autorizado debe poder iniciar o abrir un proyecto de edición sin entrar por un artefacto del pipeline de cursos.
- **Problema relacionado:** PROB-011.
- **Usuario:** editor/operador.
- **Trigger:** seleccionar el editor desde una entrada independiente.
- **Precondiciones:** sesión válida, organización activa y permisos [por definir].
- **Flujo principal:** crear/seleccionar proyecto, cargar assets, editar, guardar y renderizar.
- **Resultado observable:** el proyecto existe y puede retomarse sin depender de un curso.
- **Flujos alternos:** abrir el editor desde una lección y conservar su contexto.
- **Edge cases:** proyecto sin assets; asset eliminado; cambio de organización; versión antigua.
- **Reglas de negocio:** aislamiento por organización; no romper flujos existentes.
- **Dependencias:** DEP-001, DEP-002.
- **Datos:** documento de composición, assets, ownership, versiones.
- **Errores esperados:** sin permisos, asset inaccesible, versión incompatible.
- **Prioridad:** Must Have.
- **Procedencia:** Decidida en reunión.
- **Evidencia:** EVD-017.
- **Confianza:** Alta.

### FR-002 — Corrección básica de color por clip

- **Estado:** Confirmado.
- **Descripción:** el editor debe permitir ajustar como mínimo brillo, contraste y saturación por clip sin alterar el archivo fuente.
- **Problema relacionado:** PROB-002.
- **Usuario:** editor.
- **Trigger:** seleccionar un clip visual y abrir controles de color.
- **Precondiciones:** clip de imagen/video compatible.
- **Flujo principal:** modificar valores, previsualizar, guardar y renderizar.
- **Resultado observable:** preview y render reflejan los mismos ajustes dentro de tolerancia [por definir].
- **Flujos alternos:** restablecer valores; copiar ajustes a otro clip.
- **Edge cases:** HDR/SDR, alpha, imágenes, clips sin metadata de color.
- **Reglas de negocio:** edición no destructiva; valores originales recuperables.
- **Dependencias:** DEP-003, investigación BUG-001.
- **Datos:** parámetros de color y metadata del source.
- **Errores esperados:** formato no soportado, render incompatible.
- **Prioridad:** Must Have.
- **Procedencia:** Decidida en reunión; detalle de controles recomendado a partir de la evidencia.
- **Evidencia:** EVD-006.
- **Confianza:** Alta para la capacidad; Media para el set exacto.

### FR-003 — Reproducción del caso benchmark

- **Estado:** Confirmado.
- **Descripción:** el equipo debe poder reconstruir en el editor la composición del último video entregado y obtener una salida comparable mediante un rubric aprobado.
- **Problema relacionado:** PROB-001, PROB-012.
- **Usuario:** equipo de producción/QA.
- **Trigger:** ejecutar el proyecto de referencia.
- **Precondiciones:** fuentes, proyecto externo o breakdown y rubric disponibles.
- **Flujo principal:** importar assets, reconstruir, renderizar, comparar y registrar gaps.
- **Resultado observable:** reporte de cumplimiento por dimensión y video resultante.
- **Flujos alternos:** documentar una excepción deliberadamente resuelta en Premiere.
- **Edge cases:** asset/licencia faltante; fuente no reproducible; cambio de proveedor.
- **Reglas de negocio:** una recomendación no se considera cumplida por similitud subjetiva.
- **Dependencias:** DEP-004.
- **Datos:** benchmark, fuentes, parámetros de render, resultados de QA.
- **Errores esperados:** benchmark incompleto o no reproducible.
- **Prioridad:** Must Have para validar el MVP.
- **Procedencia:** Decidida en reunión.
- **Evidencia:** EVD-016, EVD-020.
- **Confianza:** Alta.

### FR-004 — Agrupación y anidación de elementos

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** permitir agrupar clips/pistas relacionados, colapsarlos y manipular el conjunto conservando edición interna.
- **Problema relacionado:** PROB-003.
- **Usuario:** editor.
- **Trigger:** seleccionar varios elementos y crear grupo.
- **Precondiciones:** selección compatible y proyecto editable.
- **Flujo principal:** agrupar, nombrar, colapsar/expandir y mover el conjunto.
- **Resultado observable:** relaciones y offsets internos se conservan.
- **Flujos alternos:** desagrupar; entrar a edición del grupo.
- **Edge cases:** grupos anidados, tracks bloqueados, selección mixta.
- **Reglas de negocio:** edición reversible; profundidad máxima [por definir].
- **Dependencias:** modelo de documento y undo/redo.
- **Datos:** ID de grupo, miembros y transformaciones.
- **Errores esperados:** ciclo de anidación, miembro inexistente.
- **Prioridad:** Should Have recomendada.
- **Procedencia:** Recomendada; necesidad explícita sin decisión inequívoca de MVP.
- **Evidencia:** EVD-003.
- **Confianza:** Alta.

### FR-005 — Vinculación temporal de audio y video

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** vincular clips de audio y video para que operaciones compatibles de movimiento y recorte conserven sincronía.
- **Problema relacionado:** PROB-004.
- **Usuario:** editor.
- **Trigger:** seleccionar dos o más clips y ejecutar “Vincular”.
- **Precondiciones:** clips editables con una relación temporal válida.
- **Flujo principal:** vincular, mover o recortar mediante una operación compatible y conservar el offset.
- **Resultado observable:** mover un miembro desplaza el relacionado por el mismo delta; desvincular permite edición independiente.
- **Flujos alternos:** desvincular; cancelar una operación que no puede aplicarse al conjunto.
- **Edge cases:** múltiples audios, trim asimétrico, ripple edit, clip bloqueado, source sin audio.
- **Reglas de negocio:** no modificar silenciosamente elementos bloqueados; advertir operación parcial.
- **Dependencias:** DEP-003.
- **Datos:** relación, offset y política de operación.
- **Errores esperados:** enlace huérfano o conflicto de límites.
- **Prioridad:** Should Have recomendada.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-004.
- **Confianza:** Alta.

### FR-006 — Transiciones entre clips

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** aplicar una transición que opere sobre la salida de un clip y la entrada del siguiente, empezando por disolvencia/crossfade [set final por definir].
- **Problema relacionado:** PROB-005.
- **Usuario:** editor.
- **Trigger:** seleccionar la unión entre dos clips y elegir una transición.
- **Precondiciones:** clips compatibles y duración suficiente para la política de solape.
- **Flujo principal:** elegir tipo y duración, previsualizar y guardar.
- **Resultado observable:** la transición se representa en timeline, preview y render con duración editable.
- **Flujos alternos:** reemplazar o eliminar la transición; aplicar un valor predeterminado.
- **Edge cases:** clips sin solape, límites, pistas distintas y media incompatible.
- **Reglas de negocio:** distinguir transición cross-clip de animación de entrada/salida.
- **Dependencias:** motor de composición y render.
- **Datos involucrados:** IDs de clips, tipo, duración, easing y política de solape.
- **Errores esperados:** duración imposible, source insuficiente o combinación no soportada.
- **Prioridad:** Should Have recomendada.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-005.
- **Confianza:** Alta.

### FR-007 — Edición básica de audio

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** ofrecer controles no destructivos para ganancia, fade in/out y un conjunto mínimo aprobado de correcciones/presets de voz.
- **Problema relacionado:** PROB-006.
- **Usuario:** editor.
- **Trigger:** seleccionar un clip/pista de audio y abrir mezcla o preset.
- **Precondiciones:** asset accesible y audio decodificable.
- **Flujo principal:** ajustar ganancia/fades o aplicar preset, escuchar preview, guardar y renderizar.
- **Resultado observable:** el usuario puede unificar niveles y aplicar/restablecer un preset; preview y render conservan el resultado.
- **Flujos alternos:** bypass; edición externa para casos avanzados.
- **Edge cases:** clipping, silencio, múltiples voces, música/SFX, audio embebido.
- **Reglas de negocio:** no prometer reducción de ruido o “voz épica” hasta validar algoritmos y criterios.
- **Dependencias:** DEP-005.
- **Datos involucrados:** ganancia, curvas de fade, preset, roles de pista y mediciones.
- **Errores esperados:** formato no soportado, preset incompatible o salida con clipping.
- **Prioridad:** Should Have; alcance requiere workshop de audio.
- **Procedencia:** Recomendada a partir de necesidad expresa.
- **Evidencia:** EVD-007.
- **Confianza:** Alta para la necesidad; Baja para efectos exactos.

### FR-008 — Texto y captions nativos

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** crear y editar capas de texto/caption con contenido, estilo, posición y tiempo dentro del editor.
- **Problema relacionado:** PROB-007.
- **Usuario:** editor.
- **Trigger:** agregar una capa de texto o importar captions.
- **Precondiciones:** fuente autorizada/disponible y composición editable.
- **Flujo principal:** crear, editar contenido/estilo/posición/timing, previsualizar y renderizar.
- **Resultado observable:** texto transparente se renderiza sin depender de rasterizarlo externamente.
- **Flujos alternos:** importar captions; convertir texto a preset.
- **Edge cases:** overflow, safe areas, fuentes no disponibles, RTL, caracteres especiales.
- **Reglas de negocio:** contraste y legibilidad; fuentes/licencias válidas.
- **Dependencias:** DEP-006.
- **Datos involucrados:** contenido, fuente, estilo, layout, rango temporal e idioma.
- **Errores esperados:** fuente ausente, parseo inválido, overflow o formato de captions no soportado.
- **Prioridad:** Must Have recomendada para el benchmark; no confirmada individualmente como compromiso.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-010, EVD-016.
- **Confianza:** Alta.

### FR-009 — Calidad adaptable del preview

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** permitir seleccionar calidad de preview (por ejemplo, completa, media o reducida) sin modificar el render final.
- **Problema relacionado:** PROB-008.
- **Usuario:** editor.
- **Trigger:** cambiar el selector de calidad del preview.
- **Precondiciones:** proyecto cargado y perfil disponible.
- **Flujo principal:** elegir calidad, regenerar/ajustar preview y continuar editando.
- **Resultado observable:** cambiar calidad modifica la carga del preview y no el documento/render.
- **Flujos alternos:** selección automática según capacidad/red [pendiente de decisión].
- **Edge cases:** assets 4K, red lenta, cache desactualizada.
- **Reglas de negocio:** el perfil final de render nunca cambia por este control.
- **Dependencias:** métricas de preview y pipeline de proxies [Engineering Decision Required].
- **Datos involucrados:** perfil de preview y telemetry; no parámetros persistentes de entrega.
- **Errores esperados:** proxy no disponible, timeout o fallback a calidad soportada.
- **Prioridad:** Should Have recomendada.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-013.
- **Confianza:** Alta.

### FR-010 — Controles de reproducción por teclado

- **Estado:** Candidato [UX Decision Required].
- **Descripción:** play/pause mediante Space y mapa mínimo de shortcuts accesible y sin conflicto con inputs.
- **Problema relacionado:** PROB-008.
- **Usuario:** editor.
- **Trigger:** pulsar un shortcut en el contexto del editor.
- **Precondiciones:** foco en una zona compatible y acción habilitada.
- **Flujo principal:** ejecutar acción y reflejar estado visual/ARIA.
- **Resultado observable:** Space alterna playback cuando el foco no está editando texto; el control visible refleja el estado.
- **Flujos alternos:** activar la misma acción mediante botón; consultar mapa de shortcuts.
- **Edge cases:** foco en input, modal abierto, composición sin cargar y lectores de pantalla.
- **Reglas de negocio:** no capturar teclas reservadas cuando el usuario introduce contenido.
- **Dependencias:** UX-004 y revisión de accesibilidad.
- **Datos involucrados:** mapa de comandos/preferencias si se permiten personalizaciones.
- **Errores esperados:** conflicto de shortcut o acción no disponible con feedback explícito.
- **Prioridad:** Could Have para MVP; Should Have para V1.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-009.
- **Confianza:** Alta.

### FR-011 — Aplicación adaptable de presets

- **Estado:** Candidato [Product Decision Required].
- **Descripción:** aplicar una plantilla a nuevos assets adaptando posiciones, proporciones y timing mediante reglas explícitas.
- **Problema relacionado:** PROB-001.
- **Usuario:** editor/operador.
- **Trigger:** seleccionar un preset y asignar assets a sus roles.
- **Precondiciones:** preset válido, acceso a assets y composición compatible.
- **Flujo principal:** mapear roles, simular adaptación, revisar excepciones y aplicar.
- **Resultado observable:** el preset produce una composición válida y muestra las decisiones que requieren revisión.
- **Flujos alternos:** cancelar, reasignar un rol o guardar una variante.
- **Edge cases:** aspect ratio distinto, ausencia de rol, duración insuficiente, source portrait/landscape.
- **Reglas de negocio:** no incluir identificadores o contenido privado al publicar un preset reusable.
- **Dependencias:** capacidad existente declarada, esquema de roles y pruebas.
- **Datos involucrados:** definición del preset, roles, reglas de fit/timing y versión.
- **Errores esperados:** preset incompatible, rol faltante o resultado fuera de límites.
- **Prioridad:** Should Have recomendada.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-015.
- **Confianza:** Media.

### FR-012 — Diagnóstico de fidelidad y cadencia

- **Estado:** Candidato [Engineering Decision Required].
- **Descripción:** capturar metadata y resultados que permitan comparar source, preview y render para color, resolución, duración y FPS.
- **Problema relacionado:** PROB-009, PROB-010.
- **Usuario:** Engineering/QA/operador.
- **Trigger:** preparar preview, enviar render o abrir diagnóstico por correlation ID.
- **Precondiciones:** instrumentation habilitada y acceso autorizado.
- **Flujo principal:** registrar inputs/configuración, ejecutar, medir salida y presentar diferencias.
- **Resultado observable:** ante una discrepancia, el reporte identifica inputs, transformaciones y salida reproducible.
- **Flujos alternos:** adjuntar manualmente una comparación si una métrica no está automatizada.
- **Edge cases:** job cancelado, provider timeout, source remoto expirado o metadata incompleta.
- **Reglas de negocio:** no registrar secretos ni URLs firmadas completas; retención por definir.
- **Dependencias:** observabilidad del render cloud.
- **Datos involucrados:** hashes, codec, FPS, color metadata, duración, versión, provider y correlation ID.
- **Errores esperados:** probe fallido, log incompleto o output no recuperable.
- **Prioridad:** Must Have recomendada antes de corregir los bugs sospechados.
- **Procedencia:** Recomendada.
- **Evidencia:** EVD-012, EVD-014.
- **Confianza:** Alta como necesidad diagnóstica.

### FR-013 — Edición/generación de media asistida por IA

- **Estado:** Diferido.
- **Descripción:** seleccionar una región o describir un cambio para generar/reemplazar elementos visuales o motion graphics.
- **Problema relacionado:** no indispensable para el problema central.
- **Usuario:** creativo.
- **Trigger:** iniciar una edición generativa desde prompt o selección.
- **Precondiciones:** consentimiento, proveedor configurado, derechos sobre inputs y presupuesto.
- **Flujo principal:** seleccionar/describir, generar propuesta, revisar y aceptar o descartar.
- **Resultado observable:** sólo una propuesta aprobada se incorpora como asset versionado.
- **Flujos alternos:** regenerar, comparar variantes o cancelar sin alterar la composición.
- **Edge cases:** personas/logos, contenido sensible, resultados inseguros, costos y timeout.
- **Reglas de negocio:** human-in-the-loop, trazabilidad de proveedor y licencias; política por definir.
- **Dependencias:** proveedor, costos, derechos, seguridad, UX de aprobación.
- **Datos involucrados:** prompt, máscara/selección, referencias, output, provenance y moderación.
- **Errores esperados:** rechazo del proveedor, límite de cuota, output inválido o revisión bloqueante.
- **Prioridad:** Won't Have Now.
- **Procedencia:** Idea exploratoria.
- **Evidencia:** EVD-019.
- **Confianza:** Alta sobre la idea; Baja sobre viabilidad/alcance.

## 11. Non-Functional Requirements

### NFR-001 — Fidelidad de render

- **Categoría:** calidad de render/sincronización.
- **Requerimiento:** una edición no debe introducir cambios de color, timing, encuadre o audio no representados en el documento.
- **Escenario:** comparación source-preview-render.
- **Métrica:** [Métrica por definir]; recomendado usar frame hashes/perceptual diff, scopes de color y diferencia de duración/sync.
- **Método:** suite de fixtures y comparación automatizada más revisión visual.
- **Prioridad:** Must Have recomendada.
- **Evidencia:** EVD-011–EVD-014.
- **Riesgo:** salida corrupta o falsa confianza del preview.
- **Estado:** Candidato.
- **Confianza:** Alta.

### NFR-002 — Fluidez y latencia del preview

- **Categoría:** rendimiento/latencia.
- **Requerimiento:** el preview debe responder a edición y playback en condiciones objetivo.
- **Métrica:** [Métrica por definir]; medir tiempo edición→frame actualizado, dropped frames y buffering por perfil de asset.
- **Método:** telemetría cliente y escenarios 1080p/4K [perfiles por aprobar].
- **Prioridad:** Should Have.
- **Evidencia:** EVD-013.
- **Estado:** Pendiente de validación.
- **Confianza:** Media.

### NFR-003 — Calidad de audio

- **Categoría:** calidad de audio.
- **Requerimiento:** preview y render deben conservar mezcla, fades y sincronía sin clipping introducido.
- **Métrica:** [Métrica por definir]; loudness, true peak y desvío A/V recomendados.
- **Método:** análisis automatizado y escucha de referencia.
- **Prioridad:** Should Have.
- **Evidencia:** EVD-007.
- **Estado:** Pendiente de validación con especialista.
- **Confianza:** Alta.

### NFR-004 — Usabilidad del flujo recurrente

- **Categoría:** usabilidad.
- **Requerimiento:** las operaciones frecuentes deben ser descubribles y no exigir conocimiento de un editor profesional.
- **Métrica:** [Métrica por definir]; recomendar tasa de finalización, errores y tiempo sobre tareas benchmark.
- **Método:** pruebas moderadas con editor y operador.
- **Prioridad:** Must Have recomendada.
- **Evidencia:** [00:49:40–00:51:19; 01:17:44].
- **Estado:** Candidato.
- **Confianza:** Alta.

### NFR-005 — Compatibilidad temporal

- **Categoría:** compatibilidad/frame rate.
- **Requerimiento:** el sistema debe definir y comunicar cómo trata sources con FPS distintos.
- **Métrica:** [Criterio por definir]; no debe cambiar duración ni cadencia fuera de la política aprobada.
- **Método:** matriz de 24/25/30/60 FPS y VFR [si aplica].
- **Prioridad:** Must Have si BUG-002 se confirma.
- **Evidencia:** EVD-012, EVD-014.
- **Estado:** Pendiente de validación.
- **Confianza:** Media.

### NFR-006 — Seguridad y aislamiento

- **Categoría:** seguridad/privacidad.
- **Requerimiento:** proyectos y assets standalone deben respetar organización, permisos y URLs autorizadas.
- **Métrica:** cero accesos cross-tenant en pruebas; matriz RBAC aprobada.
- **Método:** pruebas de autorización y revisión de almacenamiento.
- **Prioridad:** Must Have recomendada para standalone.
- **Evidencia:** derivada del contexto multi-organización del producto, no de la reunión.
- **Estado:** Candidato [Security Review Required].
- **Confianza:** Alta.

### NFR-007 — Observabilidad del render

- **Categoría:** observabilidad/operación.
- **Requerimiento:** registrar versión del documento, metadata de sources, preset, parámetros, proveedor y resultado por render.
- **Métrica:** 100% de renders diagnosticables con correlation ID [valor recomendado; Product/Engineering deben aprobarlo].
- **Método:** auditoría de eventos y simulación de fallo.
- **Prioridad:** Must Have recomendada.
- **Evidencia:** EVD-014.
- **Estado:** Candidato.
- **Confianza:** Alta.

## 12. User Stories

### US-001 — Editar fuera de un curso

Como editor, quiero abrir un proyecto de video independiente, para reutilizar el flujo de SofLIA en piezas no ligadas a una lección.

- **Relacionados:** FR-001, NFR-006; PROB-011.
- **Estado:** Confirmado. **Prioridad:** Must Have. **Evidencia:** EVD-017.

### US-002 — Unificar apariencia

Como editor, quiero corregir color por clip de forma no destructiva, para que fuentes heterogéneas se perciban coherentes.

- **Relacionados:** FR-002, NFR-001; PROB-002.
- **Estado:** Confirmado. **Prioridad:** Must Have. **Evidencia:** EVD-006.

### US-003 — Validar calidad objetivo

Como responsable de producción, quiero reconstruir y comparar el video benchmark, para decidir con evidencia si la primera etapa está lista.

- **Relacionados:** FR-003, FR-012, NFR-001; PROB-001, PROB-012.
- **Estado:** Confirmado. **Prioridad:** Must Have. **Evidencia:** EVD-016, EVD-020.

### US-004 — Mantener orden y sincronía

Como editor, quiero agrupar elementos y vincular audio/video, para modificar composiciones sin desorden ni desfases accidentales.

- **Relacionados:** FR-004, FR-005; PROB-003, PROB-004.
- **Estado:** Candidato. **Prioridad:** Should Have recomendada. **Evidencia:** EVD-003, EVD-004.

### US-005 — Crear acabado editorial

Como editor, quiero agregar transiciones, texto y captions, para reproducir el lenguaje visual requerido sin rasterizar elementos fuera del editor.

- **Relacionados:** FR-006, FR-008; PROB-005, PROB-007.
- **Estado:** Candidato. **Prioridad:** Must/Should por decidir. **Evidencia:** EVD-005, EVD-010, EVD-016.

### US-006 — Ajustar el sonido

Como editor, quiero corregir niveles, fades y carácter básico de voz, para obtener audio consistente sin abrir una herramienta especializada en cada caso.

- **Relacionados:** FR-007, NFR-003; PROB-006.
- **Estado:** Candidato. **Prioridad:** Should Have. **Evidencia:** EVD-007.

### US-007 — Iterar con preview fluido

Como editor, quiero reducir la calidad de preview y usar shortcuts, para editar con rapidez sin reducir la calidad del render.

- **Relacionados:** FR-009, FR-010, NFR-002; PROB-008.
- **Estado:** Candidato. **Prioridad:** Should Have. **Evidencia:** EVD-009, EVD-013.

### US-008 — Reutilizar una composición

Como operador, quiero aplicar un preset a nuevos assets, para producir variantes sin reconstruir posiciones y proporciones.

- **Relacionados:** FR-011; PROB-001.
- **Estado:** Candidato. **Prioridad:** Should Have. **Evidencia:** EVD-015.

## 13. Acceptance Criteria

### US-001 — Acceptance Criteria

#### AC-001 — Crear proyecto standalone
Given una sesión autorizada y una organización activa, When el usuario crea un proyecto desde la entrada standalone, Then puede guardar un documento de composición sin seleccionar un curso.

#### AC-002 — Aislamiento y reapertura
Given un proyecto guardado, When un usuario autorizado de la misma organización lo abre, Then recupera la última versión válida; un usuario sin acceso recibe un error explícito y no obtiene metadata sensible.

### US-002 — Acceptance Criteria

#### AC-003 — Ajustes no destructivos
Given un clip seleccionado, When se cambian brillo, contraste o saturación, Then el source permanece intacto y el usuario puede restablecer todos los valores.

#### AC-004 — Paridad preview-render
Given ajustes de color guardados, When se genera el render, Then éste aplica los mismos parámetros dentro de la tolerancia aprobada en NFR-001.

### US-003 — Acceptance Criteria

#### AC-005 — Benchmark reproducible
Given el paquete completo del video de referencia, When se reconstruye y renderiza mediante el flujo documentado, Then se genera el video y un reporte con resultado por cada dimensión del rubric.

#### AC-006 — Gaps explícitos
Given una dimensión que no alcanza el criterio, When QA cierra la comparación, Then el reporte identifica diferencia, evidencia, severidad y si se resuelve en producto o mediante workaround externo.

### US-004 — Acceptance Criteria

#### AC-007 — Grupo reversible
Given varios clips compatibles, When el usuario los agrupa, mueve y luego desagrupa, Then se conservan sus offsets, pistas y propiedades internas.

#### AC-008 — Enlace sincronizado
Given audio y video vinculados, When se desplaza uno dentro de límites válidos, Then ambos se desplazan por el mismo delta; si una pista está bloqueada, no se aplica una operación parcial silenciosa.

### US-005 — Acceptance Criteria

#### AC-009 — Transición real
Given dos clips adyacentes compatibles, When se aplica una disolvencia, Then timeline, preview y render muestran el solape de salida/entrada durante la duración elegida.

#### AC-010 — Texto transparente
Given una capa de texto con fondo transparente, When se posiciona y renderiza, Then conserva contenido, estilo, alpha, posición y rango temporal.

#### AC-011 — Overflow y fuentes
Given texto que excede su caja o una fuente no disponible, When se previsualiza/renderiza, Then el editor advierte el problema y usa sólo la política de fallback aprobada.

### US-006 — Acceptance Criteria

#### AC-012 — Ganancia y fades
Given un clip de audio, When se ajustan ganancia y fades, Then la forma de salida refleja el cambio en preview y render sin modificar el source.

#### AC-013 — Protección ante clipping
Given una mezcla que supera el criterio aprobado, When se intenta renderizar, Then el sistema advierte o bloquea según la política definida y registra los clips implicados.

### US-007 — Acceptance Criteria

#### AC-014 — Calidad sólo de preview
Given una composición pesada, When se selecciona preview reducido, Then la calidad visible cambia pero el documento y el perfil del render final no se modifican.

#### AC-015 — Shortcut seguro
Given que el foco no está en un campo de texto, When se pulsa Space, Then playback alterna entre play y pause; dentro de un campo, se introduce un espacio normalmente.

### US-008 — Acceptance Criteria

#### AC-016 — Preset adaptable
Given un preset válido y assets con roles compatibles, When se aplica, Then se crean posiciones/proporciones/timing válidos y se listan los elementos que requieren revisión.

#### AC-017 — Aspect ratio incompatible
Given un asset cuya proporción no coincide, When se aplica el preset, Then el sistema usa la regla contain/cover aprobada o solicita una decisión; no recorta silenciosamente contenido crítico.

### Criterios transversales

#### AC-018 — Recuperación ante fallo de guardado
Given una edición local y un fallo de persistencia, When el guardado no termina, Then el usuario ve el estado, conserva los cambios recuperables y puede reintentar sin duplicar operaciones.

#### AC-019 — Versiones compatibles
Given un documento de versión anterior, When se abre, Then se migra sin pérdida o se bloquea con explicación y copia recuperable.

#### AC-020 — Auditoría de render
Given cualquier render enviado, When soporte consulta su correlation ID, Then puede recuperar versión del documento, parámetros, sources y resultado del job.

## 14. Bugs / Technical Issues

### BUG-001 — Cambio no intencional de color

- **Estado:** Sospechado / requiere investigación.
- **Descripción:** la apariencia de un clip cambia entre source o vista previa y ensamble final.
- **Observado:** el rostro de Israel aparece con color notablemente diferente; no hubo corrección intencional.
- **Esperado:** misma apariencia salvo transformaciones declaradas.
- **Contexto:** render/ensamble cloud y assets posiblemente comprimidos.
- **Pasos aproximados:** obtener source exacto, abrir en build de la sesión, renderizar con configuración capturada y comparar.
- **Frecuencia:** no determinada.
- **Impacto:** Critical si se reproduce de forma sistemática.
- **Evidencia:** EVD-011, EVD-014.
- **Hipótesis:** compresión, perfil/espacio de color, interpretación del proveedor. Ninguna validada.
- **Datos necesarios:** archivos originales, hashes, codecs, color primaries/transfer/matrix, pipeline, screenshots y output.
- **Requiere investigación:** Sí. **Severidad:** Critical condicional. **Confianza:** Baja.

### BUG-002 — Cadencia lenta o entrecortada

- **Estado:** No reproducido / requiere investigación.
- **Descripción:** un clip de tren parece lento o con saltos.
- **Observado:** playback anómalo; Israel no recuerda haberlo estirado.
- **Esperado:** duración y cadencia coherentes con source y política de timeline.
- **Pasos aproximados:** comparar source, preview y render con clips 24/25/30 FPS.
- **Frecuencia:** no determinada.
- **Impacto:** High si afecta render; Medium si sólo afecta preview.
- **Evidencia:** EVD-012, EVD-014.
- **Hipótesis:** source defectuoso, decodificación de preview o mismatch de FPS.
- **Datos necesarios:** media probe, FPS constante/variable, timebase, dropped frames, duración por etapa.
- **Requiere investigación:** Sí. **Confianza:** Baja.

### BUG-003 — Retraso del preview tras editar

- **Estado:** Sospechado.
- **Descripción:** el preview tarda en cargar o reflejar una edición.
- **Comportamiento observado:** Israel describe un atraso mientras el editor vuelve a cargar los cambios.
- **Esperado:** actualización dentro del criterio NFR-002.
- **Contexto:** editor online; carga y hardware no caracterizados.
- **Pasos aproximados:** registrar una edición sobre la build evaluada, medir hasta el primer frame actualizado y repetir con distintos assets/perfiles.
- **Frecuencia:** descrita como tendencia, sin medición.
- **Impacto:** Medium.
- **Evidencia:** EVD-013.
- **Hipótesis:** decodificación, resolución, red, cache o compilación [no discutidas como causas definitivas].
- **Datos necesarios:** asset, equipo, navegador, red y telemetry.
- **Requiere investigación:** Sí. **Confianza:** Media.

### Hipótesis técnicas separadas

| ID | Hipótesis | Evidencia | Validación necesaria | Estado | Confianza |
|---|---|---|---|---|---|
| HYP-001 | La transformación, compresión o interpretación de color del pipeline cloud podría causar el cambio visual. | [01:01:33–01:04:30] | Comparar hashes/metadata y frames en cada etapa. | No validada | Baja |
| HYP-002 | El source o una diferencia de FPS podría causar el stutter del tren. | [00:52:51–01:05:50] | Probar el source exacto y matriz de FPS contra preview/render. | No validada | Baja |
| HYP-003 | Reducir resolución del preview podría mejorar la fluidez de edición. | [00:52:51–00:53:57] | Medir dropped frames y latencia antes/después por perfil. | No validada | Media |

## 15. UX Requirements

| ID | Requisito UX | Usuario | Problema | Criterio verificable | Prioridad | Evidencia |
|---|---|---|---|---|---|---|
| UX-001 | Diferenciar transición cross-clip de entrada/salida | Editor | PROB-005 | Etiqueta, iconografía y selección muestran sobre qué clips opera | Should | EVD-005 |
| UX-002 | Mostrar estado de guardado/render | Editor | PROB-001 | Estados pendiente, guardando, guardado y error son visibles | Must recomendado | AC-018 |
| UX-003 | Hacer edición reversible | Editor | PROB-003 | Undo/redo cubre operaciones destructivas del alcance [lista por definir] | Must recomendado | Inferencia profesional |
| UX-004 | Shortcuts sin conflicto | Editor | PROB-008 | Cumple AC-015 y ofrece mapa accesible | Should | EVD-009 |
| UX-005 | Controles progresivos | Editor no especialista | PROB-013 | Controles básicos visibles; avanzados no saturan el flujo inicial | Must recomendado | [00:49:40–00:51:19] |
| UX-006 | Alertas accionables | Operador | PROB-009/010 | Error indica clip, causa conocida/no conocida y siguiente acción | Must recomendado | EVD-014 |
| UX-007 | Estado vacío standalone | Operador | PROB-011 | Permite crear proyecto, importar assets o abrir reciente | Must recomendado | FR-001 |
| UX-008 | Accesibilidad de controles | Todos | Riesgo de lanzamiento | Navegación por teclado, nombre accesible, foco visible y contraste aprobados | Must recomendado | Contexto de calidad; no discutido |
| UX-009 | Revisión de preset | Operador | PROB-001 | Señala adaptaciones automáticas y excepciones antes de confirmar | Should | EVD-015 |

## 16. Prioritization

| Iniciativa | Requisitos | MoSCoW | Impacto | Esfuerzo | Procedencia | Justificación | Dependencias |
|---|---|---|---|---|---|---|---|
| INIT-001 Benchmark y fidelidad | FR-003, FR-012; NFR-001/005/007 | Must | Alto | Medio | Mixta | Convierte “premium” y sospechas en evidencia verificable | DEP-003/004 |
| INIT-002 Editor standalone | FR-001; NFR-006 | Must | Alto | [Requiere estimación] | Decidida | Habilita uso transversal | DEP-001/002 |
| INIT-003 Corrección de color | FR-002 | Must | Alto | [Requiere estimación] | Decidida | Brecha concreta indispensable | INIT-001 |
| INIT-004 Lenguaje editorial del benchmark | FR-006, FR-008 | Must recomendado/Should | Alto | [Requiere estimación] | Recomendada | Cierra texto/captions y transiciones requeridas por la referencia | DEP-006 |
| INIT-005 Edición segura y audio esencial | FR-004, FR-005, FR-007; NFR-003 | Should | Alto | Alto/[estimar] | Recomendada | Reduce desorden, desfases y retrabajo | DEP-005, modelo/undo |
| INIT-006 Velocidad y reutilización | FR-009, FR-010, FR-011; NFR-002 | Should | Alto | [Requiere estimación] | Recomendada | Mejora iteración y producción a granel | Telemetría, auditoría de presets |
| INIT-007 Exploración IA creativa | FR-013 | Won't Have Now | Potencial alto | Alto | Pendiente | No valida el núcleo y añade dependencias | Discovery IA/legal |

### Matriz impacto vs. esfuerzo

- **Alto impacto / bajo esfuerzo:** no clasificable con evidencia suficiente; Product no debe asumirlo.
- **Alto impacto / alto esfuerzo:** audio esencial, probable; edición IA avanzada.
- **Bajo impacto / bajo esfuerzo:** shortcuts podría caer aquí tras estimación.
- **Bajo impacto / alto esfuerzo:** paridad avanzada de color/motion; no recomendada.
- **No clasificable sin discovery técnico:** standalone, fidelidad/render, color, captions, agrupación, transiciones, presets y preview.

## 17. MVP Scope

El MVP recomendado valida una salida real, no una lista abstracta de features:

1. **Paquete benchmark y rubric (FR-003):** pertenece al MVP porque define el resultado y evita que “premium” sea una opinión. Desbloquea alcance, QA y aceptación. Fuera: elevar el benchmark a cine o paridad profesional.
2. **Diagnóstico source-preview-render (FR-012, NFR-001/005/007):** pertenece al MVP porque BUG-001/002 podrían invalidar cualquier mejora visual. Desbloquea corrección con causa demostrada. Fuera: soporte exhaustivo de todo codec/FPS.
3. **Entrada standalone mínima (FR-001):** pertenece al MVP por decisión explícita y habilita al creativo externo al curso. Fuera: DAM completo, colaboración avanzada y marketplace.
4. **Corrección básica de color (FR-002):** pertenece al MVP por decisión explícita y por impacto directo en el video mostrado. Fuera: grading profesional, matching automático, LUT management avanzado y HDR hasta discovery.
5. **Cierre de gaps indispensables del benchmark:** captions/texto (FR-008) sólo entra como compromiso tras confirmar que el benchmark no puede reproducirse sin él; las demás capacidades se incorporan únicamente si la prueba demuestra bloqueo.

El flujo híbrido con Premiere continúa permitido durante MVP. No se considera fracaso si está documentado como excepción, pero no puede ocultar un gap de una capacidad declarada dentro del MVP.

## 18. V1 Scope

### Confirmado

- Editor standalone sostenible y funciones recurrentes, una vez aprobado el inventario.
- Calidad al menos equivalente al benchmark aprobado.

### Recomendado

- Texto/captions nativos (FR-008).
- Vinculación A/V y audio básico (FR-005, FR-007).
- Transiciones cross-clip (FR-006).
- Agrupación/anidación (FR-004).
- Preview adaptable y shortcuts (FR-009, FR-010).
- Presets adaptables con revisión (FR-011).
- Undo/redo, accesibilidad, telemetría y matriz de compatibilidad.

### Pendiente de validación

- Color matching automático.
- Limpieza de ruido y presets exactos de voz.
- Soporte de FPS variable, interpolación y políticas de conformado.
- Eliminación total de Premiere en el flujo habitual.

## 19. Future Scope

- Generación/reemplazo visual con prompts y selección regional.
- Motion graphics generativos o parametrizables.
- Storyboard dibujado a secuencia generada.
- Matching automático de color.
- Grading avanzado, interpretación amplia de perfiles y LUTs.
- Ecosistema/biblioteca de presets compartidos.
- Integración bidireccional con herramientas profesionales, si el volumen lo justifica.

Esta sección es exploratoria; no constituye roadmap aprobado.

## 20. Out of Scope

- Paridad funcional completa con Premiere, Final Cut o Pro Tools.
- Corrección de color cinematográfica avanzada en la primera etapa.
- Sustituir especialistas de audio para trabajos complejos.
- Garantizar que todo tipo de proyecto pueda completarse sin herramienta externa.
- Copiar productos competidores o sus implementaciones.
- Motion graphics/IA avanzada en el MVP.
- Automatización de preproducción creativa no necesaria para validar el editor.

“Won't Have Now” significa diferido y no necesariamente rechazado.

## 21. Technical Considerations

### Qué necesita el producto

- Un modelo de composición reusable fuera y dentro de cursos.
- Edición no destructiva, versionable y recuperable.
- Identidad y relaciones estables entre tracks, clips, grupos y assets.
- Preview representativo del render y opción de menor costo visual.
- Política explícita para color, audio, FPS, aspect ratio y fuentes.
- Render observable, reproducible y aislado por organización.
- Backward compatibility con proyectos existentes.

### Posibles implicaciones técnicas

| Consideración | Estado | Implicación |
|---|---|---|
| Separar dominio del editor del artefacto curso | Confirmado como necesidad; diseño requerido | [Engineering Decision Required] para ownership, rutas, API y migración. |
| Esquema versionado de composición | Propuesto/derivable | Necesario para presets, standalone y compatibilidad. El repo ya contiene un documento versionado; auditar accesibilidad y cobertura. |
| Relaciones de grupo/link | Propuesto | Requiere invariantes, operaciones atómicas y migración. |
| Color no destructivo | Confirmado como producto | Requiere definir espacio de trabajo, soporte por runtime y paridad cloud; spike recomendado. |
| Preview proxies/calidad | Hipótesis de solución | No asumir transcoding; medir primero el cuello de botella. |
| FPS/conformado | Hipótesis | Comparar source y render antes de elegir duplicación, interpolación o restricción. |
| Audio DSP | Propuesto | Spike con especialista para distinguir mezcla básica de restauración. |
| Render cloud | Existente según declaración | Añadir metadata, correlation ID, retries idempotentes y validación. |
| Presets | Existente según declaración/repositorio | Auditar contrato, adaptación de roles y datos sensibles antes de extender. |
| IA generativa | Diferido | Requiere proveedor, costes, límites, revisión humana, privacidad y derechos. |

No se selecciona librería, proveedor o arquitectura definitiva en este PRD.

## 22. Dependencies

| ID | Dependencia | Tipo | Requisito afectado | Estado | Responsable sugerido | Riesgo | Evidencia |
|---|---|---|---|---|---|---|---|
| DEP-001 | Modelo standalone de proyecto/ownership | Producto/Engineering | FR-001 | Por definir | [Owner por definir] | Acoplamiento y migración | EVD-017 |
| DEP-002 | RBAC y aislamiento organizacional | Seguridad | FR-001, NFR-006 | Por validar | [Owner por definir] | Exposición cross-tenant | Contexto del producto |
| DEP-003 | Runtime de preview/render y política de media | Engineering | FR-002/005/006/009/012 | Por investigar | [Owner por definir] | Diferencias entre preview/render | EVD-014 |
| DEP-004 | Video benchmark, fuentes y rubric | Stakeholder/Product | FR-003 | Bloqueante, no suministrado | Ernesto/Charlie como destinatarios sugeridos; owner no asignado | No hay aceptación objetiva | EVD-016, EVD-020 |
| DEP-005 | Validación de especialista de audio | Investigación | FR-007, NFR-003 | Ofrecida, no agendada | [Owner por definir] | Scope incorrecto o mala calidad | [00:48:18–00:49:40] |
| DEP-006 | Fuentes, captions y reglas de marca/accesibilidad | Diseño/Legal | FR-008 | Por definir | [Owner por definir] | Render inconsistente/licencias | EVD-010 |
| DEP-007 | Proveedor externo de avatar/render | Proveedor externo | FR-003, NFR-001 | Existente; identidad exacta ambigua | [Owner por definir] | Cambios de API/calidad/coste | EVD-011, EVD-014 |
| DEP-008 | Inventario de operaciones recurrentes | Producto/Usuario | V1 | Bloqueante para scope | Charlie y Product como consultados; owner no asignado | Scope creep | EVD-017 |

## 23. Risks

| ID | Riesgo | Probabilidad | Impacto | Requisitos | Mitigación propuesta | Señal temprana | Owner |
|---|---|---|---|---|---|---|---|
| RISK-001 | “Premium” produce aceptación subjetiva | Alta | Alto | FR-003 | Rubric y golden assets | Feedback contradictorio | [Owner por definir] |
| RISK-002 | Se implementa sobre una causa de color/FPS no demostrada | Media | Alto | FR-002/012 | Spike reproducible primero | Fix no cambia output | [Owner por definir] |
| RISK-003 | Scope deriva hacia réplica de Premiere | Alta | Alto | Todos | Inventario basado en frecuencia y benchmark | Features sin caso real | [Owner por definir] |
| RISK-004 | Más controles elevan curva de aprendizaje | Media | Medio | FR-004–011 | Progressive disclosure y usability tests | Tiempo/error aumenta | [Owner por definir] |
| RISK-005 | Preview y render divergen | [Por determinar] | Crítico | NFR-001 | Fixtures, telemetry y comparación | QA sólo falla al final | [Owner por definir] |
| RISK-006 | Presets recortan o deforman assets | Media | Alto | FR-011 | Roles, contain/cover y revisión | Correcciones manuales repetidas | [Owner por definir] |
| RISK-007 | Audio básico se convierte en restauración profesional | Media | Medio | FR-007 | Workshop y límites explícitos | Solicitudes de plugins/efectos crecientes | [Owner por definir] |
| RISK-008 | Standalone rompe permisos o documentos existentes | [Por determinar] | Alto | FR-001 | Migración, feature flag y security tests | Errores al reabrir/cross-tenant | [Owner por definir] |
| RISK-009 | Dependencia externa altera calidad, costo o disponibilidad | [Por determinar] | Alto | FR-003/013 | Abstracción, logging y fallback | Cambio de output/API | [Owner por definir] |

## 24. Open Questions

| ID | Pregunta | Por qué importa | Tipo de decisión | Bloquea | Destinatario sugerido | Evidencia |
|---|---|---|---|---|---|---|
| OQ-001 | ¿Qué commit/build y feature flags correspondían a la demo, y qué capacidades actuales del repo están realmente expuestas? | Evita tickets duplicados y resuelve discrepancias. | Engineering Decision Required | estimación/implementación | Engineering | Contraste repo vs reunión |
| OQ-002 | ¿Cuál es el archivo benchmark y cuáles son sus fuentes/licencias? | Permite reproducir el objetivo. | Stakeholder Validation Required | alcance/QA | Ernesto/Charlie | EVD-016/020 |
| OQ-003 | ¿Qué significa “premium” por imagen, audio, captions, transiciones y marca? | Define DoD. | Product Decision Required | alcance/QA/lanzamiento | Product/Creative | EVD-020 |
| OQ-004 | ¿Cuáles operaciones se usan “todo el tiempo” y con qué frecuencia? | Determina MVP/V1. | Product Decision Required | alcance/estimación | Product/Charlie/operadores | EVD-017 |
| OQ-005 | ¿Color mínimo es global, por clip o ambos? ¿Incluye temperatura/tinte? | Cambia modelo y UX. | Product/UX Decision Required | diseño | Product/UX | EVD-006 |
| OQ-006 | ¿BUG-001 ocurre en source, preview, zip, proveedor o render final? | Evita causa inventada. | Engineering Decision Required | implementación/QA | Engineering | EVD-014 |
| OQ-007 | ¿El tren estaba defectuoso en el source? | Define si BUG-002 existe. | Engineering Decision Required | estimación | QA/Engineering | EVD-012 |
| OQ-008 | ¿Qué formatos, codecs, resoluciones, espacios de color y FPS son soportados? | Define compatibilidad. | Engineering Decision Required | QA/lanzamiento | Engineering/Production | EVD-014 |
| OQ-009 | ¿Captions nativos forman parte de primera etapa o sólo del benchmark? | Afecta MVP. | Product Decision Required | alcance | Product | EVD-010/016 |
| OQ-010 | ¿Qué operaciones deben propagarse en un vínculo A/V? | Evita comportamiento sorprendente. | UX/Engineering Decision Required | diseño | UX/Engineering/Charlie | EVD-004 |
| OQ-011 | ¿Qué incluye el audio “básico y decente” y cuáles son métricas? | Acota FR-007/NFR-003. | Product Decision Required | alcance/QA | Audio specialist/Product | EVD-007 |
| OQ-012 | ¿Existe undo/redo y qué operaciones cubre? | Requisito de seguridad de edición. | UX/Engineering Decision Required | diseño/QA | Engineering/UX | No determinado |
| OQ-013 | ¿Qué usuarios/roles pueden crear, compartir, renderizar y eliminar proyectos standalone? | Seguridad. | Security Review Required | implementación/lanzamiento | Security/Product | FR-001 |
| OQ-014 | ¿Cuándo se considera aceptable salir a Premiere y cómo se registra? | Diferencia excepción de gap. | Product Decision Required | operación/QA | Product/Production | EVD-018 |
| OQ-015 | ¿Cuál es el objetivo de latencia y fluidez del preview por perfil? | Hace NFR-002 verificable. | Product/Engineering Decision Required | QA | Product/Engineering | EVD-013 |
| OQ-016 | ¿La IA generativa forma parte de una iniciativa separada? | Evita scope creep y abre revisión legal. | Product Decision Required | nada inmediato | Product | EVD-019 |

## 25. Definition of Done

Una iniciativa del editor está terminada cuando:

- Su estado de requisito está aprobado y sus AC relacionados pasan.
- El caso benchmark aplicable tiene resultado documentado y aceptado.
- Preview y render producen el mismo comportamiento dentro de [Criterio por definir].
- No se introducen cambios no declarados de color, timing, encuadre, volumen o sincronía.
- Operaciones son no destructivas o requieren confirmación y tienen recuperación/undo según alcance.
- Estados vacío, carga, guardado, render, error y reintento están cubiertos.
- Controles nuevos pasan revisión UX, teclado, foco, nombre accesible y contraste.
- Se ejecutan pruebas unitarias de invariantes, integración de persistencia/render y E2E del flujo crítico.
- Existe regresión con 24/25/30 FPS y formatos aprobados; 60/VFR según matriz final.
- Seguridad valida aislamiento de organización y permisos del standalone.
- Logs incluyen correlation ID y datos suficientes sin secretos ni media sensible innecesaria.
- Documentación técnica describe esquema, migración, errores y rollback.
- Documentación operativa describe diagnóstico, retry y cuándo usar workaround externo.
- Despliegue usa feature flag o rollback si la migración/riesgo lo requiere.
- Product/Creative acepta el benchmark y QA conserva evidencia.

Umbrales de performance, fidelidad, audio y accesibilidad pendientes deben cerrarse antes de declarar release-ready.

## 26. Recommended Next Sprint / Development Sequence

### INIT-001 — Congelar benchmark y reproducir fallos

- **Objetivo:** transformar calidad y sospechas en evidencia.
- **Incluye:** FR-003, FR-012; BUG-001/002/003; NFR-001/002/005/007.
- **Problemas:** PROB-001/008/009/010/012.
- **Dependencias:** DEP-003/004/007.
- **Entrada:** video, sources, build, configuración y permisos.
- **Resultado:** rubric, proyecto reproducible, comparación y backlog de gaps.
- **Validación:** QA + Creative.
- **Paralelo con:** auditoría INIT-002.
- **Estimación:** Engineering y QA.
- **Estado:** recomendada; requiere aprobación.

### INIT-002 — Auditar y habilitar standalone

- **Objetivo:** verificar lo ya implementado y cerrar el desacoplamiento.
- **Incluye:** FR-001, NFR-006, UX-002/007.
- **Problemas:** PROB-011.
- **Dependencias:** DEP-001/002; OQ-001/013.
- **Resultado:** mapa de gaps, flujo mínimo protegido y migración.
- **Validación:** E2E cross-role/cross-tenant.
- **Paralelo con:** INIT-001.
- **Estimación:** Engineering, Security y QA.
- **Estado:** dirección aprobada; solución requiere discovery.

### INIT-003 — Cerrar fidelidad y color mínimo

- **Objetivo:** garantizar salida no degradada y control visual indispensable.
- **Incluye:** FR-002 y correcciones demostradas por INIT-001.
- **Problemas:** PROB-002/009/010.
- **Dependencias:** INIT-001, OQ-005–008.
- **Resultado:** controles no destructivos y paridad validada.
- **Validación:** fixtures + benchmark.
- **Paralelo con:** diseño de INIT-004 tras estabilizar contrato.
- **Estimación:** Engineering/QA/Creative.
- **Estado:** capacidad aprobada; detalle pendiente.

### INIT-004 — Completar lenguaje editorial del benchmark

- **Objetivo:** cerrar captions/texto y transiciones sólo si el benchmark lo exige.
- **Incluye:** FR-006, FR-008.
- **Problemas:** PROB-005/007.
- **Dependencias:** DEP-006; OQ-009.
- **Resultado:** capas de texto y set mínimo de transiciones probado.
- **Validación:** AC-009–011 y accesibilidad.
- **Estimación:** UX/Engineering/QA.
- **Estado:** recomendada, no aprobada.

### INIT-005 — Edición segura y audio esencial

- **Objetivo:** reducir errores operativos y afinación externa recurrente.
- **Incluye:** FR-004, FR-005, FR-007, UX-003/005.
- **Problemas:** PROB-003/004/006/013.
- **Dependencias:** DEP-005, OQ-010–012.
- **Resultado:** inventario aprobado y capacidades implementadas por prioridad.
- **Validación:** tareas moderadas con editor y operador.
- **Estimación:** Product/UX/Engineering/audio specialist.
- **Estado:** recomendada.

### INIT-006 — Velocidad y reutilización

- **Objetivo:** capturar ahorros después de estabilizar calidad.
- **Incluye:** FR-009, FR-010, FR-011.
- **Problemas:** PROB-008 y tiempo de producción.
- **Dependencias:** telemetría y auditoría de presets existentes.
- **Resultado:** preview adaptable, shortcuts y presets revisables.
- **Validación:** métricas de tarea y casos de aspect ratio.
- **Estimación:** Engineering/UX/QA.
- **Estado:** recomendada.

### INIT-007 — Exploración IA creativa

- **Objetivo:** evaluar generación/reemplazo visual sin comprometer el core.
- **Incluye:** FR-013.
- **Dependencias:** estrategia, legal, seguridad, proveedor y costes.
- **Resultado:** spike y decisión go/no-go, no feature de producción.
- **Puede ejecutarse en paralelo:** sólo después de asignar capacidad sin desplazar Must Have.
- **Estado:** diferida.

## Appendix A — Decision Log

| ID | Decisión | Estado | Quién | Evidencia | Impacto |
|---|---|---|---|---|---|
| DEC-001 | Descentralizar el editor para uso fuera del pipeline de cursos | Confirmada | Ernesto Hernández Martínez | [01:13:09] | Define FR-001 y arquitectura |
| DEC-002 | No competir por paridad total con Premiere | Confirmada | Ernesto Hernández Martínez | [01:13:09–01:17:44] | Limita alcance |
| DEC-003 | Incorporar las funciones usadas recurrentemente, aunque alguna sea avanzada | Confirmada como principio; inventario pendiente | Ernesto Hernández Martínez | [01:17:44] | Marco de priorización |
| DEC-004 | Incluir corrección de color mínima | Confirmada | Ernesto Hernández Martínez y Charlie | [01:14:58] | Define FR-002 |
| DEC-005 | Igualar en primera etapa la calidad del último video entregado | Confirmada; criterios pendientes | Ernesto Hernández Martínez | [01:25:51] | Define FR-003/DoD |
| DEC-006 | Usar Premiere para afinación mientras el editor madura | Confirmada como workaround transitorio | Ernesto Hernández Martínez y Charlie | [01:25:51] | Reduce riesgo operativo, no cierra gaps |

## Appendix B — Contradictions and Ambiguities

| Tema | Afirmación A | Afirmación B | Interpretación | Acción necesaria |
|---|---|---|---|---|
| Origen del video | Se asumió que ya se habían hecho videos allí [01:10:52] | El último video no se hizo en el editor [01:10:52–01:13:09] | No usar ese output como evidencia de capacidad actual | Obtener proyecto y breakdown benchmark |
| Color | El clip base puede venir mal/contraluz [00:44:19–00:45:35] | El cambio podría ocurrir en compresión/render [01:01:33–01:04:30] | Hay dos problemas posibles: source pobre y degradación pipeline | Comparación controlada por etapa |
| Tren entrecortado | Podría ser preview/FPS [00:52:51; 01:05:50] | El video original quizá ya era así [00:53:57–00:55:13] | BUG-002 no confirmado | Conseguir source y reproducir |
| Nivel del editor | Se pide “muy fresa” [00:33:41] | No se busca competir con Premiere [01:13:09] | “Alto nivel” significa cobertura del flujo frecuente, no paridad | Aprobar rubric e inventario |
| Todo dentro vs híbrido | Se aspira a reproducir funciones dentro [01:16:30–01:17:44] | Se acepta Premiere para detalles [01:25:51] | Estrategia incremental con excepciones | Definir exit criteria del híbrido |
| Texto | Se sugiere usar texto como imagen [00:41:05–00:42:40] | Se declara importante crear texto nativo [00:56:33] | El asset raster es workaround, no solución objetivo | Decidir MVP captions |
| Términos/proveedor | “deen”, “Heer”, “capsulos”, “birros/inscers” | Contexto sugiere avatar/render, captions y B-roll/inserts | [Transcripción ambigua] | Confirmar términos y proveedor |

## Appendix C — Traceability Matrix

| Elemento | Problema | Evidencia | Requisito | User Story | AC | Prioridad | Scope |
|---|---|---|---|---|---|---|---|
| Standalone | PROB-011 | EVD-017 | FR-001, NFR-006 | US-001 | AC-001/002/018/019 | Must, decidida | MVP |
| Color | PROB-002/009 | EVD-006/011/014 | FR-002, NFR-001 | US-002 | AC-003/004/020 | Must, decidida | MVP |
| Benchmark | PROB-001/012 | EVD-016/020 | FR-003, FR-012 | US-003 | AC-005/006/020 | Must, decidida | MVP |
| Grupos | PROB-003 | EVD-003 | FR-004 | US-004 | AC-007/018 | Should, recomendada | V1 |
| Link A/V | PROB-004 | EVD-004 | FR-005, NFR-003 | US-004 | AC-008/013 | Should, recomendada | V1 |
| Transiciones | PROB-005 | EVD-005 | FR-006 | US-005 | AC-009 | Should, recomendada | V1 |
| Texto/captions | PROB-007 | EVD-010/016 | FR-008 | US-005 | AC-010/011 | Must recomendado | MVP condicional/V1 |
| Audio | PROB-006 | EVD-007 | FR-007, NFR-003 | US-006 | AC-012/013 | Should, recomendada | V1 |
| Preview | PROB-008 | EVD-009/013 | FR-009/010, NFR-002 | US-007 | AC-014/015 | Should, recomendada | V1 |
| Presets | PROB-001 | EVD-015 | FR-011 | US-008 | AC-016/017 | Should, recomendada | V1 |
| IA creativa | — | EVD-019 | FR-013 | — | — | Won't Have Now | Futuro |

Todos los Must Have confirmados tienen evidencia, objetivo/problema, historia, aceptación y scope. Los Must Have **recomendados** siguen sujetos a Product Decision.

## Appendix D — Findings Not Converted into Requirements

| Hallazgo | Clasificación | Motivo | Evidencia | Acción recomendada |
|---|---|---|---|---|
| Comparar comunicación de Coursera/Udemy | Contexto/recomendación | Pertenece a posicionamiento, no al editor | [00:19:08–00:25:51] | Llevar a research de marketing separado |
| “11 millones de usuarios” y lanzamiento 2027 | Contexto no verificado | No es necesario para el PRD y puede ser error de transcripción | [00:20:44] | Verificar externamente sólo si se usa en estrategia |
| Grabar avatares con iPhone y luces | Recomendación operativa | No es capacidad del editor | [00:45:35] | Crear guideline de captura separado |
| Igualar color automáticamente | Recomendación | No hubo decisión ni precisión suficiente | [00:35:18] | Spike posterior al color básico |
| Eco/modulación/voz épica | Recomendación | Solución vaga; requiere especialista y métricas | [00:36:40–00:49:40] | Workshop de audio |
| Keyframes frame-by-frame | Hallazgo ambiguo | Capacidad actual parcial y prioridad no confirmada | [00:37:50] | Auditar implementación y frecuencia |
| Interpretación avanzada de color/LUTs | Diferido | Charlie lo colocó explícitamente para más adelante | [01:05:50–01:07:24] | Discovery futuro |
| Generación IA por prompt/selección | Recomendación exploratoria | Sin alcance, proveedor, costo ni aprobación | [01:20:13–01:22:50] | Iniciativa separada |
| Promesa de pasar “de 3 horas a 20” | Afirmación anecdótica | Unidad y evidencia son ambiguas; no es métrica válida | [01:16:30] | Medir baseline real de tareas |
