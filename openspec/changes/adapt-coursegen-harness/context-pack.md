# Contexto del cambio

- Objetivo: adoptar el arnés de desarrollo de SofLIA Hub en Coursegen.
- Actor: mantenedores y agentes de desarrollo.
- Base: staging, commit 7e16e8c3; trabajo aislado de los cambios locales del editor.
- Alcance: router, contexto, skills, adaptadores, OpenSpec, validadores y CI.
- No objetivos: cambiar UI, agentes runtime, modelos, esquema, RLS o publicación.
- Contratos: scripts npm, archivos de contexto y workflow de calidad.
- Riesgo: instrucciones divergentes, adaptadores huérfanos, CI debilitado o comandos
  dependientes de secretos. Conservar la verificación de producto existente.
- Criterios: sincronización determinista, casos negativos automatizados, enlaces
  válidos, OpenSpec estricto y reporte de la compuerta con sus limitaciones.
- Decisiones: Codex/Claude/Antigravity; registry JSON tipado por validación local;
  Node 22 en CI; OpenSpec 1.8.0 como dependencia de desarrollo fijada.
