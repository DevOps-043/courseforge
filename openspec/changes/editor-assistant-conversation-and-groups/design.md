# Diseño

El contrato conversacional permite 1 200 caracteres cuando no hay operaciones.
Los resúmenes de cambios conservan el límite de 300. El prompt y la descripción
del esquema del proveedor indican ambos límites.

El agente puede proponer grupos visibles de clips sueltos y desagrupar grupos
visibles simples de la raíz. La simulación rechaza pistas bloqueadas, grupos
anidados y cambios de jerarquía. La lista de operaciones, el diff y la proyección
de contexto incluyen la agrupación. La aplicación usa exclusivamente la ruta de
propuestas confirmadas con control optimista. La inversa guarda solo la sección
de grupos, incluido su orden y la posible ausencia histórica del campo.
