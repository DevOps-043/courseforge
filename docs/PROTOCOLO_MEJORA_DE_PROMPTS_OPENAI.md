# Protocolo de mejora de prompts — OpenAI Luna, Terra y Sol

> Estado: activo · Actualizado: 2026-08-29 · Alcance: prompts de producto, agentes y flujos internos.

## 1. Propósito

Mejorar un prompt de forma controlada: elevar la calidad verificable de la salida sin añadir instrucciones redundantes, herramientas innecesarias ni ambigüedad. Este protocolo aplica a los perfiles actuales de OpenAI:

| Perfil | Uso recomendado | Evitar como primera opción |
| --- | --- | --- |
| **Luna** (`gpt-5.6-luna`) | Alto volumen, tareas acotadas, clasificación, extracción, transformaciones con contrato estricto y borradores rápidos. | Arquitectura compleja, decisiones de alto impacto o síntesis con evidencia extensa. |
| **Terra** (`gpt-5.6-terra`) | Opción equilibrada para implementación cotidiana, análisis técnico, depuración y planes con varios módulos. | Escalar a Sol sin haber identificado primero una dificultad concreta. |
| **Sol** (`gpt-5.6-sol`) | Diseño de arquitectura, investigación compleja, refactors de alto riesgo, problemas ambiguos o revisiones donde una omisión es costosa. | Tareas rutinarias que Luna o Terra resuelven con el mismo contrato y calidad. |

Estos perfiles son rutas operativas de la familia GPT-5.6: Luna prioriza eficiencia y volumen; Terra, equilibrio; Sol, capacidad principal. La selección debe validarse con casos representativos del producto, no por intuición.

## 2. Principios no negociables

1. **Resultado antes que procedimiento.** Definir qué debe quedar resuelto y cómo se reconocerá una respuesta correcta. No dictar pasos internos salvo que sean una restricción real.
2. **Contexto mínimo suficiente.** Mantener sólo hechos, reglas, datos y ejemplos que cambien una decisión. Eliminar repeticiones, instrucciones genéricas y herramientas irrelevantes.
3. **Contratos explícitos.** Especificar entradas, fuentes permitidas, formato de salida, restricciones, efectos autorizados y criterios de validación.
4. **Hechos, inferencias e incertidumbre separados.** Exigir que el modelo no presente una hipótesis como evidencia ni invente información ausente.
5. **Permisos acotados.** Distinguir investigación, diseño, implementación, validación y acciones externas. Una solicitud de análisis o plan no autoriza cambios.
6. **Evaluar antes de escalar.** Corregir primero el objetivo, los criterios de éxito, el contexto y los contratos; ajustar razonamiento o modelo sólo si la evaluación lo justifica.

## 3. Proceso obligatorio

### Paso 0 — Clasificar la tarea y elegir perfil

Antes de editar el prompt, definir: tipo de tarea, impacto de un error, necesidad de herramientas, latencia/costo objetivo y si el resultado debe ser estructurado.

- Elegir **Luna** cuando el trabajo es repetible, tiene entradas completas y una salida que puede validarse automáticamente.
- Elegir **Terra** como línea base para tareas técnicas con juicio moderado y varias dependencias.
- Elegir **Sol** cuando exista alta ambigüedad, diseño transversal, riesgo alto, investigación o una decisión difícil de revertir.

No convertir una tarea mal definida en una tarea de Sol. Primero completar su contrato.

### Paso 1 — Diagnosticar el prompt actual

Registrar en una ficha breve:

```md
Objetivo del usuario:
Usuario o sistema destinatario:
Entrada disponible y fuente de verdad:
Salida esperada:
Riesgo de un error:
Acciones autorizadas / no autorizadas:
Modelo y razonamiento actuales:
Fallos observados con ejemplos reales:
Métrica o criterio de éxito:
```

