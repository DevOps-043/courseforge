# Evidencia — originales HTML hasta 100 MB

Fecha: 2026-10-20. Base `3948302a` en staging limpio; rama recuperable `codex/import-html-100mb`. Cambios locales, sin publicación ni despliegue.

## Diagnóstico y solución

El formulario rechazaba archivos mayores de 2 MB y enviaba todo el original en JSON a una función síncrona, cuyo transporte no admite 50/100 MB. Netlify documenta un máximo de 6 MB para request/response bufferizados: https://docs.netlify.com/build/functions/configuration/ . Esto es distinto del guardado posterior del paquete.

Se admite selección de originales hasta 100 000 000 bytes. Un Web Worker lee bloques de 256 KiB mediante htmlparser2, sin DOM, scripts ni red. Reduce scripts, comentarios, notas, navegación, recursos y URLs CSS, siguiendo las exclusiones existentes del perfil. La UI muestra progreso, cancelación, tamaño original/preparado y conteos locales. El servidor recibe solo la fuente compacta, vuelve a sanear y conserva permisos y aislamiento originales.

La fuente preparada mantiene 2 MB y la familia normalizada 2 MB; request/response conservan presupuestos de 5 MB. Se comprueba también la expansión del JSON antes de efectuar fetch. Esto admite originales grandes con recursos excluidos, pero no promete compatibilidad de 100 MB de HTML/CSS útil ni conservación de imágenes. No se archiva el original completo.

El worker se termina al completar, fallar, cancelar, desmontar o agotar 120 segundos. Hay controles de elementos, profundidad y salida. Un atributo/comentario/token individual grande puede requerir memoria proporcional a su tamaño; no se promete memoria constante ni cuota de memoria del navegador.

Se declara htmlparser2 ^10.1.0 como dependencia directa, reutilizando la versión y el registro de lockfile ya transitivos. El intento de resolver metadata con npm offline falló por ENOTCACHED; se añadieron únicamente las referencias directas en package.json y en la raíz del lockfile, conservando resolución, integridad y árbol existentes. `npm ls htmlparser2 --depth=0` confirma 10.1.0 instalado. No se instalaron paquetes ni se modificaron secretos.

## Verificación

- Suite final de importación: 29 pruebas, 29 aprobadas, incluidos los casos de atributos retenidos excesivos. Ejecución registrada en `apps/web/.tmp/large-html-import-tests.log`.
- Pruebas de originales sintéticos de 21 700 000, 50 000 000 y 100 000 000 bytes: preparación, fuente reducida, análisis HTTP y preflight editorial compatibles. Se prueban también límite excesivo previo a lectura, UTF-8 inválido, salida excesiva, URLs CSS repartidas entre bloques, texto con entidades, notas extensas y etiquetas vacías legadas.
- Chrome local, claro/oscuro × escritorio/móvil: worker real con archivos sintéticos de 21,7/50/100 MB, rechazo de 100 MB + 1 byte, cancelación y terminación de workers, preview sin scripts, revisión y guardado simulado. La fuente transmitida por cada ejemplo válido es 550 bytes; no se envía el original. Resultados y capturas en `apps/web/.tmp/html-template-import-theme-qa/` y salida en `.tmp/large-html-browser.log`.
- Typecheck y ESLint dirigidos de las versiones finales: aprobados.
- La comprobación de navegador final también rechazó en cliente una fuente que cabía en 2 MB pero cuyo JSON escapado superaba el presupuesto de transporte; no hubo una solicitud adicional. Cancelaciones y guardados simulados terminan todos sus workers. Cero errores de página; inspección visual de `loaded-dark-390.png`.
- Build aislado con la instalación local real de Next.js 16.3.6/Turbopack: aprobado. El fixture importa el cliente y worker finales; no carga archivos env ni la aplicación del producto. Después se inició ese build en el puerto 3027 y Chrome ejecutó el worker compilado con un original sintético de 100 000 000 bytes: 121 bytes preparados, cero errores de página. Salidas `.tmp/large-html-next-build.log` y `.tmp/large-html-next-runtime.log`; fixture ignorado en `apps/web/.tmp/large-html-next-fixture/`. El servidor temporal se detuvo después de verificarlo.
- OpenSpec 1.8.0 temporal: `validate prepare-large-html-slide-files --strict --no-interactive` aprobado.
- `npm run verify:pr`: adapters:check (27), harness:validate y docs:check (109 documentos antes de este informe) aprobados. Se detuvo en openspec:validate por faltar el ejecutable raíz `openspec`. Salida en `.tmp/large-html-verify-pr.log`; no se presenta la compuerta completa como aprobada.
- Comprobación final de documentación: 111 documentos válidos. OpenSpec del cambio aprobado; `git diff --check` sin errores.

## Revisión adversarial y alcance

Revisión del mismo agente; no se afirma independencia. La preparación del cliente no concede confianza a sus resultados ni a los conteos locales: la API conserva autorización previa a lectura y saneamiento. No hay nuevas rutas, tablas, storage remoto, credenciales, jobs ni servicios pagados. Se comprobó el presupuesto antes de expandir atributos retenidos grandes; se conserva el límite de entrada y el timeout del worker.

Las pruebas usan archivos sintéticos, Chrome local y API/persistencia simuladas. No validan el archivo real del usuario, Supabase remoto, el build completo del producto, rendimiento de producción ni navegadores móviles reales; las dimensiones móviles se emulan. El fixture esbuild publica un bundle explícito para el worker; además se comprobó el empaquetado y ejecución con Next.js/Turbopack mediante el fixture aislado descrito arriba. Se conserva CSP con worker-src self existente.

Reversión: restaurar el formulario que enviaba el archivo directamente y retirar los módulos locales de preparación/worker y la referencia directa a htmlparser2. API, schema persistido y paquetes no cambian, por lo que no requiere migraciones.
