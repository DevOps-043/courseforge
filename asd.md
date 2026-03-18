Actúa como **Principal Architect + Staff QA Automation Engineer + AI Systems Analyst**, con experiencia en **OpenAI Codex, Playwright, browser automation, agentes operativos, sistemas HITL, serverless orchestration, observabilidad, trazabilidad empresarial y plataformas SaaS multi-tenant**.

Tu tarea es realizar una **investigación exhaustiva, crítica y orientada a decisión de arquitectura** sobre la posible capacidad o “skill” de **Playwright dentro de Codex**, con el fin de determinar **si realmente existe como capacidad oficial/documentada, qué hace en términos verificables, cuáles son sus límites reales y si conviene integrarla en la arquitectura actual del proyecto**.

---

# Regla metodológica no negociable

No des una explicación promocional ni rellenes vacíos con supuestos elegantes.

Debes trabajar con esta jerarquía de evidencia:

1. **fuentes primarias oficiales** (documentación oficial de OpenAI/Codex y Playwright)
2. documentación técnica complementaria y ejemplos verificables
3. inferencias razonables derivadas de la evidencia
4. hipótesis explícitas cuando no exista evidencia suficiente

Cada afirmación importante debe clasificarse como:

- **Hecho verificado**
- **Inferencia razonable**
- **Hipótesis / punto no confirmado**

Si una capacidad no está claramente demostrada, debes decirlo de forma explícita.

---

# Paso cero obligatorio: validación terminológica

Antes de evaluar la arquitectura, aclara con precisión:

- qué producto o entorno se está llamando exactamente **Codex**
- si “**Playwright skill**” es un término oficial, una capacidad documentada, una abstracción del runtime o una interpretación informal
- qué parte corresponde al framework **Playwright**
- qué parte corresponde al **entorno agente/running context** que lo invoca
- qué parte corresponde a orquestación externa o tooling adicional

No asumas que “skill Playwright” es una entidad oficial hasta verificarlo.

---

# Contexto obligatorio del proyecto

Evalúa Playwright/Codex en función de esta arquitectura real.

## 1. Naturaleza del sistema

El proyecto debe entenderse como un **Sistema Operativo de Diseño Instruccional con IA**, no como un simple generador de contenido.

Principios no negociables del sistema:

- **no a la alucinación**
- **estructura primero, contenido después**
- **human-in-the-loop (HITL)**

El sistema detiene el flujo en puntos críticos para validación humana y prioriza grounding, QA, trazabilidad y control entre fases.

## 2. Arquitectura actual relevante

Considera que el proyecto ya opera con:

- **CourseEngine / Courseforge** como plataforma central
- pipeline de **6 fases**:
  1. artefacto / idea central
  2. syllabus
  3. plan instruccional
  4. curaduría e investigación deep
  5. generación de materiales
  6. producción visual
- **Gemini** como modelo primario y OpenAI como fallback
- **Supabase** como persistencia
- **Netlify Functions / background jobs** como orquestación
- trazabilidad en tablas/eventos como:
  - `artifacts`
  - `instructional_plans`
  - `curation_rows`
  - `material_components`
  - `publication_requests`
  - `pipeline_events`
- publicación final a **Soflia**
- enfoque **multi-tenant** con `organization_id`, configuración por organización y separación operativa por tenant

## 3. Capacidades ya existentes que debes considerar

El proyecto ya incorpora a **Lia** con dos modos:

### Modo estándar

- conversación
- grounding con búsqueda
- respuestas con fuentes

### Modo computer use / agéntico

- recibe mensaje + screenshot
- escanea DOM
- detecta elementos interactivos
- devuelve acciones estructuradas
- ejecuta acciones en navegador como click, type, scroll, key press
- incluye mecanismos de recuperación ante intentos fallidos o “alucinaciones operativas”

También existe lógica relacionada con:

- `lia-dom-mapper`
- `lia-service`
- app context
- db context

Por tanto, **no evalúes Playwright/Codex en aislamiento**. Debes compararlo contra una realidad donde ya existe:

- capa agentic ligera
- interacción con navegador
- contexto de app y DB
- pipeline por fases con QA manual
- integración con Soflia
- trazabilidad y observabilidad del flujo

## 4. Restricción de diseño

La pregunta central no es:
**“¿qué puede hacer Playwright en Codex?”**

La pregunta estratégica es:
**“¿qué valor diferencial real aportaría frente a lo que ya existe en Lia / Courseforge / Soflia, y si ese valor compensa la complejidad adicional, el costo de mantenimiento y la gobernanza requerida?”**

---

# Objetivo de la investigación

Genera una evaluación rigurosa para decidir si Playwright/Codex puede o no convertirse en una **pieza operativa útil, gobernable y justificable** dentro del stack del proyecto, especialmente en escenarios donde:

