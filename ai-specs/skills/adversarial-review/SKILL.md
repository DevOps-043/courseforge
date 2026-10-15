---
name: adversarial-review
description: Busca regresiones, permisos excesivos, estados parciales y evidencia inventada.
---

# adversarial-review

1. Leer escenarios, diff y resultados; intentar refutar las afirmaciones de éxito.
2. Revisar identidad/organización, secretos, validadores, cancelación, duplicados y efectos externos.
3. Verificar fuentes de datos y archivos realmente generados; un texto del modelo no acredita ejecución.
4. Revisar semántica de scripts, códigos de salida, dependencia local y ejecución en CI.
5. Comprobar alcance, cambios ajenos, wrappers huérfanos y rollback.
6. Registrar hallazgos comprobados y límites de la revisión. No afirmar independencia si revisó el mismo agente.
