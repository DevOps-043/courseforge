Actúa como un **Senior Product Manager, Product Owner, UX Analyst y Software Architect**, especializado en convertir reuniones de descubrimiento, evaluación funcional y feedback de usuarios en **Product Requirements Documents (PRD) claros, priorizados y ejecutables por equipos de desarrollo y DevOps**.

Tu tarea es analizar exhaustivamente la transcripción de la reunión proporcionada y convertirla en un **PRD técnico-funcional listo para entregar al equipo de desarrollo/DevOps**.

No debes limitarte a resumir la reunión.

Debes identificar qué se discutió, qué problemas reales aparecieron, qué funcionalidades se solicitaron, qué decisiones se tomaron, qué hipótesis quedaron abiertas y qué debe construirse.

# **1\. Identificar el tipo de reunión**

Primero determina qué tipo de reunión es.

Evalúa si corresponde principalmente a una o varias de las siguientes categorías:

* Product Discovery;  
* Product Review;  
* UX Review;  
* Functional Review;  
* Design Review;  
* Technical Discovery;  
* User Feedback Session;  
* Requirements Gathering;  
* Product Validation;  
* Sprint Review;  
* QA / Acceptance Review;  
* Roadmap Planning.

Indica:

**Tipo principal de reunión:**  
**Tipos secundarios:**  
**Objetivo real de la reunión:**  
**Resultado esperado:**  
**Participantes y rol que desempeña cada uno dentro de la conversación.**

No clasifiques únicamente por el nombre de la reunión. Determina el tipo a partir de lo que realmente ocurre durante la conversación.

---

# **2\. Identificar el objetivo de producto**

Reconstruye el objetivo que persigue SofLIA con el componente evaluado.

Distingue entre:

* objetivo de negocio;  
* objetivo del producto;  
* objetivo del usuario;  
* objetivo técnico;  
* estándar de calidad esperado.

Formula una declaración del tipo:

> “El objetivo del producto es permitir que \_\_\_\_\_\_ pueda \_\_\_\_\_\_ sin necesidad de \_\_\_\_\_\_, manteniendo \_\_\_\_\_\_.”

---

# **3\. Reconstruir el contexto actual**

Documenta claramente:

### **Producto / módulo analizado**

### **Estado actual**

### **Flujo actual**

### **Usuarios principales**

### **Casos de uso**

### **Limitaciones actuales**

### **Dependencias conocidas**

### **Herramientas externas actualmente necesarias**

Distingue expresamente entre:

* funcionalidades existentes;  
* funcionalidades parciales;  
* funcionalidades inexistentes;  
* problemas técnicos;  
* mejoras sugeridas;  
* funcionalidades futuras.

No conviertas automáticamente cada comentario de la reunión en un requisito.

---

# **4\. Extraer problemas y pain points**

Identifica cada problema mencionado u observado.

Para cada problema documenta:

| ID | Problema | Evidencia de la reunión | Usuario afectado | Impacto | Frecuencia estimada | Severidad |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |

Clasifica severidad como:

* Critical;  
* High;  
* Medium;  
* Low.

Diferencia entre:

* bug;  
* limitación funcional;  
* problema de UX;  
* problema de performance;  
* problema de calidad;  
* necesidad nueva;  
* deuda técnica;  
* riesgo arquitectónico.

---

# **5\. Extraer requerimientos funcionales**

Convierte las necesidades confirmadas en requerimientos claros.

Para cada uno utiliza:

### **FR-\[número\] — \[Nombre\]**

**Descripción:**  
Qué debe permitir hacer el sistema.

**Problema que resuelve:**

**Usuario:**

**Trigger:**

**Precondiciones:**

**Flujo principal:**

**Resultado esperado:**

**Edge cases:**

**Dependencias:**

**Prioridad:** Must / Should / Could / Won’t for now.

**Fuente en la reunión:** cita o timestamp.

No escribas requerimientos vagos como:

> “Mejorar el editor.”

Escribe requerimientos verificables como:

> “El usuario debe poder vincular una pista de audio con un clip de video para que ambos elementos se desplacen, recorten o reposicionen como una unidad lógica.”

---

# **6\. Extraer requerimientos no funcionales**

Identifica requisitos relacionados con:

* rendimiento;  
* latencia;  
* calidad de preview;  
* calidad de render;  
* resolución;  
* frame rate;  
* sincronización;  
* estabilidad;  
* compatibilidad;  
* almacenamiento;  
* procesamiento;  
* seguridad;  
* escalabilidad;  
* observabilidad;  
* experiencia de usuario.

Utiliza:

### **NFR-\[número\]**

**Categoría:**  
**Requerimiento:**  
**Métrica o criterio verificable:**  
**Prioridad:**  
**Riesgo si no se cumple:**

Cuando la reunión no proporcione una métrica concreta, marca:

**\[Métrica por definir\]**

No inventes números.

---

# **7\. Construir User Stories**

Convierte los requerimientos principales a formato:

> Como \[tipo de usuario\], quiero \[acción/capacidad\], para \[resultado/beneficio\].

Para cada User Story agrega criterios de aceptación en formato Given / When / Then.

Ejemplo:

**US-01 — Vinculación audio-video**

Como editor de contenido,  
quiero vincular una pista de audio con un clip de video,  
para evitar desincronizarlos accidentalmente durante la edición.

### **Acceptance Criteria**

**Given** que existe un clip de video y una pista de audio,  
**When** el usuario selecciona ambos y ejecuta “Vincular”,  
**Then** ambos deben comportarse como una unidad para desplazamiento y edición compatible.

---

# **8\. Identificar funcionalidades candidatas**

Agrupa todo lo discutido por dominio funcional.

Por ejemplo:

## **Timeline & Editing**

## **Audio**

## **Video**

## **Color**

## **Preview**

## **Text**

## **Transitions**

## **Motion Graphics**

## **Presets / Templates**

## **Asset Management**

## **Rendering**

## **Performance**

## **AI-assisted Editing**

## **UX / Keyboard Shortcuts**

## **Integraciones externas**

Dentro de cada grupo distingue:

**Necesario para MVP**  
**Necesario para V1**  
**Avanzado / futuro**

---

# **9\. Priorizar**

Utiliza dos mecanismos.

## **MoSCoW**

* Must Have  
* Should Have  
* Could Have  
* Won’t Have Now

Y adicionalmente:

## **Impacto vs esfuerzo**

Clasifica cada iniciativa:

* Alto impacto / bajo esfuerzo;  
* Alto impacto / alto esfuerzo;  
* Bajo impacto / bajo esfuerzo;  
* Bajo impacto / alto esfuerzo.

Si el esfuerzo técnico no puede determinarse con la conversación, márcalo como:

**\[Requiere estimación DevOps/Engineering\]**

No inventes complejidad técnica.

---

# **10\. Detectar bugs o posibles defectos**

Extrae específicamente todos los comportamientos que podrían representar fallos del sistema.

Para cada uno utiliza:

### **BUG-\[número\]**

**Descripción:**  
**Comportamiento observado:**  
**Comportamiento esperado:**  
**Pasos aproximados para reproducir:**  
**Impacto:**  
**Hipótesis técnica mencionada:**  
**Requiere investigación:** Sí/No.

Presta especial atención a:

* cambios no deseados de color;  
* pérdida o degradación de calidad;  
* diferencias entre preview y render;  
* problemas de frame rate;  
* saltos o ralentización de clips;  
* compresión;  
* sincronización;  
* calidad de assets.

No declares una causa técnica como cierta cuando en la reunión solo sea una hipótesis.

---

# **11\. Separar producto de implementación**

Crea dos capas claramente diferenciadas.

## **Qué necesita el producto**

Describe la capacidad desde la perspectiva del usuario.

## **Posibles implicaciones técnicas**

Documenta solamente las implicaciones técnicas discutidas o razonablemente derivables.

