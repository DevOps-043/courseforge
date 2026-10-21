# Análisis de limpieza editorial de plantillas HTML

Fecha: 2026-10-21. Estado: **auditoría ejecutada; política de limpieza propuesta**.
Este informe no acredita la implementación de las acciones propuestas.

## Contexto y alcance

- Actor: administrador que importa diseños para reutilizarlos con el agente.
- Objetivo: conservar composición, tipografías y recursos de diseño; evitar que
  el nuevo curso herede fechas, nombres, afirmaciones, citas y datos del ejemplo.
- Base: rama `codex/fix-imported-slide-visual-preview`, con la implementación de
  fidelidad anterior todavía sin integrar. Se conserva ese trabajo y el cambio
  concurrente en `supabase/migrations/BD.sql`.
- Alcance de esta iteración: analizar el archivo real y simular el comportamiento
  del importador/renderizador actuales, producir inventario y criterios concretos.
- No objetivos: modificar ahora la política del producto, eliminar archivos,
  ejecutar el HTML, hacer OCR, llamar modelos, usar secretos o escribir en remoto.
- Dominios futuros: clasificación editorial, contrato de campos, revisión UI,
  renderizado, validación de contenido y empaquetado; no cambia motion.
- Autoridad: el análisis no concede permisos. Cualquier clasificación futura del
  agente es una propuesta de datos que el servidor valida bajo la organización.

## Método y evidencia primaria

Se leyó `SofLIA_Highlands_Premium_EN_v4.html` (22 850 884 bytes), SHA-256
`271ece268c6fcedac394246776a9d5991293ce046ddc0453d2a2201e629586e3`.
Se usaron la preparación, análisis y renderizador reales compilados desde el
workspace. Para cada diseño se generó localmente una diapositiva con título y
contenido nuevos y se comprobó qué campos seguían mostrando su muestra original.
Las categorías de este informe son heurísticas de auditoría; no se aplicaron
como cambios de rol ni decisiones automáticas al producto.

Resultado y ubicaciones por campo en
[el inventario completo](content-cleanup-inventory.json). No contiene base64,
fuentes ni imágenes; sí textos del archivo del usuario, para revisión local.
La simulación no ejecutó scripts ni invocó el agente de copy. No constituye una
prueba end-to-end de generación pagada o de persistencia remota.

## Hallazgos comprobados

Hay **16 diseños y 375 campos**. El clasificador actual asigna 16 títulos,
239 campos de contenido y **120 campos de decoración**. En la simulación,
los 120 decorativos conservan su texto original.

| Grupo auditado | Campos | Conservan el original al generar | Tratamiento propuesto |
| --- | ---: | ---: | --- |
| Marca textual | 16 | 16 | Conservar solo una marca aprobada para la organización; sustituir las ajenas |
| Pie de presentación | 15 | 15 | Vaciar contexto anterior; fecha, institución y versión no pasan al nuevo curso |
| Paginación original | 15 | 15 | Retirar la numeración anterior; generar la del nuevo deck |
| Categoría de sección | 15 | 15 | Convertir en campo contextual del nuevo tema |
| Referencia documental en enlace | 16 | 0 | Vincular a fuentes del contenido nuevo o retirar; no tratar como párrafo genérico |
| Etiqueta de eje | 26 | 26 | Conservar solo si el eje y los datos siguen siendo válidos; requiere revisión del gráfico |
| Número de paso o bibliografía | 9 | 9 | Regenerar con la estructura; no borrar por ser numérico |
| Cifra o signo aislado | 9 | 2 | Distinguir valor de dato, escala y separador; no usar una regla general de borrado |
| Otro contenido de ejemplo | 254 | 22 | Sustituir contenido; mantener solamente etiquetas estructurales revisadas |
| **Total** | **375** | **120** | |

Las categorías son excluyentes, según DOM y texto; no representan 375 bloques
semánticos independientes. El texto mixto genera varios campos de una misma
frase. Las cifras/signos tampoco equivalen al total de datos cuantitativos.

### Metadatos que deben salir de la plantilla reutilizable

Los 15 pies conservan `SofLIA · Highlands institutional discussion · October 2026`,
a veces precedido por numeración y seguido de `v3.0`. También quedan 15 folios
como `02 / 16`. Son 30 campos de contexto de presentación anterior. La fecha y
la versión no deben inferirse de la fecha del sistema; se omiten o se generan
desde metadatos explícitos del nuevo curso. El total de páginas se calcula al final.