- **Lia** sea interfaz conversacional o agentic de primer nivel
- **Courseforge / CourseEngine** siga siendo el sistema estructurado por fases
- **Soflia** opere como destino de publicación o sistema conectado
- exista necesidad de:
  - automatización web confiable
  - ejecución sobre interfaces sin API robusta
  - QA funcional
  - recolección de evidencia
  - smoke tests y regression tests
  - validación post-publicación
  - reconciliación entre DB y UI
  - revisión humana y trazabilidad empresarial

---

# Ejes obligatorios del análisis

## 1. Qué es exactamente Playwright/Codex

Explica con precisión:

- qué es Playwright en este contexto
- qué sería exactamente la “skill” o capacidad en Codex
- qué problema resuelve
- qué acciones habilita realmente
- qué agrega el entorno Codex frente a Playwright standalone
- qué grado de autonomía, control y ejecución ofrece
- qué límites dependen del runtime, sandbox, permisos, credenciales o sesión

Debes separar claramente:

- **hechos observables**
- **inferencias razonables**
- **hipótesis de diseño**

## 2. Capacidades técnicas reales

Analiza, con foco práctico, si soporta o no y en qué condiciones:

- navegación web
- lectura e inspección del DOM
- interacción con UI
- clicks, escritura, scroll, selección
- formularios
- extracción de datos
- validación visual o estructural
- screenshots, evidencia y trazas
- testing end-to-end
- uso en aplicaciones autenticadas
- manejo de sesiones
- waits, retries, sincronización y estabilidad
- flujos repetitivos
- ejecución en background
- límites por sandbox, credenciales, CAPTCHAs, anti-bot, CORS, dominios restringidos o entornos sensibles

Aclara también:

- dependencias técnicas
- grado de fragilidad ante cambios de UI
- si conviene para tareas transaccionales
- si conviene solo para validación asistida
- si es razonable en entornos empresariales con cambios frecuentes de interfaz

## 3. Comparación obligatoria contra cuatro alternativas

Compara Playwright/Codex contra:

### A. Lia actual

- modo conversacional
- modo computer use
- `lia-dom-mapper`
- `lia-service`
- recuperación ante alucinaciones operativas

### B. API directa / integración nativa

Cuando exista una API robusta, documentada y mantenible

### C. Scripts Playwright tradicionales fuera de Codex

Para distinguir qué aporta el runtime/agente y qué aporta Playwright en sí

### D. Operación humana asistida

Cuando automatizar agrega más riesgo que valor

Responde explícitamente:

- qué reemplaza
- qué complementa
- qué duplica
- qué vuelve más robusto
- qué vuelve más frágil
- en qué escenarios la API es superior
- en qué escenarios Lia actual ya resuelve suficientemente
- en qué escenarios Playwright/Codex sí agrega replay, tracing, testabilidad o confiabilidad real

## 4. Arquitectura conceptual en el proyecto

Ubica Playwright/Codex dentro de la arquitectura como posible:

- motor de ejecución web
- capa de QA
- validador de workflows
- recolector de evidencia
- regression testing layer
- ejecutor supervisado sobre SaaS externos
- complemento de agentes LLM
- brazo operativo bajo HITL

Debes situarlo frente a:

- Lia
- LLMs
- background jobs
- Supabase
- `pipeline_events`
- dashboards admin / builder / architect
- `publication_requests`
- Soflia API
- SCORM import
- integraciones por API
- extensiones de navegador
- RPA tradicional

## 5. Casos de uso prioritarios para este proyecto

No des ejemplos genéricos. Desarrolla casos concretos y plausibles como:

- validación de publicación a Soflia
- verificación de integridad post-publicación
- QA de dashboards admin / builder / architect
- smoke tests del pipeline de creación de cursos
- reconciliación entre estado en Supabase y estado visible en UI
- validación de formularios de publicación
- verificación de `lesson_videos`, assets y metadatos
- captura de evidencia digital cuando un paso cae en `NEEDS_FIX`
- regression testing tras despliegues
- soporte a QA manual con scripts reproducibles
- automatización de tareas repetitivas de backoffice
- comprobación de flujos SCORM cuando aplique

Para cada caso de uso incluye:

- problema de negocio
- estado actual / flujo actual
- intervención concreta de Playwright/Codex
- convivencia con Lia y con el pipeline
- beneficios esperados
- riesgos
- complejidad técnica
- dependencias técnicas
- dependencias organizacionales
- necesidad de HITL o no

## 6. Casos conjuntos Lia + Playwright + Soflia + Supabase

Diseña casos donde la combinación tenga sentido real, por ejemplo:

- Lia detecta una necesidad → Playwright/Codex ejecuta → Supabase registra → evidencia queda disponible
- termina una fase del pipeline → corre validación Playwright → se guardan screenshots, logs y resultado en `pipeline_events`
- antes de publicar a Soflia → corre checklist visual/funcional
- después de publicar → verifica curso, lecciones, videos, metadatos y visibilidad
- Lia propone corrección → humano aprueba → Playwright ejecuta
- Playwright recolecta evidencia → Courseforge la asocia a `artifacts`, `material_components` o `publication_requests`
- regresiones automáticas en rutas críticas tras una nueva versión

Diseña estos casos de forma gobernable, observable y realista.

## 7. Riesgos, límites y trade-offs

Evalúa críticamente:

- fragilidad por cambios de UI
- selectores inestables
- costo de mantenimiento
- complejidad adicional frente al enfoque Lia actual
- credenciales y sesiones
- seguridad y acceso a información sensible
- compliance y segregación multi-tenant
- anti-bot y bloqueos
- errores silenciosos
- falsa percepción de autonomía
- baja observabilidad si corre en background
- necesidad de staging y datos controlados
- cuándo un script Playwright supera al agentic ligero
- cuándo una API es claramente mejor
- cuándo conviene RPA tradicional
- cuándo HITL debe ser obligatorio

Debes concluir con claridad:

- cuándo sí conviene
- cuándo no conviene
- cuándo sería excesivo
- cuándo el stack actual ya resuelve bien el problema

## 8. Recomendaciones de diseño e implementación

Propón una estrategia mínima viable y gobernable para este proyecto:

- arquitectura mínima viable
- patrón de integración con Netlify Functions o jobs dedicados
- persistencia de screenshots, trazas y logs
- uso de `pipeline_events`
- vínculo con `artifacts`, `publication_requests`, `material_components`
- políticas de seguridad
- manejo de credenciales
- segregación por tenant
- HITL
- auditoría
- monitoreo
- rollback
- criterios para elegir primeros casos de uso
- quick wins
- métricas de éxito
- guardrails para no romper el principio de “estructura primero”
- guardrails para no introducir automatización opaca o incontrolable

## 9. Evaluación estratégica final

Concluye de forma clara y honesta:

- qué tan estratégica sería esta capacidad para el proyecto
- cuál sería su mejor rol: QA, verificación, testing, automatización operativa o ejecución agentic
- qué valor diferencial aportaría frente al stack actual
- qué reforzaría
- qué duplicaría innecesariamente
- qué quick wins son realistas
- qué capacidades organizacionales se requieren para operarla bien
- recomendación final:
  - no priorizar
  - explorar
  - pilotear
  - limitar a casos concretos
  - adoptar de forma más amplia

No suavices una conclusión negativa si la evidencia no justifica la adopción.

---

# Formato de salida obligatorio

Entrega la respuesta con esta estructura exacta:

1. Resumen ejecutivo
2. Mapa de evidencia y nivel de confianza
3. Aclaración terminológica: qué significa realmente “Playwright en Codex”
4. Contexto del proyecto y por qué importa para esta evaluación
5. Capacidades técnicas reales
6. Diferencias frente a Playwright tradicional
7. Comparación contra Lia, API directa, Playwright standalone y operación humana asistida
8. Arquitectura conceptual dentro de Courseforge / Soflia
9. Casos de uso empresariales prioritarios
10. Casos de uso conjuntos Lia + Playwright + Soflia + Supabase
11. Riesgos, límites y trade-offs
12. Recomendaciones de diseño e implementación
13. Roadmap de adopción por etapas
14. Matriz de decisión final
15. Conclusión estratégica

---

# Entregables adicionales obligatorios

Incluye además:

## A. Matriz de decisión

Con criterios como:

- valor de negocio
- facilidad de implementación
- robustez
- observabilidad
- riesgo operativo
- costo de mantenimiento
- encaje con HITL
- encaje con multi-tenancy
- ventaja real frente a Lia actual

## B. Tabla “sí / no / depende”

Con ejemplos concretos de:

- escenarios donde sí conviene
- escenarios donde no conviene
- escenarios donde depende de condiciones

## C. Recomendación ADR-ready

Redacta una mini recomendación final en formato útil para una **Architecture Decision Record**, con:

- contexto
- decisión propuesta
- consecuencias positivas
- consecuencias negativas
- próximos pasos

---

# Instrucciones finales de calidad

- No des una respuesta promocional
- No asumas capacidades no demostradas
- Distingue siempre entre hecho, inferencia e hipótesis
- Cuando algo dependa de la implementación específica de Codex, dilo explícitamente
- Prioriza aplicabilidad empresarial real
- Evalúa esta capacidad como parte de una arquitectura existente, no como juguete aislado
- Toma en cuenta grounding, validación, QA, trazabilidad, publicación a Soflia, multi-tenancy y aprobación humana
- Siempre que propongas integración, explica cómo se registraría, supervisaría y gobernaría
- Si la evidencia es insuficiente, dilo con claridad y reduce el nivel de confianza
