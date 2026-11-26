# Prueba autenticada de generación del plan híbrido

Fecha: 2026-11-20. Entorno: Architect local en localhost:3000.
Artefacto: 238c635b-1dab-4997-ab6c-2c2fc85eb080.

## Preparación y ejecución

Se utilizó la sesión autenticada del usuario en Chrome y el formulario del curso
«Prueba local · Comunicación Asertiva en Entornos Remotos». El usuario autorizó
configurar e iniciar la generación del plan. No se accedió a credenciales ni se
modificaron variables de entorno, permisos o SQL.

El temario ya estaba aprobado y el recorrido guardado contenía una sesión para
Hub de 90 minutos y un tramo asíncrono de 600 minutos para Academy. Se mantuvo esa
distribución de prueba. Los 90 minutos son datos de QA, no un acuerdo confirmado
de la reunión de Meet.

La configuración de sesiones mostraba gpt-5.6-luna heredado, prompt code-1. En
Academy se usó el prompt configurado de la empresa, versión 1.0.0, sin edición
personalizada. Los registros del worker confirmaron gpt-5.6-luna para Academy.

Se pulsó «Generar planes de sesiones en vivo» y después «Generar plan de Academy».
El primer botón reservó una unidad, mostró generación activa y deshabilitó otro
inicio y la aprobación mientras estaba en curso. Se observó su finalización
como «Generado».

## Resultados observados

- Hub: sesión «Apertura y fundamentos en vivo», siete bloques de
  8, 10, 15, 5, 30, 15 y 7 minutos; suma de 90 minutos. Se inspeccionaron propósito,
  explicación y actividad de los bloques. Incluye trabajo individual y en equipos.
- Academy: cinco grupos por módulo, procesados secuencialmente, de 3, 4, 4, 4 y 4
  lecciones. El worker registró los acumulados 3, 7, 11, 15 y 19 y finalizó su handler.
- Después de recargar se recuperaron ambos planes. Academy mostró 19 títulos de
  lección diferentes; la lección 1.1, asignada exclusivamente a Hub, quedó fuera.
  El primer módulo comienza en la lección 1.2, conservando la referencia curricular.
- El plan de Academy muestra componentes como diálogo, video, lectura, ejercicio
  y quiz. Esto comprueba planificación, no generación de esos assets.
- No se aprobó automáticamente el contenido pedagógico, no se avanzó a materiales
  ni se publicó o desplegó.

## Hallazgos y límites

1. Academy permaneció en «Cargando plan instruccional» durante la solicitud local.
   Tras completarse el worker se comprobó la persistencia mediante recarga. La
   experiencia de progreso merece ajuste; esta prueba no lo corrige.
2. El contenido nuevo de Hub y el editor siguen usando «Nexus» en referencias de
   continuidad («Conexión con Nexus»). Falta alinear ese vocabulario con Academy.
3. Se probaron los grupos que el worker obtiene de los módulos. No existe un
   selector de lotes manuales en la pantalla de plan inspeccionada. No se probaron
   otros tamaños, interrupciones, reanudaciones o ejecuciones masivas.
4. Los títulos visibles son únicos. No se hizo una auditoría SQL de IDs, ni una
   validación pedagógica exhaustiva o prueba de entrega a Academy/Hub reales.
5. El título persistido del tramo asíncrono aún dice «Estudio y práctica individual
   en Learning»; no se cambió el recorrido durante una generación.

La siguiente prueba debe atender progreso y nomenclatura, revisar el contenido y
su aprobación conjunta, y después avanzar a fuentes/materiales con el contrato de
publicación híbrida aún pendiente según hybrid-pipeline-review.md.