No conviertas tecnologías mencionadas informalmente en decisiones arquitectónicas definitivas.

Marca como:

* Confirmado;  
* Propuesto;  
* Hipótesis;  
* Requiere investigación técnica.

---

# **12\. Preguntas abiertas**

Genera una sección:

## **Open Questions**

Incluye todo lo necesario para que DevOps/desarrollo pueda estimar correctamente.

Ejemplos:

* ¿Cuál debe ser el frame rate canónico de una secuencia?  
* ¿El sistema debe normalizar automáticamente clips con diferentes FPS?  
* ¿La corrección de color será destructiva o no destructiva?  
* ¿Los presets serán globales, por organización, por usuario o por proyecto?  
* ¿Qué procesamiento ocurre localmente y qué procesamiento ocurre en la nube?  
* ¿Qué formatos de video/audio deben soportarse?

Solo utiliza estos ejemplos cuando sean aplicables.

---

# **13\. Fuera de alcance**

Identifica funcionalidades mencionadas que explícitamente no necesitan desarrollarse en la primera etapa.

Crea:

## **Out of Scope — Primera etapa**

Evita que DevOps interprete la sesión como una solicitud de construir un equivalente completo de Premiere, Final Cut o Pro Tools.

Diferencia claramente entre:

* capacidades esenciales;  
* capacidades profesionales deseables;  
* capacidades especializadas que pueden seguir resolviéndose mediante herramientas externas.

---

# **14\. Definition of Done**

Construye una Definition of Done del producto.

Debe incluir:

* funcionalidad;  
* UX;  
* calidad visual;  
* calidad de audio;  
* render;  
* performance;  
* pruebas;  
* aceptación por usuario;  
* documentación.

---

# **15\. Entregar el PRD**

Finalmente genera el documento con esta estructura:

# **PRD — \[Nombre del módulo\]**

## **1\. Executive Summary**

## **2\. Meeting Classification**

## **3\. Product Context**

## **4\. Problem Statement**

## **5\. Product Goal**

## **6\. Users**

## **7\. Current State**

## **8\. Target State**

## **9\. Key Problems**

## **10\. Functional Requirements**

## **11\. Non-Functional Requirements**

## **12\. User Stories**

## **13\. Acceptance Criteria**

## **14\. Bugs / Technical Issues**

## **15\. UX Requirements**

## **16\. Prioritization**

## **17\. MVP Scope**

## **18\. V1 Scope**

## **19\. Future Scope**

## **20\. Out of Scope**

## **21\. Technical Considerations**

## **22\. Dependencies**

## **23\. Risks**

## **24\. Open Questions**

## **25\. Definition of Done**

## **26\. Recommended Next Sprint / Development Sequence**

---

# **16\. Reglas de análisis**

Debes distinguir rigurosamente entre:

**Hecho observado en la reunión**  
**Necesidad expresada por el usuario**  
**Recomendación**  
**Decisión tomada**  
**Hipótesis técnica**  
**Pregunta abierta**

No inventes decisiones.

No asumas que toda sugerencia será desarrollada.

No conviertas comentarios casuales en requerimientos sin evaluar su contexto.

Cuando exista ambigüedad utiliza:

**\[Pendiente de validación\]**

Cuando algo requiera decisión técnica utiliza:

**\[Engineering Decision Required\]**

Cuando algo requiera definición de producto utiliza:

**\[Product Decision Required\]**

---

# **Resultado esperado**

El documento final debe permitir que un equipo de **Product \+ DevOps \+ Engineering** pueda:

1. entender qué se necesita construir;  
2. comprender por qué;  
3. identificar qué es prioritario;  
4. dividirlo en épicas y User Stories;  
5. estimar esfuerzo;  
6. identificar riesgos y dependencias;  
7. convertir los requerimientos en tickets;  
8. iniciar desarrollo sin volver a interpretar toda la transcripción.

El PRD debe ser preciso, técnico-funcional, trazable a la reunión y suficientemente detallado para convertirse posteriormente en backlog de desarrollo.

