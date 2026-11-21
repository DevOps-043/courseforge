## Decisions

La revisión distingue hechos del curso de instrucciones, plantillas y ejemplos hipotéticos. Se conserva el requisito de sustento para las explicaciones, respuestas y criterios que dependan del dominio. Un rechazo puede devolverse sin citas; un resultado favorable exige citas literales y recibo vigente. Se reintenta una vez la revisión de citas incorrectas. Un rechazo factual permite una corrección acotada de la misma unidad y una nueva revisión.

Sesiones conservan revisión, historial y lease del RPC. Nexus conserva su confirmación por lección y registra recibos por componente. Los reintentos respetan el tiempo disponible y un fallo de respaldo no autoriza sobrescribir la versión anterior. Los diagnósticos muestran la fase y el motivo sin incluir la salida ni el texto de las fuentes.

Si el worker confirma una revisión entre las dos consultas de progreso, el API recupera esa revisión antes de responder. La corrección de duración de video utiliza el presupuesto medido de narración y conserva guion por secciones, fuentes y notas visuales.

Base ofrece un reintento explícito después de un minuto si el trabajo reservado aún registra cero invocaciones. La acción comprueba organización y ejecución, actualiza la reserva de forma condicional y usa el worker firmado del despliegue actual. El identificador, la revisión de fuentes y el plazo original se conservan. Una reserva que ya tomó un worker conserva su ámbito y lease.
