# Prompt para la Generación Automática de Reportes

A continuación, tienes un prompt preestructurado. Cuando termines tu jornada, simplemente **copia el texto dentro del bloque inferior**, pégalo en tu IA de preferencia (ChatGPT, Claude, etc.) y **adjunta las capturas de pantalla** de tus tareas en Notion.

---

### Copia desde aquí 👇

**Actúa como un Agile Project Manager y Asistente Técnico Especializado.**

A continuación, te voy a adjuntar una o varias capturas de pantalla de mi tablero de Notion con mis tareas de desarrollo. Tu objetivo es analizar la información visible en las imágenes (nombres de las tareas, etiquetas, estados, prioridades como P0/P1) y generar de forma estructurada **dos reportes** de avance: uno extenso y uno ejecutivo (Daily Pulse).

Por favor, genera tu respuesta siguiendo exactamente esta estructura:

#### 1. Reporte Extenso (Trazabilidad Detallada)

Redacta un reporte técnico, narrativo y detallado que explique el trabajo realizado. Debe incluir:

- **Resumen del día:** Un párrafo sobre el enfoque principal del día.
- **Tareas Completadas (Done):** Lista explicativa de qué se hizo, mencionando las tareas visibles en las capturas.
- **En Testing / Ready for QA:** Lo que está pendiente de validación.
- **Bloqueos / Riesgos:** (Si se infiere alguno de las etiquetas o falta de avance).
  _(Nota: Este reporte es para dejar trazabilidad profunda a otros ingenieros o a mí mismo en el futuro)._

#### 2. Reporte Corto (Daily Pulse)

Llena de manera estricta la siguiente plantilla para que yo pueda copiarla y enviarla rápidamente al equipo y a Ernesto por el grupo. Reemplaza los corchetes con la información extraída de las capturas:

```text
LMS – Daily Pulse | [Fecha actual]
Estado: [🟢 (Todo fluye) / 🟡 (Retrasos menores) / 🔴 (Bloqueado)] ([1 frase corta de justificación])
✅ Done hoy: [Cantidad total] (P0: [Cantidad], P1: [Cantidad])
🧪 Ready for QA: [Cantidad total] (pendiente validar: [Breve mención a los elementos importantes])
🚨 P0 abiertos: [Cantidad total de P0 no terminados] (top 1–2: [Nombres resumidos de los P0 más críticos abiertos])
🔧 Foco siguiente: [Lo próximo a atacar basado en lo que queda pendiente en Backlog o In Progress]
⚠️ Bloqueo/Riesgo: [Menciona si hay algún bloqueo, o "Ninguno"]
🧭 Acción requerida: [Ej. "Revisión de QA" o "Decision sobre X caso", o "Ninguna"]
🔗 Tablero + evidencia: https://www.notion.so/305c808734dc80b5a238df6ab222aa4a?v=305c808734dc8017a382000cc3ab21d6
```

**Reglas Críticas:**

- Infiere el semáforo de "Estado" basándote en lo visible: si hay muchos bloqueos o todo está atorado, usa 🔴; si hay buen volúmen en "Done", usa 🟢.
- Si no logras determinar un número exacto (ej. P0 abiertos no se ven en la captura de pantalla), escribe `[No visible]` en lugar de inventar.
- **Tareas Adicionales (Off-Notion):** Además de analizar mis imágenes, si en mi mensaje de entrada incluyo un texto lista como "Además hice: [tarea 1], [tarea 2]", incluye y cuantifica automáticamente estas tareas como si hubiesen estado en las capturas bajo la categoría "Done hoy", tanto en el reporte extenso como en la suma total del `Daily Pulse`.
- **Formato de Salida:** Toda tu respuesta (ambos reportes) debe estar empaquetada dentro de un único gran bloque de código Markdown (\`\`\`markdown ... \`\`\`), de forma que yo pueda copiar todo con un solo clic para guardarlo como un archivo `.md`.
- Usa un tono profesional, directo y orientado a resultados.

### Fin de copia 👆

---

**Instrucción de uso:**

1. Ve a tu Notion.
2. Toma Capturas de tu columna de _Done_, de _Ready for QA_ y si tienes, de lo que quedó _In Progress/To Do_.
3. Copia el Prompt de arriba, pegalo en la IA y arrastra las imágenes.
4. **(Opcional):** Si hiciste algo que no quedó en Notion, escríbelo en el mismo mensaje. Ej. _"Además de las fotos, arreglé un bug visual en el login y tuve reunión de planning"_.
5. Toma el resultado devuelto (cópialo directo con el botón del bloque de código), guárdalo en un archivo de tu repositorio (ej. `reporte-diario.md`).
6. Copia el texto de la sección "Daily Pulse" de ese reporte y envíalo al grupo.

---

## To do

- [ ] Remover el apartado de Notion del prompt.
- [ ] Hacer el resumen ejecutivo menos técnico y más orientado a resultados.