Identificar cada fallo como uno de estos tipos: falta de contexto, objetivo ambiguo, criterio de éxito ausente, formato inconsistente, autorización confusa, recuperación deficiente, uso incorrecto de herramientas o capacidad insuficiente.

### Paso 2 — Simplificar antes de agregar

Eliminar del prompt:

- reglas repetidas o contradictorias;
- “sé exhaustivo”, “piensa paso a paso” o “sé breve” sin una definición observable;
- ejemplos que no corrigen un fallo medido;
- herramientas no necesarias para la tarea;
- procesos impuestos que no afectan la seguridad, la evidencia o el resultado.

Conservar: objetivo visible, restricciones de negocio/seguridad, evidencia obligatoria, formato, permisos, validación y condición de parada.

### Paso 3 — Reescribir con el contrato base

Usar esta plantilla y eliminar secciones que no cambien el comportamiento:

```md
## Rol y contexto
Eres [rol] dentro de [producto/dominio]. Usa únicamente [fuentes o contexto].

## Objetivo
Entrega [resultado concreto] para [destinatario].

## Éxito
La tarea está completa cuando:
- [criterio verificable 1]
- [criterio verificable 2]
- [criterio verificable 3]

## Restricciones y permisos
- Puedes: [lecturas, cambios locales, pruebas no destructivas].
- No puedes: [acciones externas, borrados, cambios fuera de alcance].
- Si falta un dato crítico, [pregunta puntual / declara el bloqueo].
- Distingue hechos observados, inferencias y preguntas abiertas.

## Herramientas y evidencia
- Usa [herramienta/fuente] sólo cuando [condición].
- Para afirmaciones externas o cambiantes, cita únicamente fuentes recuperadas.
- Si un resultado es vacío, parcial o sospechoso, intenta hasta [n] alternativas útiles y reporta el límite.

## Salida
Responde en [idioma] con:
1. [sección]
2. [sección]
3. [sección]

## Parada y validación
Detente cuando se cumplan los criterios de éxito. Antes de finalizar, valida [pruebas, contratos, citas o revisión] y declara lo que no pudo validarse.
```

### Paso 4 — Ajustar al perfil seleccionado

**Para Luna**

- Reducir el contexto a datos directamente necesarios.
- Preferir JSON Schema, tablas o listas con campos obligatorios.
- Convertir criterios cualitativos en reglas comprobables.
- Dividir lotes heterogéneos: una operación por tipo de registro.
- Incluir uno o dos ejemplos sólo si fijan una ambigüedad conocida.

**Para Terra**

- Conservar el contrato base y añadir dependencias, decisiones y riesgos materiales.
- Pedir síntesis antes de propuestas cuando existan varias fuentes independientes.
- Exigir validación proporcional: pruebas dirigidas, tipos/lint/build o smoke test según el cambio.
- Reservar el razonamiento alto para evidencias de que medio no alcanza.

**Para Sol**

- Entregar contexto de arquitectura, restricciones no funcionales y consecuencias de error.
- Requerir alternativas y trade-offs cuando la decisión sea difícil de revertir.
- Separar descubrimiento, diseño e implementación para impedir que el agente avance de fase sin autorización.
- Pedir una revisión final de compatibilidad, seguridad, datos, observabilidad y QA.

## 4. Diseño de herramientas y recuperación

Exponer sólo herramientas relevantes. Cada una debe indicar qué hace, cuándo usarla, dato de salida útil y comportamiento ante error.

- Lecturas independientes: pueden ejecutarse en paralelo y luego sintetizarse.
- Dependencias secuenciales: no avanzar hasta resolver el prerrequisito.
- Resultados vacíos, parciales o sospechosamente estrechos: aplicar una o dos alternativas significativas; no repetir por inercia.
- Datos grandes y deterministas: filtrar, deduplicar, agrupar o validar mediante código antes de devolverlos al modelo.
- Juicio semántico, citas, aprobaciones y validación final: conservarlos en el agente principal.

