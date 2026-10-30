# Verificación de la investigación de latencia

Fecha: 2026-10-30. Base: `13774405f90d5d3dd1d87989673c6b4976269f54`.

## Alcance y aislamiento

- Checkout principal: `staging`, limpio al iniciar y preservado sin cambios versionados.
- Rama de análisis: `codex/editor-latency-investigation-20261030`, worktree separado desde esa misma base.
- Sólo se añaden informe, evidencia, script de reproducción y referencias dentro de la propuesta existente. No se cambian contratos de producto ni se archiva una especificación todavía no integrada.
- No se copiaron `.env`, credenciales ni configuraciones personales. Para la reproducción se reutiliza TypeScript/Zod del checkout principal mediante un argumento explícito; no se instalaron dependencias en el worktree.

## Comandos ejecutados

| Comando | Resultado |
| --- | --- |
| `git status --short`, revisión de HEAD y worktrees | Árbol principal limpio; base identificada |
| `npm run docs:audit` en el worktree | Salida 0; auditoría generada en archivo ignorado |
| `node openspec/changes/editor-action-autosave/reports/reproducir-latencia-2026-10-30.cjs --source . --dependencies <checkout-principal> --output openspec/changes/editor-action-autosave/reports/latencia-2026-10-30-evidencia.json` | Salida 0; seis decisiones de patch y aserciones de cola, ACK ausente, telemetría y escala |
| `npm run test:composition-autosave --workspace=apps/web` en el checkout principal | Salida 0; 21/21 pruebas y compilación de la suite |
| `node --check openspec/changes/editor-action-autosave/reports/reproducir-latencia-2026-10-30.cjs` | Salida 0 |
| `npm run verify:pr` | Salida 1; adaptadores (27), arnés y enlaces (148 documentos) pasan; se detiene en OpenSpec por CLI no instalada |
| `npm run test:harness` | Salida 0; 20/20 pruebas |
| `git diff --check` | Salida 0 |

Las dependencias y el código base se mantuvieron en la misma revisión. El script conserva SHA-256 de las fuentes principales. Sus temporizadores y costes Node no son métricas de una sesión de producción.

## Interpretación y revisión adversarial del mismo autor

- El caso de ACK visual en la cola es una simulación de estado, contrastada con consumidores reales de `saving` en el código. No se afirma haber manejado una UI autenticada en ese experimento.
- Las referencias HTML del fixture son estructuralmente válidas y sintéticas. No acreditan permisos, manifiestos reales ni una publicación.
- El timeout omite deliberadamente el ACK. No demuestra frecuencia de timeouts del usuario.
- El experimento de escala muestra payload y trabajo sobre todos los clips, pero no demuestra que CPU sea la causa dominante: el coste Node medido fue pequeño y no incluye DOM/GSAP.
- La primera ejecución falló por un fixture de deck no normalizado. Se normalizó con el schema del producto antes de la comparación y la ejecución posterior pasó; no se debilitó el guard ni se alteró el código de producción.
- Se contrastó la explicación alternativa de que cada `setPayload` recargara el iframe: el camino incremental confirmado conserva la URL compilada. Las recargas señaladas están asociadas a cambios explícitos de hash/generación, fallback y adopción editorial HTML.
- La implementación previa ya documentaba bloqueos durante escrituras y ausencia de QA autenticado. No se interpreta un resultado histórico del fixture como acreditación de latencia en todo el producto.
- README y contexto se contrastaron sin redefinir alcance ni contratos. No se modificaron por una investigación sobre comportamiento existente.

## Límites

No se ejecutaron consultas remotas, SQL, proveedores facturables, despliegues, build de producto ni QA visual. No se inspeccionaron configuración efectiva ni telemetría del despliegue. La revisión no es independiente.

No se declara `verify:pr` aprobado. La CLI `openspec` tampoco está disponible en el checkout principal; no se instalaron paquetes ni se relajó la compuerta para omitirla. Las verificaciones de producto posteriores dentro de esa compuerta no llegaron a ejecutarse. La suite específica de autoguardado se ejecutó por separado y su resultado se registra arriba.
