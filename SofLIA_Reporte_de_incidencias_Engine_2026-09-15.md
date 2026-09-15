**SofLIA**

**Reporte de incidencias — SofLIA Engine**

**Fecha:** martes 15 de septiembre de 2026

| Versión 1.0 | Responsable: Israel Martínez |
| :---- | :---- |

# **1\. Revisión del flujo completo**

Se realizó una revisión del **flujo completo del pipeline principal de generación de SofLIA Engine**.

Actualmente, **se mantienen las incidencias reportadas anteriormente**, principalmente en las primeras etapas del proceso de generación.

# **2\. Primer paso — Generación de estructura**

Actualmente, el primer paso del pipeline **no logra completar la generación**.

Durante las pruebas se generaron **dos artefactos con el mismo título**. El origen fue el siguiente:

1. Se creó un nuevo artefacto y se completó la información requerida.  
2. Se seleccionó “Generar estructura”.  
3. Al no observarse una respuesta inmediata, se hizo clic nuevamente en el botón.  
4. Posteriormente, se salió del proceso.  
5. Como resultado, quedaron dos artefactos duplicados con el mismo título.

Aunque ambos artefactos aparentan estar en ejecución, **realmente no se está generando la información base de los cursos**.

|  | Incidencia El proceso aparenta estar activo, pero no existe un avance real en la generación. |
| :---- | :---- |

&nbsp;

# **3\. Generación de materiales y búsqueda de fuentes**

También se identificaron problemas en las etapas de:

* **Generación de materiales.**  
* **Búsqueda de fuentes.**

El comportamiento es **irregular e incierto**.

En algunos casos, aparentemente el proceso avanza y genera información, pero al finalizar se detecta que **un porcentaje de las lecciones queda sin fuentes que fundamenten su contenido**.

Esto genera dudas sobre si el proceso realmente terminó correctamente o si finalizó de manera incompleta.

# **4\. Comportamiento al cancelar o repetir el proceso**

La situación se vuelve especialmente problemática al intentar corregir el proceso.

Cuando se cancela la generación o se vuelve a ejecutar, el sistema puede permanecer **cargando durante un periodo prolongado**.

Actualmente se presentan dos comportamientos:

* El proceso permanece cargando y no queda claro si continuará.  
* El proceso termina, pero no existe certeza de que haya completado toda la información requerida, particularmente las fuentes de las lecciones.

|  | Observación Esto dificulta determinar si una generación fue exitosa o si requiere volver a ejecutarse. |
| :---- | :---- |

&nbsp;

# **5\. Posible relación con créditos**

Por el comportamiento observado, **podría existir una relación con el consumo o disponibilidad de créditos**, aunque esto no está confirmado.

La irregularidad tanto en la generación de materiales como en la búsqueda de fuentes hace necesario revisar si existe algún límite, condición o dependencia relacionada con los créditos utilizados durante estas etapas.

**Este punto queda como hipótesis para validación técnica**, no como causa confirmada.

# **6\. Estado actual**

Por el momento, **no se han realizado pruebas adicionales sobre otras funcionalidades de Engine**.

La revisión se ha concentrado exclusivamente en el **pipeline principal de generación**, particularmente en las primeras etapas del flujo.

## **Prioridades actuales**

| Prioridad | Punto | Estado |
| :---: | :---- | :---: |
| **Alta** | Generación de estructura | 🔴 No completa |
| **Alta** | Generación de materiales | 🔴 Irregular |
| **Alta** | Búsqueda y asignación de fuentes | 🔴 Irregular / incompleta |
| **Alta** | Procesos que permanecen cargando | 🔴 Incierto |
| **Media** | Duplicación de artefactos al ejecutar dos veces | 🟠 Incidencia detectada |
| **Por validar** | Posible relación con créditos | 🟡 Hipótesis |

**Conclusión:** el principal bloqueo continúa estando en el inicio del pipeline de generación. Mientras esta etapa no sea consistente y verificable de principio a fin, no se ha continuado con la validación del resto de funcionalidades de SofLIA Engine.