## 5. Razonamiento, longitud y tono

El razonamiento es un ajuste final, no una reparación para prompts incompletos.

1. Mantener inicialmente el nivel actual.
2. Evaluar el mismo nivel y uno inferior con el mismo conjunto de casos.
3. Subir sólo si la calidad mejora de forma medible.
4. Usar `low` cuando la latencia importe y pase la evaluación; `medium` como punto equilibrado; `high`/`xhigh` para tareas que demuestren una ganancia; `max` sólo para casos excepcionalmente difíciles.

En lugar de “sé conciso”, definir exactamente qué conservar: decisión, evidencia, advertencias, siguiente acción y formato. Para edición o reescritura, indicar qué preservar (hechos, tono, longitud, estructura y género) y qué mejorar.

## 6. Protocolo de evaluación

No sustituir un prompt que funciona de golpe. Crear un conjunto de evaluación con al menos:

- 3 casos felices representativos;
- 2 casos límite;
- 2 entradas incompletas o contradictorias;
- 1 caso de autorización o seguridad;
- 1 caso de recuperación de herramienta, si aplica.

Para cada variante registrar:

| Campo | Medición |
| --- | --- |
| Corrección | Cumple todos los criterios de éxito. |
| Completitud | No omite campos, decisiones o advertencias requeridas. |
| Fundamentación | Distingue evidencia, inferencia y desconocido; cita cuando corresponde. |
| Seguridad | Respeta permisos y no ejecuta acciones no autorizadas. |
| Formato | Cumple el contrato sin limpieza manual. |
| Eficiencia | Tokens, latencia, llamadas y costo, sin sacrificar los indicadores anteriores. |

Cambiar una variable por iteración: prompt, conjunto de herramientas, modelo o razonamiento. Conservar los mismos casos para comparar. El ganador es el menor diseño que supera el umbral de calidad acordado.

## 7. Prompt de auditoría reutilizable

```md
Actúa como especialista en diseño de prompts para OpenAI GPT-5.6.

Audita el prompt proporcionado y propón una versión mejorada. No inventes requisitos: diferencia lo que observas de lo que falta.

Objetivo de la auditoría:
- maximizar el cumplimiento verificable del resultado;
- minimizar contexto, reglas y herramientas innecesarias;
- preservar seguridad, permisos, evidencia, formato y compatibilidad;
- recomendar el perfil Luna, Terra o Sol con una justificación breve.

Evalúa el prompt contra: objetivo, criterios de éxito, contexto/fuente de verdad, restricciones, permisos, herramientas, salida, parada, validación y contradicciones.

Entrega:
1. Diagnóstico: fortalezas, ambigüedades, contradicciones y riesgos.
2. Recomendación de modelo y nivel de razonamiento inicial.
3. Prompt mejorado listo para usar.
4. Cambios realizados y el fallo que corrige cada uno.
5. Casos de evaluación y métricas para validar la mejora.

Si faltan datos que cambian materialmente el diseño, formula sólo las preguntas mínimas necesarias. No implementes ni ejecutes acciones externas.
```

## 8. Lista de salida

Antes de aprobar un prompt, confirmar:

- [ ] El objetivo es concreto y está orientado al resultado.
- [ ] Los criterios de éxito y la condición de parada son verificables.
- [ ] Las fuentes permitidas y los datos faltantes están definidos.
- [ ] No hay reglas repetidas, contradictorias ni genéricas sin efecto.
- [ ] Los permisos distinguen análisis, cambio local y acciones externas.
- [ ] Las herramientas son mínimas y tienen ruta de recuperación.
- [ ] El formato de salida permite validación automática o revisión clara.
- [ ] Modelo y razonamiento fueron elegidos según casos de uso y evaluación.
- [ ] Existe un conjunto de casos que cubre errores y casos límite.

## Referencia

- OpenAI, [Model guidance — GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6), sección “Prompting best practices”. Consultado el 2026-08-29.
