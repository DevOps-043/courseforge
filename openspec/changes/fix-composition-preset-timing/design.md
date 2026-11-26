# Límites temporales de los presets

`SEQUENCE` y `STACK` cuantizan la ventana proporcional al frame más cercano.
Si el frame final excede el límite del documento, se usa el frame anterior.
La comprobación usa la misma tolerancia que el esquema de composición para
evitar retroceder un frame por ruido de punto flotante. Una secuencia conserva
sus pesos y exige un frame por clip. Una superposición comparte el mismo rango
y exige un frame para el conjunto. Una ventana sin capacidad devuelve el
conflicto existente antes de generar el preview.

La corrección beneficia tanto a presets existentes como a nuevas capturas.
Una composición que termina entre frames puede conservar una fracción final
sin cubrir por la regla. Las ventanas irregulares, las protecciones de fuentes
y la validación previa a confirmar conservan su comportamiento. La reversión
del cambio es de código y no requiere migraciones ni recapturas.

## Evaluación de una aplicación asistida

Como siguiente fase, el motor resuelve las reglas guardadas y detecta qué
ventanas no caben. Las reglas que caben se aplican directamente. Si hay un
conflicto temporal, **Adaptar con SofLIA** entrega al agente las reglas
afectadas del preset, los clips elegibles y los límites temporales del destino.
Ese contexto incluye duración, FPS, ventanas ya ocupadas y restricciones de
los medios. El plan se basa en esos datos y en las reglas guardadas.

El agente devuelve únicamente los intervalos propuestos para las reglas en
conflicto. Se prioriza conservar el modo temporal, el orden de los clips y las
proporciones del preset. Si hace falta ceder, se puede comprimir una secuencia
como conjunto o acortar una ventana compartida. Por ejemplo, si un overlay
previsto para 18–22 s puede empezar en 18 s y el destino termina en 20 s, la
propuesta puede conservar el inicio y cerrar en el último frame válido.

El servidor cuantiza la propuesta a frames y verifica que respete el canvas,
la duración de las fuentes y las ventanas protegidas por bloqueos o
sincronización. La vista previa indica qué regla se ajustó y por qué. Si no
hay un ajuste válido, conserva el timing del destino para esa regla y avisa.
La confirmación sigue ligada al hash del documento base.

Antes de habilitar el flujo, validar que una regla que cabe se aplique sin
llamar al agente, que el ajuste de una regla deje intactas las demás y que
una propuesta inválida conserve los tiempos del destino. Incluir ventanas
sin capacidad y edición concurrente. Esta sección documenta el diseño futuro.
