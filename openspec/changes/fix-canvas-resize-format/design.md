# Diseño

Mantener el documento V2 como fuente canónica. Probar el HTML compilado en Chromium aislado con eventos reales del mouse y patches de escena. Separar errores reproducidos de hipótesis sobre persistencia, sin ejecutar servicios remotos.

## Decisiones

- Encapsular visible bounds, resize bounds y solver de snap en una única factoría
  serializable. Se preservan los exports para consumidores existentes; no se
  depende del nombre que asigne el minificador a símbolos fuera del closure.
  Una prueba minifica el módulo con Terser incluido en Next y ejecuta el runtime
  obtenido en un VM sin acceso al módulo original.
- Usar `canvasWidth` vigente para calcular la escala de arrastre y marquee.
  El desplazamiento proporcional dominante permite tiradores verticales.
- Encapsular fetch y lectura JSON del PUT en una solicitud con AbortSignal de
  30 segundos. El catch/finally y la cola existentes preservan journal, cambios
  fallidos, rollback visual y precondiciones; no se reintentan escrituras cuyo
  resultado remoto sea incierto. El mensaje solicita recargar el documento.

## Evidencia y límites

El fallo principal se confirmó leyendo la consola del curso de staging y
reproduciendo el código de HEAD minificado. Los fallos de red observados no
permiten atribuir definitivamente el bloqueo original de cambio de formato.
Consultar [validación](reports/validation.md).

Rollback: revertir el diff de código y pruebas; no se modifican datos persistidos.
