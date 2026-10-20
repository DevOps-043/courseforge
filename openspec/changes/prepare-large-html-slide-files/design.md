# Diseño

Base: rama staging limpia al iniciar, nueva rama recuperable `codex/import-html-100mb`. Las correcciones anteriores están presentes en la base. No hay trabajo concurrente.

Separar 100 000 000 bytes de archivo local y 2 000 000 bytes de fuente preparada. El procesamiento de entrada usa htmlparser2 incremental en un Web Worker, sin DOM, ejecución de scripts ni solicitudes de recursos. Se declara como dependencia directa la versión ya transitiva. Un reductor incremental de URLs CSS evita transportar base64 dentro de hojas de estilo. El servidor sigue siendo la frontera de confianza y vuelve a validar y sanear.

Leer bloques de 256 KiB, limitar entrada/salida/nodos/profundidad y duración del worker, terminarlo ante error/cancelación/desmontaje. Un token individual, como un atributo base64, puede requerir memoria proporcional a su tamaño en el parser; no se promete memoria constante. El worker aísla ese trabajo del hilo UI.

Conservar reportes locales separados de los del servidor: no conceden autoridad ni sustituyen el saneamiento. Los originales se quedan en el dispositivo; el almacenamiento del paquete existente conserva solo el diseño normalizado. No se agregan endpoints, credenciales, tablas ni cargas remotas. Referencia de infraestructura: https://docs.netlify.com/build/functions/configuration/ .
