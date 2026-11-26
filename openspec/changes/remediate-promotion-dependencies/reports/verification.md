# Verificación de dependencias para la promoción

Fecha: 2026-11-26, America/Mexico_City. Base: `97089ac1`, PR #16.

## Diagnóstico

Antes del cambio, `npm audit --omit=dev` reportó 18 hallazgos: 2 críticos,
9 altos, 5 moderados y 2 bajos. Incluye Next, proxy-addr y Zod; los paquetes
de Remotion propagan la dependencia de Zod vulnerable. La API fijaba Zod
3.25.76 y la web/raíz usaban Zod 4; todos los paquetes Remotion fijaban 4.0.484.

El usuario autorizó resolver las vulnerabilidades, incluida la migración mayor.
La auditoría detecta paquetes afectados; no demuestra explotación del producto.

## Criterios de aceptación

| Área | Verificación necesaria |
| --- | --- |
| Dependencias | Auditorías de producción y árbol completo después de instalar |
| API/Zod | Compilación, audio, waveform e integridad; conservar rechazos de entrada |
| Bundles | ZIP, manifiesto y seis paquetes Remotion con una versión exacta |
| Web | Tipos, lint, Remotion, HyperFrames y compuerta completa |
| Entrega | CI y build de Netlify sobre el commit publicado |

## Límites conocidos

- El CI anterior a esta corrección pasó sus compuertas de código y falló en
  la QA visual de la paleta, al simular Enter sobre el botón de cierre. Una
  reproducción mínima sobre un botón HTML confirmó 0 clicks con `rawKeyDown`
  y 1 con `keyDown` más texto `\r`, o con `rawKeyDown` más `char`. Se corrige
  la simulación, conservando las aserciones y la implementación del producto.
  [Referencia del protocolo](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchKeyEvent).
- `docs:audit` se inició con salida bajo `.tmp/` y se interrumpió sin terminar
  su recorrido recursivo de dependencias. Se contrastaron manualmente las
  referencias de Remotion afectadas; no se acredita una auditoría global.
- Las pruebas previas del PR no certifican estas dependencias nuevas: se deben
  repetir las verificaciones después de completar la instalación.
- No se invocan proveedores pagados ni renders cloud. Las instalaciones externas
  y los bundles históricos conservan su versión y requieren su propia validación.
- No se cambian datos, migraciones, permisos ni variables remotas.

## Resultados

- Primera instalación: Next 16.4.6, Zod 4.6.7 y los seis paquetes Remotion 4.0.547.
- Correcciones transitivas mediante `npm audit fix`, sin `--force`: la auditoría
  de producción baja a una alerta alta de Rollup anidado en Netlify CLI; cero
  críticas. El árbol completo conserva 63 alertas y señala Netlify CLI como
  dependencia directa afectada. Estos resultados intermedios no son el cierre.
- `npm run lint:legacy-api`: código 0 con Zod 4.6.7 instalado.
- Auditorías finales `npm audit --json` y `npm audit --omit=dev --json`: código 0,
  cero hallazgos en todas las severidades, incluido el árbol de desarrollo.
- Netlify CLI 27.20.1: versión y ayuda de `dev` y `build` cargan con código 0.
  La prueba de patrones, trazado NFT y empaquetado ZIP pasa: 2/2 pruebas.
- API: compilación de tipos y pruebas de integridad de video (14/14) y worker
  (8/8) pasan con Zod 4. No se han debilitado esquemas ni aserciones.
- QA Chromium de la paleta: código 0; incluye Enter sobre el botón de cierre,
  composición IME, restauración de foco y aislamiento del teclado del modal.
- Remotion: 236/236 pruebas, código 0; HyperFrames: 713/713, código 0.
  Sin pruebas omitidas en estas suites. El ZIP nuevo acredita las versiones
  coordinadas de Remotion frente a los seis paquetes realmente instalados.
- `npm run verify:pr`: código 0 con las dependencias finales. Incluye 74 elementos
  OpenSpec, arnés, documentación, lint (0 errores, 558 warnings de la línea base,
  0 diferencias), tipos, grafo (2475 módulos, 9800 aristas, 0 ciclos), empaquetado,
  migraciones, seguridad, audio y entrega del curso (93/93 pruebas).
- `npm ls` de Next, Zod, Remotion y dependencias corregidas: código 0, sin
  dependencias inválidas. `git diff --check`: código 0.

## Revisión adversarial

Revisión del mismo agente, no independiente. Se contrastaron manifiestos,
lockfile, generador de ZIP y metadatos del bundler. El lockfile conserva formato
3 y URLs del registro npm; la sustitución del árbol de Netlify explica gran parte
de sus altas y bajas. Los overrides se limitan a esa herramienta. Se comprueba
su comportamiento con los paquetes realmente instalados, sin mocks.

No se amplían permisos, se desactivan guardas ni se modifica el bloqueo de
publicación híbrida. Los bundles nuevos usan la versión coordinada de Remotion;
los históricos se conservan. Cero hallazgos de npm acredita el resultado del
registro consultado, no ausencia general de vulnerabilidades.

La compilación y QA en Linux/Node 22 y el build desplegable corresponden al CI
del nuevo commit; hasta que terminen no se acredita la promoción a main.

## Reproducibilidad de instalación

CI del commit `9524e2e9` falló en `npm ci` antes de las pruebas: su resolvedor
rechazó las versiones de los overrides anidados del lockfile. Localmente
`npm ci --dry-run --ignore-scripts` con npm 11.19.0 termina en código 0.
Se fija npm 11.19.0 en packageManager, CI y Netlify, manteniendo `npm ci` activo.
La instalación real en Linux debe confirmarse en el siguiente CI.