### Contenido que hoy queda fijado por error

- Portada, diapositiva 1: `for Educational Institutions` queda como decoración.
- Diapositiva 2: `Highlands International School México` queda como decoración.
- Diapositivas 4 y 13: categorías y etiquetas de gráficas quedan fijas.
- Diapositiva 6: títulos de los tres pasos quedan fijos.
- Diapositivas 8, 10, 11 y 12: subtítulos como `Teaching staff`,
  `Diagnosis and baseline` y `Costs to include` quedan fijos.
- Las 15 categorías superiores, como `Global skills outlook` o
  `Company survey · 2026`, se conservan aunque cambie el tema.

Además de pies y folios, hay **22 campos de contenido de ejemplo y 15 categorías
de sección** retenidos. No son elementos de decoración por el hecho de estar en
`span`, `div` o en un encabezado secundario.

Hay 24 campos con `Highlands` o `Alejandro Bravo`; 16 sobreviven: los 15 pies y
el nombre de la institución en la diapositiva 2. Los demás ya son campos de
título/contenido y la simulación los sustituye. Esto evita atribuir al importador
una retención de nombres que en esos campos ya se reemplazan correctamente.

### Fechas que no se deben borrar indiscriminadamente

Hay **42 campos que contienen un año**. Incluyen los 15 pies, pero también
referencias bibliográficas, `2025 and 2030`, `training by 2030` y `2020 analysis`.
Son funciones diferentes. Un año dentro de una afirmación o cita no es basura
visual; se sustituye con su bloque semántico o se conserva si ese contenido se
elige expresamente y se valida su fuente. `Days 1–15` describe un plazo, no la
fecha de creación de la presentación.

### Gráficas: riesgo mayor que conservar una fecha

Se identifican gráficos cuantitativos en las diapositivas **3, 4, 5, 9, 13 y 15**:
`existing-skills-chart`, `workflow-redesign-chart`, `employer-gap-chart`,
`training-waffle`, `clerical-potential-chart`, `productivity-ebit-chart` y
`historical-range-chart`. La diapositiva 10 añade un cronograma de 90 días.

El perfil actual sustituye texto pero no vincula los datos de esas figuras a su
geometría. Cambiar `39%` no recalcula la longitud de una barra; cambiar una etiqueta
no recalcula un waffle ni su denominador. Un nuevo texto sobre un gráfico anterior
puede producir una afirmación falsa aunque la composición se vea perfecta.

Hasta disponer de bindings completos, esos diseños requieren revisión y deben
quedar fuera de la selección automática de plantillas genéricas. No basta con
borrar los números y conservar la figura como decoración. El cronograma también
necesita validar plazos, etapas y posiciones como una unidad.

### Referencias y otras superficies de texto

Los 16 campos de enlaces documentales están hoy asignados a contenido, por lo
que se sustituyen en la simulación. Eso evita conservar su texto literalmente,
pero no establece correspondencia entre la cita nueva y una fuente real.
Bibliografía, autor, título, año y nota metodológica requieren un binding de fuente.

En este archivo no se encontraron elementos de texto SVG ni declaraciones CSS
`content`. Hay 16 elementos `img`; el análisis no hizo OCR de sus píxeles.
En otros archivos también habrá que revisar texto dentro de SVG, imágenes,
pseudoelementos y atributos accesibles. Ocultar texto con CSS no lo elimina del
HTML ni garantiza retirarlo de accesibilidad o de un export.

## Causa técnica

La inferencia actual en
`apps/web/src/domains/production/slides/import/imported-slide-design.service.ts`
elige un título, trata `p/li` y descendientes como contenido y usa decoración
para el resto. El rol representa un tag HTML, no la función del texto.

`imported-slide-renderer.service.ts` conserva la muestra de decoración; no
existe un rol de omisión, de metadato generado ni un binding de cita/dato.
La UI permite revisar roles, pero no explica su clasificación ni muestra un
plan editorial de eliminación. La fidelidad visual comprobada anteriormente
acredita conservación del diseño; no acredita descontextualización del contenido.

## Política propuesta

Separar **función semántica**, **acción** y **binding**. No añadir únicamente
una lista de palabras prohibidas ni asumir que todo número o nombre es removible.

