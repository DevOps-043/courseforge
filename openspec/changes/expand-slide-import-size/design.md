# Diseño

Continuación del importador y su corrección visual en `codex/fix-slide-import-modal-theme`; se preservan sus cambios locales autorizados. No hay agentes concurrentes ni modificaciones ajenas en los archivos afectados.

Presupuestos decimales: fuente 2 000 000 bytes, familia serializada 2 000 000 bytes, request/response 5 000 000 bytes. Netlify documenta 6 MB para payloads síncronos: https://docs.netlify.com/build/functions/configuration/ . No se promete aceptar cualquier HTML de 2 MB: los límites semánticos/editoriales y la expansión de previews siguen siendo independientes.

El parser del dominio consume el stream de Request con límite real; Content-Length solo permite rechazar temprano. UTF-8 inválido, JSON inválido y contratos incorrectos se rechazan. El schema compartido conserva límites de longitud como defensa adicional; el dominio y la frontera comprueban bytes reales.

No se amplían los límites de CSS, nodos, profundidad ni del compilador editorial. Un archivo grande por comentarios/espaciado o por múltiples diseños puede limpiarse e importarse, mientras un fragmento incompatible sigue rechazándose antes de persistir. Se normaliza una sola vez al construir el conjunto de previews y se comprueba el presupuesto de respuesta completo, con reserva para el envelope HTTP.

El navegador muestra el límite desde una constante compartida. Las pruebas de navegador deben cargar un archivo superior a 500 KB y rechazar uno superior al nuevo límite; las de dominio cubren el deck normalizado y preflight editorial. No hay servicios pagados ni escritura remota como pruebas.
