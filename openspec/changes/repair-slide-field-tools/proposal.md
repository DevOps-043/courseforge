# Preparación editorial integrada

La preparación de campos falla antes de validar las diapositivas: consume_api_rate_limit devuelve 400 por una expresión CURRENT_TIME interpretada como timetz en una columna timestamptz. El editor oculta el motivo como indisponibilidad y ocupa el monitor con un bloque desplegable separado.

Se corrige la función mediante migración incremental, se conserva el control de límites y se mueve la preparación/seguimiento a Herramientas → Campos de diapositivas. La interfaz mantiene acciones explícitas, recibos, comprobación de integridad y diagnóstico seguro con referencia de solicitud. No se regeneran materiales ni se modifica el contrato editorial para eludir validaciones.