| Acción | Uso | Resultado en la salida |
| --- | --- | --- |
| Conservar | Marca aprobada y elementos estructurales revisados | Permanece el contenido permitido |
| Reemplazar | Título, subtítulo, encabezados de tarjeta y texto contextual | Campo del agente con capacidad y tipo explícitos |
| Omitir | Fecha/versión/contexto anterior sin función requerida | Se vacía el texto en servidor conservando la caja de diseño cuando corresponda |
| Generar | Folio, total de slides y metadatos del curso | Valor calculado o recibido desde contexto autorizado |
| Revisar/bloquear | Citas y gráficos sin binding completo o clasificación ambigua | No entra en selección automática hasta resolver su compatibilidad |

Conservar la fuente revisable y la decisión editorial en una revisión privada;
la salida generada no debe arrastrar texto omitido en HTML, accesibilidad o
exportes. Definir retención de muestras y evitar incluir originales innecesarios
en el contexto del agente o en el artefacto final. Nunca eliminar archivos o
revisiones anteriores como efecto de esta limpieza.

## Algoritmos y agente

1. **Algoritmos deterministas**: inventario, repetición entre slides, pies y
   folios, tags/ancestros, metadatos, bindings declarados, límites y validación de
   salida. Las clases del proveedor son pistas; no conceden autoridad ni son la
   única evidencia para borrar contenido.
2. **Agente opcional y acotado**: proponer función/acción para nombres, marcas,
   citas, fechas contextuales y contenido mixto que las reglas no resuelvan.
   Entregar IDs, acción, motivo, evidencia y confianza; no HTML modificado.
   Recibir solo texto y estructura mínima como datos no confiables, sin herramientas
   de ejecución ni instrucciones provenientes del archivo. No se llamó a un agente
   en esta auditoría ni se presupone un proveedor nuevo.
3. **Servidor**: validar IDs, acciones, capacidades y permisos; aplicar el plan
   revisado y comprobar integridad de salida. La opinión del modelo no sustituye
   un binding matemático o una fuente verificada.
4. **Revisión UI**: original procesado / plantilla propuesta / ejemplo generado;
   motivo visible por campo, edición manual, resumen por slide y confirmación
   del plan. Conservar intactas geometría y recursos salvo decisión explícita.

## Secuencia de implementación propuesta

1. Extender OpenSpec y contrato con función, acción, motivo y bindings opcionales;
   mantener compatibles las plantillas anteriores y sin eliminaciones retroactivas.
2. Extraer un analizador editorial de dominio, separado del saneamiento de seguridad.
3. Añadir omisión y campos contextuales a render y UI; comparar antes/después.
4. Bloquear diseños con datos/citas sin bindings para selección genérica.
5. Añadir generación de folios y bindings completos de fuente/gráfico de forma
   gradual. Incorporar clasificación por agente solo si las reglas medidas resultan
   insuficientes; no es necesaria para retirar los pies y folios de este archivo.

## Criterios verificables y riesgos

- Los 15 pies y 15 folios anteriores desaparecen de la salida limpia; el original
  sigue disponible exclusivamente para revisión autorizada.
- El texto de portada y la institución de la diapositiva 2 son sustituibles.
- Una fecha de pie y un año de referencia reciben tratamientos diferentes.
- Un folio calculado corresponde al nuevo número de slides, no a las 16 originales.
- Datos, ejes, denominadores y geometría deben estar vinculados o el diseño se
  rechaza para uso genérico; no se admite texto nuevo sobre datos anteriores.
- Una cita no se rellena con un párrafo arbitrario del curso ni se inventa.
- La omisión elimina texto real, sin depender únicamente de `display:none`.
- La revisión reinicia confirmación si cambia cualquier decisión; la generación
  utiliza el mismo plan que el preview y valida tenant, IDs y versión.
- Comparación visual: solo se aceptan diferencias dentro de las regiones de texto
  modificadas explícitamente. La prueba anterior de identidad completa sigue siendo
  útil para el modo de conservación, pero no debe exigirse a una limpieza deliberada.
- Las propuestas de un modelo malformadas o manipuladas por el HTML se rechazan.

Validación de esta auditoría: simulación de los 16 layouts, recuentos sobre 375
campos y coherencia entre decoración y retención. No se cambiaron contratos/UI ni
se repitieron suites de producto: esta iteración añade únicamente evidencia y
documentación. La auditoría fue del mismo agente, no una revisión independiente.
