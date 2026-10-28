# Verificación de memoria del build

Fecha: 2026-10-28. Base `5e77942e`, rama `codex/netlify-typecheck-memory`; checkout limpio al iniciar.

## Diagnóstico

El log aportado registra Next.js 16.3.6 / Node 22.23.4. Turbopack compila en 15.7 s; TypeScript termina con `FATAL ERROR: Reached heap limit` tras aproximarse a 2096 MB. No hay diagnóstico de error de tipos antes del OOM. Las siete advertencias de tracing son adicionales: no se declara que causen ese fallo.

La implementación instalada de Next.js crea el worker TypeScript con `isolatedMemory: false`. `lib/worker.js` conserva `max-old-space-size` en ese caso y propaga `NODE_OPTIONS` al hijo. Se fija 4096 MiB en el entorno del build Netlify; no se cambia el comando que captura el origen de jobs ni se omite TypeScript.

## Cambios y comprobaciones

- `netlify.toml`: presupuesto de heap para el build; no configuración de memoria de Functions. El máximo es por proceso y no garantiza la memoria física del contenedor.
- `apps/web/tsconfig.json`: excluye salidas auxiliares, manteniendo fuentes y suites. Comparación local del descubrimiento: 2209 entradas raíz antes/después, 488 entradas de pruebas y 4 de `.next/types`; ninguna exclusión adicional efectiva en este checkout. Esta protección no se presenta como reducción de memoria medida.
- `node --max-old-space-size=4096 node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --pretty false --extendedDiagnostics`: aprobado, salida 0; 4071 archivos incluyendo dependencias, memoria reportada 2334089 KB (aproximadamente 2.23 GiB), 168.11 s de tiempo total del compilador.
- `npm run docs:check`: aprobado, 145 documentos.
- OpenSpec 1.8.0 `validate netlify-typecheck-memory --type change --strict --no-interactive`: aprobado. El intento offline no tenía paquete en caché del sandbox; se usó el ejecutable mediante npm exec autorizado.
- `git diff --check`: aprobado.
- Build local con `NODE_OPTIONS=--max-old-space-size=4096`: detenido explícitamente tras más de 15 minutos sin salida nueva después de `Creating an optimized production build`. No emitió un error de red ni un diagnóstico de compilación; no se atribuye una causa sin evidencia. No acredita build completo aprobado. El proceso terminó con salida 1 al interrumpirlo.

## Límites y seguimiento

No se desplegó ni se modificó configuración remota. El siguiente build Netlify debe confirmar que supera la etapa TypeScript dentro de la RAM disponible. No se promete aprobación remota basándose solo en el chequeo local.

Las advertencias de acceso dinámico a archivos permanecen visibles. Requieren acotar recursos estáticos y diferenciar archivos temporales de runtime; no silenciarlas indiscriminadamente, porque podrían faltar assets al desplegar. No se modifican servicios multimedia para resolver un presupuesto de memoria del build.

Revisión del mismo agente: configuración acotada, sin acceso a secretos, cambios de permisos, credenciales o autenticación; sin nuevas dependencias ni cambios a contratos de producto. Reversión mediante restaurar las dos configuraciones. Logs temporales locales en `.tmp/netlify-memory-*.log`.
