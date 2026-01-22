Integración de URL Context en la API de Gemini para curación educativa

1. ¿Qué es URL Context y cómo funciona?

URL Contextes una herramienta integrada en la API de Google Gemini que permite al modelo acceder a contenido de páginas web, documentos y otros recursos externos proporcionados mediante sus URLs. En lugar de tener que copiar y pegar manualmente texto o datos en el prompt, podemos dar directamente enlaces web para que el modelo los consulte y use esa información como contexto adicional. El modelorecupera el contenido de esas páginas(siempre que no sean de un tipo no permitido) parafundamentar y mejorar su respuesta[[1]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20de%20contexto%20de,fundamentar%20y%20mejorar%20su%20respuesta). En otras palabras, Gemini puede “leer” las páginas indicadas y usarlas para producir respuestas más precisas y con grounding en fuentes verificables.

Flujo de recuperación:URL Context emplea unproceso de recuperación en dos pasospara equilibrar velocidad, costo y actualidad de los datos[[2]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20Contexto%20de%20URL,su%20contenido%20en%20tiempo%20real). Primero intenta obtener el contenido desde unacaché interna de índicealtamente optimizada (Google mantiene un índice de páginas visitadas recientemente). Si la página ya está en la caché, la carga es muy rápida y eficiente. Sino está en el índice– por ejemplo, si es una página muy nueva o poco común – entonces automáticamentehace una “recuperación en vivo”: es decir, el modelo lanzará unafetchdirecta de la URL en tiempo real para obtener su contenido[[2]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20Contexto%20de%20URL,su%20contenido%20en%20tiempo%20real). En ambos casos, el modelo acaba disponiendo del texto (u otros datos) de la página para procesarlo.¿Sigue redirecciones?Sí, típicamente la herramienta seguirá redirecciones HTTP hasta la URL final, y esa URL final se reflejará en los metadatos (campo**retrieved_url**). De este modo, aunque proporcionemos una URL corta o antigua, el contenido real recuperado será el de la página destino actual.

Contenido soportado:URL Context es muy versátil en cuanto a los tipos de contenido que puede manejar.HTML y textoplano son admitidos, así comoformatos estructurados(JSON, XML, CSV, etc.) y hojas de estilo o código fuente web (CSS, JS)[[3]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20puede%20extraer%20contenido,los%20siguientes%20tipos%20de%20contenido). Importante, también soportaPDFs(extrae texto, tablas y entiende su estructura) yimágenes(PNG, JPEG, BMP, WebP) gracias a las capacidades multimodales de Gemini[[4]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,PDF%20%28application%2Fpdf). Esto significa que incluso podemos apuntar a un PDF extenso o una infografía, y el modelo lo analizará. En el lanzamiento GA de la herramienta se destacó justamente esta ampliación:“Works with HTML, JSON/CSV/XML, PDFs (tables included) and images (PNG/JPEG/BMP/WebP)”, aprovechando que Gemini puede interpretar información visual y tabular[[5]](https://medium.com/@pankaj_pandey/geminis-url-context-now-ga-practical-guide-real-world-uses-3242e0911e73#:~:text=,support%20agents%20on%20customer%20sites).

Tipos no soportados:Hay algunas excepciones importantes. URL Contextno puede acceder a contenido protegido o restringido, por ejemplo páginaspaywalledque requieren login o suscripción[[6]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=No%20se%20admiten%20los%20siguientes,tipos%20de%20contenido). Tampoco funcionará directamente convideos de YouTube(para eso existe una herramienta separada de comprensión de videos)[[7]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,Archivos%20de%20audio%20y%20video), ni con archivos privados de Google Drive (Docs, Sheets)[[8]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,Archivos%20de%20audio%20y%20video). Del mismo modo,archivos multimedia binarioscomo audio o video no son extraídos[[7]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,Archivos%20de%20audio%20y%20video). En resumen, necesitamos URLs públicas de contenido textual, imágenes o PDF. También es buena práctica asegurarnos de proporcionar laURL completa (con protocolo**https://**)y que la página sea accesible sin autenticación[[9]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,com), para evitar errores de carga.

¿Crawl interno?Es importante notar que la herramientasolo recupera contenido de las URLs explícitamente indicadas,no sigue enlaces dentro de esas páginas[[10]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,las%20URLs%20que%20proporciones%20no). Es decir, no hará uncrawlde páginas vinculadas ni explorará el sitio completo, solo aquello que le pidamos directamente. Por ello, debemos proporcionar los enlaces específicos que contienen la información requerida, no solo el dominio o página principal (más sobre esto en mejores prácticas).

Metadatos de recuperación:Cada respuesta generada usando URL Context incluye un objeto de metadatos**url_context_metadata**quelista las URLs que el modelo efectivamente recuperó y el estado de cada intento[[11]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Cuando%20el%20modelo%20usa%20la,la%20verificaci%C3%B3n%20y%20la%20depuraci%C3%B3n). Esto es sumamente útil para verificar elgroundingy para depurar. Por ejemplo, después de la generación podemos inspeccionar**response.candidates[0].url_context_metadata**para ver un arreglo**url_metadata**con entradas por cada URL proporcionada[[12]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,chicken). Cada entrada indica la**retrieved_url**(la URL que se terminó leyendo, útil si hubo redirecciones) y un**url_retrieval_status**que típicamente será**URL_RETRIEVAL_STATUS_SUCCESS**en caso de éxito[[13]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%22url_metadata%22%3A%20%5B%20%7B%20%22retrieved_url%22%3A%20%22https%3A%2F%2Fwww.foodnetwork.com%2Frecipes%2Fina,chicken). Existen otros estados posibles:**ERROR**(falló la carga por error de red o formato),**PAYWALL**(se detectó un muro de pago) o**UNSAFE**(contenido bloqueado por políticas de seguridad)[[14]](https://ai.google.dev/api/generate-content#UrlContextMetadata#:~:text=Enums%20,because%20the%20content%20is%20unsafe). Estos metadatos nos permiten confirmar qué fuentes fueron consultadas realmente y si hubo problemas con alguna. Para efectos deverificación de grounding, podemos usar esta lista para checar que la respuesta del modelo esté basada en esas fuentes y no en otra cosa. Por ejemplo, si esperábamos que consultara 5 URLs y en los metadatos vemos menos o alguna con error, sabemos que ciertas fuentes no aportaron información y podríamos desconfiar de contenido que el modelo aún así brindó (posible alucinación). En integraciones avanzadas, es posible incluso mapear segmentos de la respuesta a fuentes específicas mediante las capacidades degroundingMetadatade Gemini, pero con URL Context puro el control principal es saber qué URLs fueron usadas con éxito.

Resolución de redirecciones:Como mencionamos, cuando una URL redirige a otra (por ejemplo de HTTP a HTTPS, o a una versión canonical), el modelo seguirá esa redirección. En**url_context_metadata**la propiedad**retrieved_url**reflejará la URL final obtenida tras seguir los redireccionamientos. Esto nos ayuda también anormalizar duplicados– si dos URLs diferentes en realidad apuntaban a la misma página final, en los metadatos lo veremos porque ambas podrían tener el mismo**retrieved_url**. Así, la herramienta en la práctica maneja redirecciones de manera transparente, entregándonos siempre el contenido final.

En resumen, URL Context actúa como un“navegador web” internodel modelo: le das una lista de direcciones y el modelo traerá el texto/imágenes de esas páginas para incorporarlas en su contexto antes de elaborar la respuesta. Esto desbloquea muchas posibilidades, desde preguntar sobre un artículo específico, comparar información entre varias páginas, hasta analizar código en un repositorio o resumir un PDF extenso,todo sin construir un pipeline tradicional de RAG.

2. Limitaciones operativas de URL Context

Como toda herramienta, URL Context tienelímites operativosy consideraciones de costo que debemos tener en cuenta al integrarla en nuestro pipeline:

Cantidad de URLs por solicitud:Podemos pasarhasta 20 URLs en una sola peticiónal modelo[[15]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=llamadas%20a%20funciones.%20,sola%20URL%20es%20de%2034%C2%A0MB). Este es un límite fijo de la API. Si intentamos proporcionar más de 20 enlaces en un solo prompt, la solicitud será rechazada. Por lo tanto, en nuestro pipeline tendremos que seleccionar un conjunto priorizado de fuentes (o en su defecto dividir en múltiples rondas, ver Fase 2).

Tamaño máximo del contenido:La herramientaprocesa hasta ~34 MB de contenido por URL[[16]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,sola%20URL%20es%20de%2034%C2%A0MB). Es un límite bastante amplio (suficiente para ~ tensiones de ~ tensiones?), por lo que la mayoría de páginas HTML o PDFs entran. Sin embargo, PDFs extremadamente largos o páginas con mucho contenido embebido podrían excederlo. Si el contenido es mayor, es probable que se trunque o la recuperación falle. En nuestras pruebas, una página de texto puro tendría que tener cientos de miles de palabras para superar ese umbral. Aun así, es posible que un PDF con muchas imágenes alcance gran tamaño en bytes; conviene monitorear si alguna URL se acerca a ese límite y quizás omitirla o dividirla.

Contenido no soportado:Ya mencionamos varios.Paywallsson ignorados por diseño: si la URL requiere pago/login, el**url_retrieval_status**retornará**PAYWALL**[[17]](https://ai.google.dev/api/generate-content#UrlContextMetadata#:~:text=,the%20content%20is%20behind%20paywall)y el modelono obtendrá contenido(así evitamos tener contenido incompleto o bloqueado). Similar con YouTube: por URL Context no veremos la transcripción ni nada (para eso está Video Understanding). Google Docs, Sheets u otros enlaces de Google Workspace tampoco funcionarán (generalmente son privados o requieren autenticación).Contenido dinámico: un detalle sutil es que URL Context no ejecuta JavaScript; extrae la respuesta HTML estática. Si la página depende de JS para cargar datos (p. ej., algunas aplicaciones SPA o mapas interactivos), es posible que el contenido recuperado esté vacío o incompleto. Esto no está explícito en la documentación, pero debemos tenerlo en mente como posible causa de “contenido thin” inesperado. Tampoco se procesarán audio/video, y es lógico: no hay un paso de transcripción o similar en esta herramienta.

Costo en tokens:Sí, todo el contenido recuperado cuenta como tokens de entrada en el prompt[[18]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Recuento%20de%20tokens). Es crucial entender esto para estimar costos. Al usar URL Context, esencialmente estamos extendiendo el contexto del modelo con el texto de esas páginas. En la respuesta del API viene un campo**usage_metadata**donde se detalla la cantidad de tokens consumidos por cada parte; ahí podemos ver cuántos tokens aportó la herramienta. Por ejemplo, en la documentación se muestra un caso donde**tool_use_prompt_token_count**es 10,309 tokens[[19]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%27prompt_token_count%27%3A%2027%2C%20%27prompt_tokens_details%27%3A%20%5B%7B%27modality%27%3A%20,%27token_count%27%3A%2010309%7D%5D%2C%20%27total_token_count%27%3A%2010412), lo que indica que la suma del texto de las URLs fue de ~10k tokens. Estos se suman al total junto con los tokens del prompt y la respuesta generada.El cobrose hace según las tarifas por token del modelo seleccionado[[20]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%27tool_use_prompt_tokens_details%27%3A%20%5B%7B%27modality%27%3A%20,%27total_token_count%27%3A%2010412)– es decir, si usamos Gemini pro, flash, etc., aplican sus precios por 1000 tokens, y los tokens de URL Context simplemente se agregan al conteo. En resumen, cuanta más información traigamos de la web, más costará la consulta.¿Cómo de predecible es el costo?Google señala que esclaro y predecible, ya que solo pagas por tokens, sin recargos adicionales[[21]](https://developers.googleblog.com/url-context-tool-for-gemini-api-now-generally-available/#:~:text=Context%20tool%20is%20now%20ready,your%20costs%20clear%20and%20predictable). Pero debemos presupuestar adecuadamente si vamos a traer páginas muy largas.

Velocidad y latencia:Cada URL agrega algo de latencia, especialmente si debe hacerse fetch en vivo. Con caché interna muchas respuestas son rápidas, pero si tenemos 10 URLs nuevas, el modelo tiene que esperar a cargarlas todas. Esto puede hacer que una llamada con URL Context tarde varios segundos más que una sin herramientas. En un entorno de función serverless (Netlify Functions en Node.js, en nuestro caso) hay límites de tiempo a considerar. Empíricamente, pequeñas páginas (~ <100 KB) cargan en menos de un segundo cada una; PDFs de varios MB pueden tardar algunos segundos. Nuestro pipeline deberá considerar untimeoutgeneroso o limitar la cantidad de URLs por llamada para no exceder el tiempo máximo de ejecución.

Riesgos comunes (contenido problematico):Hay ciertosescenarios que pueden dificultar la efectividad de URL Context:

Páginas excesivamente largas:Aunque 34 MB es el tope, incluso contenidos de algunos megabytes (ej. un PDF de 300 páginas) pueden saturar la capacidad cognitiva del modelo. Si bien Gemini tiene contexto largo (Flash e incluso 100k tokens en ciertas versiones), meter decenas de miles de tokens de golpe puede llevar a respuestas muy costosas y quizá confusas. Además, no sabemos si internamente Gemini intenta resumir o chunkear contenido muy grande; lo seguro es que aumentará costo y quizás diluya la relevancia. Por ello, es riesgoso pasar“todo Wikipedia”por URL Context – mejor acotar a secciones relevantes o usar herramientas de recuperación adicionales.

Contenido duplicado:En resultados de búsqueda es común tener URLs diferentes con texto idéntico (p.ej., el mismo artículo sindicado en dos sitios, o HTTP vs HTTPS). Si pasamos duplicados, estaremos pagando el doble en tokens y el modelo recibirá información redundante que no aporta nada nuevo. Además, podría sesgar las respuestas (el modelo podría sobreponderar datos repetidos). Por lo tanto, es fundamentaldeduplicar URLsen nuestro pipeline. Esto implica normalizar (quitar**www.**, eliminar**#fragment**o parámetros de tracking, y resolver redirecciones previamente si es posible) para detectar si dos enlaces apuntan al mismo recurso. Hablaremos más de esto en mejores prácticas.

Redirecciones múltiples:Si una URL redirige a otra dominio o a muchas hops (e.g., bit.ly -> sitio externo -> page), aunque el sistema las sigue, podría haber demoras. También, si un resultado de búsqueda es un enlace intermediado (como los de Google Search Grounding que son un redirector especial[[22]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,site%20with%20the%20information%20itself)), conviene resolverlos antes de pasarlos a URL Context para ahorrar un paso.

Páginas “índice” o genéricas:Un caso particular de irrelevancia son lashomepages o páginas índiceque no contienen información específica buscada. Por ejemplo, si en la búsqueda aparece el home de un sitio (que tiene secciones generales, links, “Bienvenido”, etc.), pasarlo al modelo no ayudará a responder una pregunta puntual. Incluso, puede confundirlo o tentarlo a alucinar contexto inexistente. Similar con páginas de categorías o listados – suelen no profundizar en detalles requeridos. Nuestro pipeline debe filtrar estos casos (ver anti-alucinación más abajo) y priorizar páginas que realmente tengansubstanceútil.

Contenido muy escaso o vacío (“thin content”):En el extremo opuesto, si una URL cargó correctamente pero resultó ser casi vacía (ej: una página de error 404 estilizada que devuelve 200 OK, o un artículo con solo un par de líneas), el modelo podría verse sin suficiente información y aun así sentirse obligado a responder. Esto es terreno fértil para alucinaciones (inventará detalles ausentes). Detectar páginas vacías o irrelevantes y excluirlas es importante. Un truco técnico es verificar la cantidad de palabras extraídas: si es menor a cierto umbral (p.ej., < 50 palabras), probablemente no sirva para grounding y puede descartarse.

Contenido no actualizado:Recordemos que Gemini tiene un conocimiento base estático hasta cierta fecha. Si preguntamos por algo muy reciente y dependemos de URL Context para lo último, debemos asegurarnos que la URL realmente tenga esa info. Páginas de noticias son buenas candidatas, pero si por error pasamos una página antigua creyendo que es actual, el modelo puede quedar desfasado. Este es un riesgo menor si elegimos bien las fuentes, pero hay que tenerlo presente en curación educativa con información que cambia (resultados de exámenes, etc.).

En resumen, las limitaciones principales soncuantitativas(20 URLs, 34 MB, tipos soportados, costo en tokens) ycualitativas(qué tan relevante y utilizable es el contenido que traemos). Conocer estas limitaciones nos permitirá diseñar la integración para sacar el máximo provecho de URL Context evitando escenarios donde pueda fallar o inducir alucinaciones.

3. Mejores prácticas para prevenir alucinaciones (anti-alucinación)

Una integración cuidadosa de URL Context debe garantizar que el modelosolo responda con información “groundeada” en las fuentes proporcionadas. A continuación proponemos algunasreglas deterministas y buenas prácticaspara minimizar alucinaciones y filtrar contenido dudoso, utilizando los metadatos y señales disponibles:

1. Aceptar solo URLs recuperadas con éxito:Tras cada llamada del modelo con URL Context, revisar**url_context_metadata**.Si alguna URL tiene**url_retrieval_status**distinto de SUCCESS, descartar cualquier aporte de esa fuente.En la práctica, podemos excluir esas URLs de la consideración en respuestas finales. Por ejemplo, si 2 de 5 URLs fallaron (error, paywall, unsafe), podemos decidirno confiar en información que supuestamente provenga de ellas. Una implementación sencilla es: si la respuesta del modelo menciona datos que solo estaban en una URL fallida, probablemente sean inventados. Para detectar eso podríamos volver a ejecutar la pregunta sin esas URLs o con las restantes a ver si cambia la respuesta. En cualquier caso,nunca tomar contenido de una URL que no cargó correctamente– eso es un indicio claro de posible alucinación.
2. Verificar cobertura de las fuentes (grounding chunks):Cuando combinamos con la herramienta de búsqueda de Google, Gemini proporciona metadatos más ricos llamadosgroundingMetadata, que incluyengroundingChunksygroundingSupports[[23]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,attributes%20in%20each%20array%20element). Cadagrounding chunkcorresponde a una referencia (resultado web) utilizada, e incluye un URI y título[[22]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,site%20with%20the%20information%20itself), mientras quegrounding supportsindica segmentos del texto de la respuesta y a qué chunk(s) están asociados, con un puntaje de confianza[[23]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,attributes%20in%20each%20array%20element). Si disponemos de estos datos, podemos aplicar reglas como:

Si algún fragmento de la respuesta carece de referencias (no tiene chunks asociados en groundingSupports), marcarlo como potencial alucinación.Idealmente, cada oración o dato factual debería trazar a al menos un chunk.

Establecer un umbral de confianza:por ejemplo, requerir que cada segmento de la respuesta tenga un soporte con confianza > 0.6. Si vemos**confidenceScores**muy bajos para cierta afirmación, significaría que aunque el modelo buscó, no encontró respaldo sólido – podría habérselo inventado o inferido débilmente. En ese caso, conviene rechazar esa respuesta o ese fragmento.

Consistencia de fuentes:verificar quelos datos clave aparezcan en los textos recuperados. Podemos incluso hacer comprobaciones deterministas: por ej., extraer números o nombres de la respuesta y buscar esas cadenas en el contenido de las URLs (que podemos haber almacenado temporalmente). Si el modelo dice“El estudio X de 2021 halló 45% de mejora”pero ninguna fuente tiene “45%” o menciona el estudio X, es un clarohallucination. Este tipo of verificación por texto puede automatizarse para flags simples.

3. Normalizar y deduplicar URLs (canonicalization):Como adelantamos, es crucial evitar enviar la misma información dos veces. Antes de llamar a Gemini con una lista de URLs, aplicar normalizaciones:

Removertrailing slashesy unificar esquema (**http**->**https**preferentemente) a menos que sean sitios distintos.

Quitar parámetros de tracking o irrelevantes (utm_campaign, session IDs, etc.) de las URLs, que no alteran el contenido semántico pero sí las hacen ver distintas.

Resolver manualmente aquellos enlaces que sabemos que redirigen (si el mismo dominio tiene versionm.móvil, preferir la versión desktop canonical, etc.).

Incluso, si es factible, realizar una petición HEAD o una mini-fetch a cada URL para obtener su código de respuesta yLocationfinal. Esto fuera del modelo, en nuestro código Node.js, nos puede dar la URL final. Podemos luego comparar finales para eliminar duplicados.

Si dos URLs parecen distintos pero tienen el mismo**`<title>`**HTML y dominio similar, sospechar duplicado (ej:**example.com/page?id=1**vs**example.com/page?id=1&ref=twitter**). Mejor incluir solo una.

Aprovechar los metadatos: tras recuperación, si vemos dos**retrieved_url**idénticos en**url_context_metadata**, definitivamente eran duplicados; podríamos ignorar uno en siguientes pasos.

Normalizar no solo reduce costo, tambiénevita que el modelo se vea influenciado en excesopor una fuente duplicada. Además, deduplicar ayuda en la fase de validación: podremos atribuir afirmaciones a una fuente única en vez de lidiar con clones. En suma:una URL, una página única.

4. Filtrar páginas poco informativas:Antes de pasar URLs al modelo (o incluso después de obtenerlas vía búsqueda), aplicarcriterios de aceptación/rechazo automáticos:

Si la URL es claramente una homepage o sección genérica, rechazar. Ejemplo de regla: URL cuyo path esté vacío o sea “/index.html” sin contenido específico =>**rechazar**.

Si el título de la página sugiere ser un listado o categoría, p. ej. “Noticias - Inicio” o “Resultados de búsqueda”, evitar. Estas páginas raramente contienen respuestas puntuales.

Longitud de contenido:podemos hacer unfetchrápido nosotros mismos (o usar la caché de respuesta si la herramienta de búsqueda nos dio un snippet) y calcular número de palabras. Si**< 100 palabras**, probablemente es una página vacía o con error – descartar. También descartar si detectamos palabras clave de error en el HTML (“404 Not Found”, “Page not available”, etc. aunque el código devuelto sea 200).

Páginas muy pesadas:al contrario, si detectamos que el HTML crudo supera cierto tamaño (ej. varios MB), quizás conviene no pasarla entera. Una estrategia sería buscar dentro de ese HTML si contiene nuestros términos de interés (relacionados a la pregunta). Si no los tiene hasta X profundidad, puede ser irrelevante. Si los tiene, tal vez valga la pena, pero consciente del costo.

Contenido duplicado en la misma lista:si varias URLs parecen citar la misma fuente primaria (por ejemplo, varias noticias replicando un comunicado), podríamos escoger solo una representativa para reducir redundancia.

Implementar estas reglas comochecks deterministas if/thenayuda aautomatizar la curación de fuentesantes de invocar la costosa generación con modelo. Por ejemplo:

**if (url.path == "/" or url.title contains "Home") then skip_url();**
if (fetched_text.length < 50 or /404|Not Found/.test(fetched_text)) then skip_url();

etc.

5. Prompt Engineering anti-alucinación:Además de las reglas programáticas, podemos reforzar instrucciones al modelo. En el prompt (instrucciones del sistema o usuario) podemosrecordarle que NO invente datosy quese limite a la información de las URLs. Aunque Gemini es bastante bueno en grounding cuando tiene fuentes, nunca está de más indicarle explícitamente:"Si la información no está en las páginas proporcionadas, indica que no la encontraste en lugar de responder de memoria."También podemos pedirle quecitela fuente de cada dato (aunque sea en texto plano: ej. “(Fuente: ejemplo.com)”), lo cual obliga al modelo a reflejar de dónde sacó cada cosa, desincentivando invenciones. Más adelante proponemos prompts concretos con este tipo de instrucciones.
6. Verificación post-respuesta (validación profunda):Esto corresponde a la Fase 3 de nuestro pipeline, pero lo mencionamos como práctica anti-hallucination: básicamente,no confiar ciegamente en la primera respuesta. Incluso con las medidas anteriores, es posible que el modelo mezcle algo de conocimiento previo no proveniente de las URLs. Por ello, implementaremos una fase devalidacióndonde, con mayor detenimiento, confirmamos cada afirmación contra las fuentes. Esta validación la puede hacer otro modelo en modo crítico (o heurísticas de búsqueda textual). La idea es detectar cualquier desliz antes de dar por buena la respuesta. Un enfoque es usar un segundo prompt pidiéndole al modelo que marque qué partes de la respuesta no pudo corroborar en los textos de las URLs (que le podemos proporcionar de nuevo). Esta separación de roles – primero generar, luego verificar – suele reducir la probabilidad de alucinación en el resultado final entregado al usuario.

En resumen,combinar controles automáticos con instrucciones claras al modelonos permite aprovechar URL Context maximizando la fidelidad al contenido. Desde filtrar qué URLs son dignas de confianza hasta exigir referencias para cada dato, estas prácticas crean unescudo anti-alucinaciónen nuestro pipeline de curación educativa.

4. Diseño de la integración por fases (Pipeline de 3 fases)

Para integrar URL Context en el flujo decuraduría educativa, proponemos un pipeline dividido en3 fases secuenciales(Search, Recovery, Deep Validation), cada una implementada como función independiente (Netlify Functions en Node.js) que se encadena con la siguiente. A continuación detallamos cómo sería cada fase y cómo interactúan con URL Context y otras herramientas:

Fase 1:Búsqueda inicial(Search)

Objetivo:Obtener un conjunto defuentes candidatasrelevantes a la consulta educativa, combinando la potencia de búsqueda web de Google con indicios iniciales de contenido. En esta fase identificamosqué páginas vale la pena leer.

Búsqueda web:Utilizamos la herramientaGoogle Searchde Gemini (o alternativamente una API de búsqueda externa) para realizar una búsqueda basada en la pregunta del usuario. Activar eltoolde búsqueda en el modelo nos permite aprovechar la búsqueda en lenguaje natural de Google. Por ejemplo, podemos hacer que el modelo ejecute internamente queries del estilo:"site:edu question ..."o simplemente la pregunta tal cual, y recibir los resultados en su**groundingMetadata**. Según la documentación, cuando se habilita**google_search**, el modelo ejecuta consultas y obtiene fragmentos de resultados[[24]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Fundamentaci%C3%B3n%20con%20la%20b%C3%BAsqueda). Esto nos da cobertura amplia.

Combinar con URL Context (en exploración):Una estrategia poderosa eshabilitar tanto Search como URL Context conjuntamenteen esta fase. Al hacerlo, el modelo puede directamente, tras encontrar resultados relevantes, usar URL Context para“leer”más profundamente esas páginas encontradas[[24]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Fundamentaci%C3%B3n%20con%20la%20b%C3%BAsqueda). De esta manera, en una misma conversación el agente puede buscar y luego inspeccionar contenido detallado. Esto es similar a un agente de RAG pero manejado internamente por Gemini.

Ejemplo:El prompt del usuario es"¿Cuál es la causa principal de la erosión en la capa arable según estudios recientes?". Con Search+URLContext, Gemini podría buscar esa pregunta, encontrar (por ejemplo) un artículo científico o un reporte de la FAO. Entonces, seguiría el enlace y con URL Context obtener los datos del informe para dar una respuesta fundamentada. Todo en la misma fase.

Sin embargo, para mantener nuestro pipeline modular y controlable, podríamosseparar las acciones: primero usar Search para obtener URLs, luego en fase 2 usar URL Context para recuperarlas. Esto nos da más control de qué se lee.

Selección de candidatos:Los resultados de la búsqueda (ya sea a través del**groundingMetadata**de Gemini o un JSON de una API) típicamente incluyentítulo, snippet y URL. Recopilamos losTop N(por ejemplo, 5 a 10) resultados orgánicos. Aquí aplicamos losfiltros iniciales: descartar resultados irrelevantes o problemáticos:

Filtrar dominios si es necesario (quizá priorizar .edu, .org si es contenido educativo, y evitar dominios sospechosos).

Omitir resultados que claramente no responden la pregunta (p. ej. la consulta aparece en un foro no confiable, o es una página muy tangencial).

Ya en esta fase, podemos usar el snippet y el título para eliminar homepages: si el snippet es vacío o genérico"Bienvenido al portal X...", fuera. Si el título/snippet muestra que es un PDF extenso pero perfectamente relevante, podemos mantenerlo (sabiendo que luego costará tokens).

Enriquecer la selección con meta-datos:Podemos crear una lista decandidate_sourcescon campos enriquecidos. Por cada resultado seleccionado, hacemos quizás una peticiónHEADoGET parcialpara obtener:

Status HTTP(asegurarnos que existe).

Content-Type(¿es HTML, PDF...?).

Tamaño aproximado(Content-Length si viene, o descargar primeros KB para estimarlo).

Título de la página(podemos parsear el**`<title>`**de HTML rápidamente).

Snippet de texto: si no confiamos solo en el snippet de Google, podemos descargar las primeras ~5 KB de la página para extraer una intro.

Indicadores personalizados: número de ocurrencias de términos clave (por ejemplo, palabras de la pregunta encontradas en ese texto inicial).

Estos datos nos permiten anotar cada candidato con, por ejemplo,**relevance_score**o flags como**is_homepage**,**is_pdf**,**word_count_estimate**. Así, antes de pasar a la siguiente fase,ordenamos o filtramos:- Podríamos ordenar los candidatos por relevancia (por ejemplo, aquellos cuyo snippet o texto inicial menciona directamente el concepto clave de la pregunta reciban mayor peso).- Priorizar diversidad: si dos URLs son del mismo dominio y cuentan lo mismo, quizá tomamos solo una en primera instancia.- Remover los que tengan algúngatetécnico malo: p.ej., status no 200, o content-type no soportado (si curiosamente la búsqueda devolvió un audio o algo).

Salida de Fase 1:Un JSON**candidate_sources**enriquecido que lista las URLs candidatas con sus metadatos y un campo indicando si pasan a la siguiente ronda (**selected: true/false**). Por ejemplo:

**[**
{
"url": "https://fao.org/erosion-study.pdf",
"content_type": "application/pdf",
"estimated_length": 2.1, // MB
"title": "FAO – Estudio sobre erosión del suelo (2023)",
"snippet": "...erosión de la capa arable es causada principalmente por la deforestación...",
"keywords_matched": ["erosión", "capa arable"],
"is_homepage": false,
"selected": true
},
{ ... },
...
]

Este objeto será entregado a la Fase 2. En nuestroslogs, también conviene guardar métricas aquí: cuántos resultados se obtuvieron vs seleccionados (tasa de filtrado), latencia de la búsqueda, etc., ya pensando en métricas de evaluación.

Fase 2:Recuperación detallada(Recovery Round)

Objetivo:Recuperar el contenido completo(o sustancial) de las URLs seleccionadas y generar una respuesta inicial fundamentada. Además, si la respuesta no es suficientemente completa o alguna info falta, reintentar incorporando fuentes adicionales (recovery).

Fetch de contenido con URL Context:Tomamos las**selected**URLs de la fase 1 (digamos 3 a 5 principales para no sobrecargar) y las pasamos al modelo utilizando la herramientaurl_context. Aquí estructuramos el prompt de la siguiente manera:

Podemos usar un mensaje de sistema que instruya:"Eres un asistente que responde usando únicamente la información de las fuentes proporcionadas. Te daré unas URLs con contenido relevante; por favor, intégralas para responder a la pregunta del usuario. No agregues nada que no esté en las fuentes."(Ver sección de prompts).

En el contenido del usuario o del prompt, incluimos la pregunta original y listamos las URLs o las insertamos directamente en la pregunta como contexto (p. ej.:"Según las siguientes fuentes: [URL1], [URL2]... responder...").

En la configuración de la API, activamos**tools: [{url_context:{}}]**para que el modelo sepa que puede y debe usar esa herramienta.

Resultado: El modelo hará fetch de cada URL (usando cache o live fetch según corresponda) y luego generará unarespuesta curadacitando o parafraseando la información de las páginas. Idealmente, obtendremos un primerborrador de respuestaque ya integra varias fuentes.

Manejo de URLs excedentes:¿Qué pasa si en la fase 1 tuvimos más URLs relevantes de las que es prudente meter de golpe? Por ejemplo, quizás identificamos 8 buenas, pero meter las 8 podría ser 1) costoso en tokens, 2) arriesgado a mezclar demasiada info. Aquí aplicamos un enfoqueiterativo:

Iniciamos la fase 2 con, digamos, las top 3-5 URLs más prometedoras. Solicitamos la respuesta.

Analizamos la respuesta generada: ¿Resolvió completamente la pregunta? ¿Quedaron aspectos sin mencionar? ¿Tenemos razones para creer que en las otras fuentes hay info complementaria no cubierta?

Si la respuesta es incompleta o dice "no encontré X", entonces entra elRecovery Roundpropiamente dicho:reintentamos incorporando URLs adicionales. Es decir, llamamos de nuevo al modelo pero añadiendo ahora algunas de las fuentes que quedaron fuera inicialmente, o quizá reemplazando alguna fuente que pareció no útil por otra de la reserva.

También podemos ajustar el prompt de formadeterminista: por ejemplo, si la primera respuesta omitió un sub-tema de la pregunta, formular un nuevo prompt del tipo"Amplía la respuesta incluyendo información sobre [subtema] usando las siguientes fuentes adicionales: [URL4]...".

O podríamos simplemente hacer una segunda llamada con todas las fuentes (hasta el límite de 20 si cabe), para ver si agrega algo.

Es importante en estos reintentos mantener latemperatura baja(p. ej. temp=0) para evitar desviaciones estilísticas, y enfocarlo comocompletiónde la respuesta. Podemos incluso dar la respuesta previa al modelo y decir "verifica si falta algo y usa estas fuentes nuevas para complementarla".

Ajustes deterministas en recovery:Además de agregar fuentes, podemos hacer la fase 2 más robusta con ajustes como:

Forzar uso de la fuente más relevante por separado:Si hay una URL que creemos central (ej: un PDF clave), pero el modelo en la primera pasada no pareció tomar datos de allí (quizá porque otras fuentes tenían snippet más directos), podemos hacer una pregunta directa del estilo"Según el documento [URLX], ¿qué se afirma sobre Y?"para asegurarnos de sacar esa pepita de información. Esto usando de nuevo url_context pero con un prompt específico para esa fuente. Luego integrar ese resultado a la respuesta general.

Evitar respuestas evasivas:Si en la primera ronda el modelo respondió de forma muy genérica o dijo "No encontré suficiente información", en la segunda ronda podemos ser más directos en el prompt:"La siguiente fuente contiene datos sobre Y, úsalos."A veces Gemini puede ser conservador; guiándolo con instrucciones deterministas sacaremos más provecho de las fuentes.

Combinación con búsqueda en recovery:En algunos casos, la fase 1 podría no haber encontrado bien cierto dato. Podríamos entonces en fase 2 hacer búsquedas adicionales enfocadas: por ejemplo, si la pregunta tenía dos partes y una no fue respondida, lanzar una búsqueda específica para esa parte y luego usar URL Context con esa nueva fuente en la misma segunda ronda. Esto se convierte en un mini-ciclo search->context de refinamiento.

Control de duplicidad y coherencia:Si en la respuesta de la primera sub-ronda notamos información conflictiva o duplicada, podemos decidir descartar alguna fuente contributora en la repetición. Por ejemplo, si URL1 y URL2 decían lo mismo y el modelo redundó, tal vez quitamos una para la segunda iteración para ver si reduce redundancia. La idea es llegar a una respuesta que combine fuentes de formaconcisa y completa.

Salida de Fase 2:Al final de esta fase deberíamos tener unborrador de respuesta consolidado con fuentes. Posiblemente también podemos recopilar un listado final de qué URLs efectivamente fueron utilizadas (aún podemos inspeccionar**url_context_metadata**de la llamada final). Se podría incluir esas fuentes en la respuesta al usuario, pero en nuestro pipeline preferimos validar primero. Por ello, la salida principal será larespuesta generada(texto), junto con un objeto que resume las fuentes usadas y cualquier nota sobre reintentos. Por ejemplo:

**{**
"draft_answer": "Según estudios recientes, la principal causa de erosión ...",
"used_sources": [
{"url": "...", "retrieval_status": "SUCCESS"},
{"url": "...", "retrieval_status": "SUCCESS"}
],
"attempts": 2
}

También registramos métricas como cuántas rondas hicimos (ej.**attempts: 2**), qué fuentes nuevas añadimos en la segunda ronda, etc. Esto alimentará las estadísticas finales (p. ej.,retries promedio).

Fase 3:Validación profunda(Deep Validation)

Objetivo:Verificar exhaustivamente la veracidad y fundamentaciónde la respuesta generada, asegurando un criterioultra-estrictode grounding antes de considerarla final. Básicamente,buscar cualquier alucinación residual o error fácticocomparando la respuesta contra el contenido original de las fuentes.

Recuperar contenido completo de las fuentes:Para validar, necesitamos tenera mano todo el texto relevante de las fuentes. Es probable que en la fase 2 el modelo ya “leyó” ese contenido internamente, pero ahora lo necesitamosexternamentepara analizarlo. Podemos proceder así:

Para cada fuente utilizada (y quizá también alguna fuente extra que no se usó pero teníamos disponible), realizar unfetch directoen nuestra función Node.js. Esto puede ser un HTTP GET tradicional para obtener la página HTML o PDF.

Procesar el contenido obtenido: si es HTML, extraer texto sin scripts ni navegación (podemos usar un parser HTML o regex básicos, o librerías como Readability para obtener el cuerpo principal). Si es PDF, usar alguna librería de Node (por ejemplo**pdf-parse**) para extraer texto completo. Si es imagen (poco probable que la respuesta textual dependa de imagen), podríamos en teoría usar Gemini visión, pero seguramente no es el caso en curación educativa textual.

El resultado será, para cada fuente, un bloque de texto (podría ser muy largo). Posiblemente no necesitamos TODO el texto si es enorme; podríamos restringirnos a pasajes alrededor de donde está la info pertinente. Pero para ser minuciosos, mejor tener la mayor parte.

También guardar metadatos como word count final, etc., que usaremos en gating.

Definir “gates” técnicos de validación:Antes de siquiera involucrar al modelo en validación, podemos aplicarchequeos programáticosa la respuesta y a las fuentes:

Gate A – Origen de cada afirmación:Descomponer la respuesta en frases o en afirmaciones (podemos dividir por “. ” por ejemplo) y para cada una buscar palabras clave en los textos de las fuentes. Si encontramos que una frase completa o un dato específicono aparece en ninguno de los textos fuente, marcar unfallo de grounding. Por ejemplo, si la respuesta dice "El 70% de la erosión se debe a la deforestación", buscamos “70%” en los textos. Si ninguna fuente lo menciona,red flag. Esta verificación puede hacerse con coincidencia relajada (números, nombres propios, etc.).

Gate B – Detección de homepage/índice utilizado:Si entre las**used_sources**hay alguna marcada como**is_homepage: true**u otra señal de ser genérica, penalizar la confianza. Quizá directamente declarar que la validación falla porque se basó en una fuente no específica. El razonamiento: una homepage no puede contener un dato detallado, así que si fue usada, lo más probable es que el dato vino de otra parte o es inferido.

Gate C – Longitud vs especificidad:Calcular ladensidadde información relevante en las fuentes. Por ejemplo, si la fuente principal tiene 10000 palabras pero solo un párrafo relativo a la pregunta, hay chance de que el modelo haya rellenado con contexto extra no confirmado. Podemos medir cuántas veces aparece el término central de la pregunta en el texto. Si es muy pocas, la fuente quizá no es tan específica -> riesgo de relleno. Podemos establecer: si < X ocurrencias o sección dedicada, marcar para revisión.

Gate D – Consistencia entre fuentes:Si dos fuentes aportan cifras o hechos potencialmente conflictivos (ej: una dice 70%, otra 65%), revisar si la respuesta reconcilió eso correctamente o si eligió una arbitrariamente. Esto es complejo de automatizar, pero un approach: detectar números o fechas en la respuesta y ver si múltiples fuentes difieren en esos valores. Si hay discrepancia, idealmente el modelo lo habría notado; si no, es un punto a validar manual o con lógica extra.

Estos gates producen unchecklistbooleano. Podemos requerir quetodos los gates pasenpara aprobar la respuesta.

Validación mediante modelo (“IA juez”):Además de los gates deterministas, empleamos el modelo en modo “crítico estricto”. Usamos unprompt de validación(ver Prompt 2 abajo) donde le damos:

La respuesta generada (el borrador).

El contenido de las fuentes (podríamos concatenarlo, pero si son enormes, quizás mejor resumir cada uno previamente).

Instrucciones claras de comprobar cada enunciado contra las fuentes, señalando cualquier cosa que no esté respaldada textualmente.

Posiblemente pedimos salida estructurada (ej. JSON) con campos como**supported: true/false**y lista de evidencias.

Por ejemplo, un prompt podría ser:"Actúa como un verificador de hechos. Te proporcionaré una respuesta junto con las fuentes originales. Comprueba frase por frase si la respuesta está completamente sustentada en las fuentes. Si encuentras alguna afirmación sin sustento claro, indícalo. Responde 'VERIFIED' si todo está respaldado, o enumera las discrepancias."A unaIA validatorno le importa sonar amigable, sino ser meticuloso y estricto. Esto ayudará a detectar cosas sutiles que nuestros gates quizá pasaron.

Scoring y decisión final:Combinamos los resultados de los gates técnicos y el veredicto de la IA:

Sitodos los gates pasanyla IA validadora no encuentra problemas, asignamos unpuntaje altoa la respuesta (p. ej. 1.0 o 100%) y la marcamos comoaprobada para entrega.

Si uno o más gates fallan, o la IA señala al menos una alucinación, entonces la respuesta se considerano confiable. Podemos asignar un score bajo (ej. 0.0) o un porcentaje de cuán respaldada está.

Puede haber casos intermedios: por ejemplo, todo está bien excepto por un detallito menor. En esos casos, podríamos tener un score intermedio (ej. 0.8) y decidir si eso amerita rechazo o si se puede corregir automáticamente. Dado que la petición es ultra-estricta, probablemente cualquier desviación implica volver a fase 2 o marcar para revisión manual.

Esta lógica se plasmará en un objeto**validation_result**. Un posible esquema:

**{**
"is_valid": false,
"score": 0.67,
"failed_gates": ["A", "C"],
"issues": [
{"type": "unsupported_claim", "text": "El 70% de la erosión...", "source_evidence": null},
{"type": "missing_source", "text": "estudio de 2023", "source_evidence": null}
]
}

Aquí listamos qué chequeos fallaron y detalles de qué partes de la respuesta son problemáticas. Este resultado se loguea y eventualmente se utiliza para decidir si el pipeline retorna la respuesta al usuario o no. En un sistema productivo, podríamos incluso alimentar esta info a otra pasada de corrección (por ejemplo, mandar al modelo: "corrige la respuesta eliminando lo no verificado"). Pero eso ya sería un ciclo extra; dependiendo de la estricticidad, podríamos simplemente descartar respuestas no válidas.

Métricas en esta fase:calculamos también datos como: número de afirmaciones verificadas vs total (porcentaje de afirmaciones respaldadas), tiempo que tomó la validación (que incluye fetch de cada fuente de nuevo, parsing, etc.), tokens gastados en el modelo juez, etc.

Tras la fase 3, si la respuesta pasó todos los filtros, la damos porcurada y validada. Caso contrario, podríamositerar: quizás volver a fase 2 con las indicaciones de lo faltante. Pero en nuestro diseño principal, asumimos que fase 3 es la puerta final antes de presentarla. En contexto educativo de alta exigencia, es preferible entregar"Lo siento, no pude validar la respuesta con certeza"que algo potencialmente incorrecto.

5. Artefactos técnicos de la implementación

A continuación se presentan artefactos técnicos útiles para construir esta solución en Netlify Functions (Node.js), incluyendo unachecklist de implementación, ejemplos decontratos JSONentre fases, y ejemplos depromptsusados en el modelo.

A. Checklist técnico para Netlify Functions (Node.js)

Al implementar cada fase en Netlify Functions, debemos cuidar aspectos prácticos de networking, parsing y robustez. Esta checklist resume puntos clave:

Fetching HTTP:Utilizar**fetch**nativo de Node (disponible en runtimes modernos) o una librería como Axios para realizar solicitudes web. Asegurarse de habilitarseguimiento de redirecciones(**redirect: "follow"**en fetch por defecto) para que URLs que redirigen se resuelvan automáticamente. Verificar códigos de estado; solo tratar como éxito códigos 200 (o 304 en caso de caché, aunque en funciones stateless no aplica) – cualquier 4xx/5xx marcar como error.

Timeouts y reintentos:Configurar timeouts razonables para las peticiones. Netlify Functions pueden tener límite ~10s por request externa; conviene usar ~5s por URL, ajustado según peso esperado. Si una solicitud tarda demasiado o falla por red transitoria, implementarreintento automático(quizá 1 retry rápido). Para evitar bloquear toda la función en un fetch lento, se pueden hacer fetch en paralelo cuando apropiado (por ejemplo fase 1 para obtener meta de varios resultados simultáneamente), pero con moderación para no saturar CPU/IO.

Validación de respuesta HTTP:Después de fetch, chequear elContent-Typede la respuesta contra lo esperado. Si esperábamos HTML y viene otra cosa (o viene HTML de error), señalarlo. Por ejemplo, algunas URLs pueden devolver HTML genérico de login (detectable porque content includes**<form**login, etc.) – esas debemos descartarlas. Igualmente, si un PDF viene con un tamaño enorme (Content-Length), podríamos decidir no descargar completo en validación, sino confiar en modelo; pero mejor descargarlo una vez si podemos para análisis.

Extracción de texto:

HTML:Parsear usando DOMParser o librerías como Cheerio (lightweight) para extraer solo el texto significativo. Remover scripts, nav, footer. Alternativamente, usarReadability.js(de Mozilla) para obtener el cuerpo principal de artículos. Otra opción simple: eliminar tags HTML con una expresión regex y decodificar entidades, sabiendo que no será perfecto pero suficiente para búsqueda de palabras.

PDF:Emplear una librería Node (como**pdf-parse**o**pdfjs-dist**) para obtener texto. Cuidado con PDFs muy grandes – quizá extraer solo las primeras N páginas o aquellas relevantes. Si PDF es escaneado (imagen), no podremos obtener texto sin OCR (fuera de alcance).

JSON/XML/CSV:Si por casualidad la fuente es datos estructurados (la doc dice soportado), podríamos parsear JSON y resumirlo a texto; o CSV idem. Normalmente en curación educativa no buscaremos eso, pero tenerlo en mente.

Truncamiento de texto:Para logs o para enviar al modelo validador, no podemos meterinfinitamentetodo. Si el texto de una fuente excede cierto límite (ej. >10k tokens), podríamos truncarlo o resumirlo antes de pasarlo al modelo. Una técnica: dividir en párrafos y tomar aquellos que contienen las palabras clave del tema. Otra: usar el propio modelo en modo resumen para esa fuente, pero eso añade costo. En todo caso, garantizar que la parte necesaria para verificar la respuesta esté incluida. Quizá limitar a, digamos, 5000 caracteres por fuente en el prompt de validación, centrados en fragmentos relevantes.

Logs y debugging:Incluirlogging estructuradoen cada fase. Ej: en fase1, log de consulta de búsqueda y resultados filtrados; en fase2, log de qué URLs se pasaron al modelo y su status; en fase3, log de gates results y verdict. Esto ayuda no solo a depurar durante desarrollo sino también a recolectar métricas posteriormente (podemos analizar logs para saber tasa de fallos, etc.). Dado que Netlify logs van a stdout, podemos imprimir JSONs o líneas clave identificables.

Manejo de errores:Implementar bloques try/catch alrededor de interacciones con APIs externas. Si la búsqueda falla (por ejemplo, API quota exceeded), podríamos retornar un error controlado o fallback a otro mecanismo. Si Gemini API falla (tiempo de espera, etc.), reintentar una vez si posible. Si parsing lanza excepción (HTML malformado, PDF no legible), capturar y anotar la fuente como no analizable. Lo importante es que el pipeline no se quede en un estado inconsistente: si en fase2 falla 1 URL, quizás podemos continuar con las demás en lugar de abortar todo. Marcarlo en los metadatos y seguir.

Configuración de entorno:Asegurarse de almacenar lasAPI keysnecesarias (clave de Gemini API, clave de Custom Search API si se usa, etc.) en las environment variables de Netlify, no en código. Asimismo, respetar los límites de tasa de la API de Gemini (p. ej., no exceder X requests por minuto según modelo). Si esperamos alto volumen, quizá implementar colas o retrasos mínimos entre llamadas para no golpear rate limits.

Segmentación de funciones:Podemos implementar cada fase como función separada invocable vía HTTP (Netlify Function endpoints). La fase1 podría ser triggered por la app con la query, devuelve candidate_sources JSON. Luego la fase2 es llamada con ese JSON (o un reference ID) y devuelve draft_answer, etc. Para no exponer internamente los detalles, podemos encadenar internamente si preferimos, pero separar les da independencia y posibilita escalarlas distinto.

Testing en local:Simular entradas típicas para cada fase. Tener archivos de ejemplo (por ejemplo, HTML de una página, un JSON de resultado de búsqueda) para probar los parsers sin depender de la web en cada run. Esto acelera debugging. Y como discutiremos en Plan de pruebas, cubrir varios tipos de URLs offline antes de live.

Esta lista nos guía en la implementación robusta dentro de Netlify Functions, donde el entorno es Node 18+ (lo cual soporta Top-Level Await, fetch global, etc., facilitando varias de las tareas anteriores).

B. Contratos JSON sugeridos (entre fases y resultados)

Aquí definimos la estructura de los datos intercambiados entre fases y los resultados finales de validación. Esto ayuda a estandarizar la comunicación en el pipeline:

Contrato de**candidate_sources**(salida de Fase 1, entrada de Fase 2):Es un array de objetos, donde cada objeto representa una fuente candidata encontrada en la búsqueda y evaluada. Campos recomendados:

**url**:string– La URL original.

**resolved_url**:string– URL final después de seguir redirecciones preliminares (opcional, podría ser igual a url si no se resolvió nada aún).

**title**:string– Título de la página o recurso.

**snippet**:string– Fragmento descriptivo (de la búsqueda o extraído).

**content_type**:string– Tipo de contenido esperado (e.g. "text/html", "application/pdf").

**status_code**:number– Código HTTP devuelto en una comprobación rápida (200, 404, etc.).

**est_size_kb**:number– Tamaño estimado en KB (si disponible).

**relevance_score**:number (0-1)– Puntuación calculada de relevancia según snippet/título coincidencia con la query.

**flags**:object– Varias banderas booleanas, por ejemplo:

**is_homepage**: true/false,

**is_duplicate**: true/false (si se detectó duplicada con otra),

**passed_filters**: true/false (si cumple criterios básicos).

**selected**:boolean– Si fue seleccionada para usar en Fase 2.

Ejemplo breve:

**{**
"url": "https://example.edu/study/erosion-causes",
"resolved_url": "https://example.edu/study/erosion-causes",
"title": "Study on Causes of Soil Erosion - Example University",
"snippet": "In a 2022 study, deforestation accounted for 45% of topsoil erosion...",
"content_type": "text/html",
"status_code": 200,
"est_size_kb": 250,
"relevance_score": 0.9,
"flags": {
"is_homepage": false,
"is_duplicate": false,
"passed_filters": true
},
"selected": true
}

Contrato de**draft_answer**(salida de Fase 2, entrada de Fase 3):Puede ser un objeto con:

**answer_text**:string– el texto completo de la respuesta generada en fase 2.

**used_sources**:array– listado de fuentes efectivamente utilizadas por el modelo. Podemos rellenarlo a partir de**url_context_metadata**de la respuesta. Cada item con**url**y quizás**status**.

**notes**:object– detalles adicionales, e.g.

**attempts**: número de iteraciones en fase 2,

**added_sources**: si se agregaron fuentes en intento 2,

**model_id**: qué modelo de Gemini se usó (flash/pro),

**token_usage**: tokens consumidos en fase2 (si lo extraemos de**usage_metadata**).

Ejemplo:

**{**
"answer_text": "Según un estudio de 2022 de la Universidad X, la deforestación es la causa principal del 45% de la erosión de la capa superficial del suelo, seguida por las prácticas agrícolas inadecuadas (30%)【fuente1】. Otro informe de la FAO confirma que las actividades humanas, especialmente la tala indiscriminada, aceleran la pérdida de suelo fértil【fuente2】.",
"used_sources": [
{"url": "https://example.edu/study/erosion-causes", "status": "SUCCESS"},
{"url": "https://fao.org/soil-2023-report.pdf", "status": "SUCCESS"}
],
"notes": {
"attempts": 2,
"added_sources": ["https://fao.org/soil-2023-report.pdf"],
"model_id": "gemini-3-pro",
"token_usage": {"prompt": 1500, "response": 120}
}
}

Contrato de**validation_result**(salida de Fase 3):Objeto que resume los resultados de validación:

**is_valid**:boolean– si la respuesta pasó todos los criterios de validación estricta.

**score**:number– un puntaje global (0 a 1, o 0-100) indicando cuán respaldada está la respuesta.

**gates**:object– resultado de gates técnicos:

e.g.**all_claims_supported: true/false**,**no_homepage_used: true/false**,**no_conflict: true/false**,**specific_content: true/false**(estos nombres dependen de cómo definamos cada gate).

**issues**:array– lista de problemas detectados (si los hay). Cada issue con:

**type**: código/categoría (p.ej. "unsupported_claim", "contradiction", "source_missing", "content_thin").

**description**: mensaje legible o datos sobre el problema (e.g. "Dato X no encontrado en las fuentes", "Fuente Y es demasiado general").

**affected_text**: la parte de la respuesta o hecho al que se refiere.

**validated_by**:string– método de validación usado (e.g. "AI+rules" o "rules_only"), por transparencia.

**suggestion**:string– (opcional) sugerencia de siguiente paso, p.ej. "requires_edit" si solo falta un ajuste menor, o "discard_answer".

Ejemplo:

**{**
"is_valid": false,
"score": 0.75,
"gates": {
"all_claims_supported": false,
"no_homepage_used": true,
"no_conflict": true,
"specific_content": false
},
"issues": [
{
"type": "unsupported_claim",
"description": "La cifra '30%' no aparece en ninguna fuente proporcionada.",
"affected_text": "prácticas agrícolas inadecuadas (30%)"
},
{
"type": "content_thin",
"description": "La fuente https://site.com/index era una página genérica sin detalle.",
"affected_text": null
}
],
"validated_by": "AI+rules",
"suggestion": "requires_edit"
}

En este ejemplo, se encontró que un 30% mencionado no estaba en fuentes (posible invención) y se usó una fuente poco útil. El sistema marca la respuesta como no válida.

Estos contratos JSON facilitan la integración entre funciones y también la inspección externa (por ejemplo, podríamos exponerlos para que un desarrollador revise qué falló en validación sin tener que releer todo el texto). Son esquemas sugeridos que se pueden ajustar según necesidades, pero la clave es tenerestructuras claras para los datos intermedios y finales.

C. Prompts productivos (ejemplos)

A continuación, proporcionamos dosprompts de ejemploutilizados respectivamente en la fase deBúsqueda/Recuperacióny en la fase deValidación profunda. Están diseñados para maximizar el grounding y minimizar las alucinaciones, siguiendo las mejores prácticas antes discutidas.

Prompt 1 – Fase de Búsqueda/Recuperación (anti-alucinación)
Rol: System / User (combinado).Este prompt guía al modelo para que utilice las herramientas de Google Search y URL Context de forma controlada. El objetivo es que encuentre información y genere una respuesta solo con lo encontrado, sin inventar. Un posible formato:

**Sistema (instrucción):**
Eres un asistente educativo experto en buscar y verificar información.
Tienes acceso a herramientas de búsqueda en la web y a lectura de páginas web (URL Context).
Tu tarea es responder la pregunta del usuario utilizando **exclusivamente** datos provenientes de fuentes fiables que encuentres.
**No añadas información que no esté confirmada en las fuentes.**
Si no encuentras la respuesta en las fuentes, admite que no dispones de esa información.
Cita brevemente la fuente de cada dato importante que des en la respuesta (por ejemplo, “según [Fuente]”).
Mantén un tono objetivo y académico.

Usuario:
(Pregunta del usuario aquí, por ejemplo:)
"¿Cuál es la causa principal de la erosión del suelo según estudios científicos recientes?"

Herramientas disponibles:

- Búsqueda web de Google (para encontrar páginas relevantes).
- Contexto de URL (para leer el contenido de URLs específicas).

Instrucciones adicionales:

1. Primero, utiliza la **Búsqueda de Google** para encontrar las mejores fuentes sobre el tema.
2. Luego, selecciona las fuentes más relevantes (por su dominio académico/gubernamental y porque responden directamente a la pregunta).
3. Usa **Contexto de URL** con esas fuentes para extraer los datos necesarios.
4. Redacta la respuesta integrando esos datos. Incluye detalles numéricos o específicos solo si los viste en las fuentes.
5. Indica de dónde viene cada dato importante mencionando la fuente. Por ejemplo: "Un estudio de 2022 indica X (Fuente: Estudio2022.pdf)".

Ahora, adelante: busca la información y luego responde al usuario fundamentando tu respuesta en lo encontrado.

En este prompt, el sistema deja claras las reglas (no alucinar, usar fuentes, citar) y el usuario (nuestra app) proporciona la pregunta. Hemos incluido pasos operativos para que el modelo efectivamente use las herramientas en orden. Por supuesto, la sintaxis exacta puede variar; con la API de Gemini podríamos pasar**tools=[{google_search:{}},{url_context:{}}]**y simplemente darle la pregunta, pero añadir estas instrucciones aumenta la probabilidad de que el modelojustifique y cite, en lugar de solo soltar la respuesta. Esto es útil porque queremos que incluso en el borrador referencie fuentes, facilitando luego la validación.

Prompt 2 – Fase de Validación Profunda (ultra-estricto)
Rol: System/Assistant.Aquí ponemos al modelo en modocrítico/factual, para revisar la respuesta usando las fuentes. Es casi como cambiarlo de rol: de generador a verificador. El prompt podría ser:

**Sistema (instrucción de validación):**
Ahora eres un **verificador de hechos** altamente estricto.
Tu objetivo es examinar una respuesta y determinar si **cada afirmación está respaldada por las fuentes proporcionadas**.
Te daré la respuesta propuesta y después el contenido de varias fuentes (texto extraído de páginas web y documentos).
Debes comprobar, **línea por línea**, si la información de la respuesta aparece y coincide con la información en las fuentes.

Criterios:

- Si encuentras la afirmación en las fuentes (aunque con otras palabras) y no hay contradicción, márcala como **VERIFICADA**.
- Si **no** encuentras evidencia de una afirmación en las fuentes, o hay datos (cifras, hechos) que no aparecen, considérala **NO VERIFICADA**.
- Si alguna afirmación contradice lo que dicen las fuentes, márcala como **CONTRADICTORIA**.
- Sé ultra-preciso: _no des nada por supuesto_. Por ejemplo, fechas, porcentajes, nombres específicos deben estar explícitamente en las fuentes.
- Al final, indica si la respuesta completa es fiable o no según las fuentes.

Formato de salida:

- Lista cada afirmación clave de la respuesta original, seguida de tu veredicto entre **VERIFICADA/NO VERIFICADA/CONTRADICTORIA** y (opcional) una referencia a cuál fuente lo apoya o contradice.
- Si algo es NO VERIFICADO o CONTRADICTORIO, explica brevemente por qué (p.ej. "la cifra X no se encontró en las fuentes").
- Finalmente da una conclusión general: "La respuesta está X% verificada" o "La respuesta NO está respaldada plenamente por las fuentes."

Ahora te proporcionaré la respuesta y las fuentes.

Respuesta propuesta:
"[Aquí insertaríamos el texto de la respuesta generada en fase 2]"

===== **FUENTES** =====
Fuente 1: [título/URL]

(texto completo o relevante de la Fuente 1)

Fuente 2: [título/URL]

**_(texto completo o relevante de la Fuente 2)_**

_(y así con todas las fuentes)_

```plaintext
*Tu análisis crítico comienza debajo:*

Un ejemplo más concreto, siguiendo el caso de erosión:

**Respuesta propuesta:**
"La deforestación es la causa principal de la erosión del suelo a nivel mundial, responsable de alrededor del 45% de la pérdida de capa arable. También las prácticas agrícolas inadecuadas contribuyen en aproximadamente un 30%, según un estudio de 2022. Otras causas incluyen la urbanización y el sobrepastoreo, aunque en menor medida."

===== FUENTES =====
Fuente 1: Estudio Universidad X 2022 (example.edu/erosion-study)
"Resultados: La deforestación fue el factor predominante, contribuyendo a ~45% de la erosión del suelo superficial en las áreas estudiadas. Las prácticas agrícolas inadecuadas representaron ~20%. Factores menores fueron urbanización (15%) y sobrepastoreo (10%). ..."

Fuente 2: Informe FAO 2023 (fao.org/soil-2023.pdf)
"... principales causas de erosión: actividades humanas, en particular la deforestación y ciertas prácticas agrícolas, que exacerban la pérdida de suelo fértil..."

En este escenario, el verificador debería detectar que la respuesta afirmó "30%" para prácticas agrícolas, pero la Fuente1 dice 20%. Por tanto marcaría eso como CONTRADICTORIO o NO VERIFICADO. Todo lo demás (45% deforestación) sí coincide con Fuente1. Así, concluiría que no está plenamente respaldada.

El propósito de este segundo prompt es queningún detalle dudoso pase desapercibido. Le pedimos enumerar afirmaciones y revisarlas con lupa. Formatos como el porcentaje de verificación nos ayudan a convertir eso luego en un**score**. Notemos que incluimos los textos fuentes completos para darle material. En casos de fuentes muy extensas, podríamos haber resumido, pero siempre cuidando de incluir los fragmentos donde aparecen los datos numéricos o hechos relevantes para que la IA los vea.

Estos prompts se pueden ajustar según el estilo deseado de salida (por ejemplo, se podría pedir respuesta en JSON enumerando cada claim con booleano). Pero incluso en lenguaje natural estructurado nos sirve, ya que podemos parsear fácilmente "VERIFICADA" vs "NO VERIFICADA".

En suma, conPrompt 1nos aseguramos de guiar al modelo durante búsqueda/recuperación para que no alucine y cite sus hallazgos, y conPrompt 2configuramos al modelo comoauditor implacable, garantizando que la respuesta final que pase sea digna de confianza en un contexto educativo.

6. Plan de pruebas de la solución

Para asegurar que nuestro pipeline funcione correctamente y cumpla con los estándares de calidad, definimos un plan de pruebas que abarca diversos escenarios de URLs y medirá métricas clave:

Casos de prueba por tipo de URL:

Artículo de blog (HTML típico) – caso feliz:Entrada:Pregunta donde un blog bien escrito tiene la respuesta (ej. "¿Cómo influyen las mareas en la pesca artesanal?" con un blogpost detallado).Expectativa:El pipeline debe encontrar el blog, extraer la info, y la respuesta final debe citarlo correctamente.Validación:Debería aprobar, dado que la info está claramente en la fuente.

Verificar:Que la fase1 realmente encuentra ese blog (posiblemente junto a otras páginas), que fase2 lo utiliza (check en metadata que**retrieved_url**es success), y que en la respuesta se refleje lo del blog. Fase3 debería ver todo verificado.

Métricas esperadas:Aprobación = true, alucinaciones detectadas = 0, retries = 0 (probablemente ni requiera segunda vuelta), latencia total razonable (<3s por fase), costo bajo (porque blog de longitud moderada, digamos 1000 tokens context).

Página principal (homepage) – caso de descarte:Entrada:Pregunta muy genérica o mal definida que hace que Google lance como resultado la homepage de una organización (ej: pregunta "OMS salud 2025 objetivos" y top result es "WHO homepage").Expectativa:El pipeline debe filtrar la homepage como no útil. Si la homepage pasa por error a fase2, es muy probable que la respuesta sea vaga o inventada (porque la homepage no tenía la info específica).

Verificar:Que en**candidate_sources**la homepage tenga flag**is_homepage:true**y**selected:false**. La fase2 debería entonces tener que usar otras fuentes. Si por algún motivo solo estaba esa fuente, la respuesta debería decir "no encontré info" en vez de alucinar.

Métricas:Aprobación = no aplicable (esperamos quizás que ni se genere respuesta, o se genere "no se encontró"). Si se genera y no hay sustento, fase3 debe rechazar. Este caso prueba elgatede homepage y la robustez anti-hallucination: debería detectar falta de datos y no inventar.

PDF largo (informe extenso):Entrada:Pregunta cuyos datos están en un PDF voluminoso (ej: "Estadísticas del censo agrícola 2020 en país X").Expectativa:El pipeline debe manejar el PDF: fase1 lo listará (content_type PDF, tamaño grande), fase2 lo pasará a Gemini que puede leerlo (hasta 34MB).

Verificar:Que no excedamos límites; si es demasiado grande, tal vez la respuesta solo se base en partes. Observar tiempo de carga (quizá fase2 más lenta). En fase3, parsear PDF con nuestra librería y ver si encontramos las cifras.

Métricas:Latencia fase2 podría ser alta (ej. 8-10s) pero dentro de un límite. Token usage alta (tal vez 8000 tokens de PDF). Aprobación depende de exactitud: si modelo resumió bien. Este test evalúa performance y costo: medir tokens consumidos en tool_use_prompt (¿contó todo PDF?). Esperamos respuesta correcta y vali da, pero hay riesgo de que el modelo omita algún dato. Importante checar que no se alucinen números no presentes.

Soft-404 (página no encontrada pero con código 200):Entrada:URL que carga un template genérico "contenido no disponible". Por ejemplo, un resultado de búsqueda que apunta a una página que redirigió a una página de error sin decir "404" en código.Expectativa:Nuestro pipeline idealmente la detecta en fase1 o fase2:

Fase1: snippet quizás ya muestra "Page not found". O al hacer fetch rápido detectamos palabras clave. Debería marcar**passed_filters:false**.

Si llega a fase2,**url_retrieval_status**podría ser SUCCESS (porque técnicamente cargó HTML), pero el contenido es irrelevante. El modelo quizás diría "No encontré info en X" o peor, alucine.

Verificar:Gate de thin content: la página tendría muy pocas palabras o repetitivas, gatillando exclusión.

Métricas:Alucinación detectada = esperemos que 0 porque no debería haber nada a alucinar (modelo podría no tener qué decir, a menos que rellene de conocimiento general). Si filler ocurre, fase3 lo señalará como no respaldado. Éxito es que pipeline no use esa fuente o la descarte en validación.

Contenido paywall:Entrada:Un resultado es de un sitio de noticias con paywall (e.g.,**nytimes.com/…**).Expectativa:Gemini URL Context detectará paywall y marcará**URL_RETRIEVAL_STATUS_PAYWALL**, por lo que esa fuente no proveerá contenido.

Verificar:En**url_context_metadata**, status PAYWALL para esa URL. Nuestra lógica anti-alucinación debe entonces ignorarla. Si era la única fuente, modelo puede decir "no puedo acceder". Si había otras, que no use esta.

Métricas:Hallucinations = 0 (no debe inventar lo que no leyó). Retries: tal vez pipeline en recovery busca alternativa (por ejemplo, la misma noticia replicada en otro medio). Medir que costo no subió (no pagamos tokens de contenido paywalled, asumo no cuentan si no pudo leer).

Este test valida queno rompemos en errorpor paywall (Gemini simplemente devuelve paywall status y sigue).

Redirección complexa:Entrada:URL acortada o un dominio que redirige varias veces antes del contenido final (ej: bit.ly -> blog link -> mobile site -> desktop site).Expectativa:El pipeline sigue la cadena.

Verificar:En fase1, si resolvemos, final domain visible. En fase2**retrieved_url**será final. Importante: Checkear que dedupe no filtre erroneamente un link porque no reconoció su equivalencia pre-resolución.

Métricas:Latencia fase2 quizás un poco mayor por redirs, pero nada grave. Validar que la respuesta utiliza el contenido final como si la URL final hubiera sido dada (lo cual debe suceder).

También podemos ver si en candidate_sources pusimos**resolved_url**y cómo ayudó.

Además de estos casos, podríamos probar combinaciones: por ejemplo, pregunta que produce múltiples resultados de distinta calidad – ver cómo pipeline maneja priorización.

Métricas clave a recolectar:

Tasa de aprobación (approval rate):Proporción de respuestas finales que pasan la validación estricta (is_valid=true). Idealmente, en un entorno de prueba controlado con preguntas respondibles, buscamos una tasa alta (>90%). Si es baja, indica que o bien el modelo está alucinando o nuestros filtros son demasiado severos/inhibiendo respuesta. Habrá que calibrar.

Alucinaciones detectadas:Contar cuántas respuestas tuvieronissuesmarcados como**unsupported_claim**o**contradiction**en la validación. Esto complementa la métrica anterior; por ejemplo, quizás todas las respuestas pasan menos una que tuvo 2 hallazgos de alucinación. También medir por respuesta cuántas afirmaciones no verificadas hubo en promedio. Este número idealmente tiende a 0 a medida que afinamos prompts y filtros.

Retries promedio (fase 2):En qué proporción necesitó la fase2 hacer una segunda llamada (o tercera) para completar la info. Esto nos dice qué tan bien la fase1 está surtiendo buenas fuentes y qué tan bien la primera pasada responde. Un valor de, digamos, 1.2 intentos en promedio significa la mayoría con una sola llamada y alguna con dos. Si vemos >1.5, puede indicar que la fase1 está dejando fuera cosas importantes con frecuencia (quizá debamos aumentar N inicial de URLs) o que el modelo no está aprovechando bien todas en el primer intento (quizá necesitando más instrucciones). Esta métrica afecta la latencia y costo, así que es relevante optimizarla.

Latencia por fase:Promedio de tiempo que toma cada fase:

Fase1: desde que se recibe pregunta hasta obtención de resultados y meta (incluye tiempo de búsqueda web).

Fase2: desde recibidos candidatos hasta obtención de draft (incluye llamadas a Gemini con URL Context).

Fase3: desde recibida respuesta draft hasta validación final (incluye fetch de fuentes y modelo verificador).

Supongamos en pruebas: fase1 ~1.5s (búsqueda rápida), fase2 ~4s (Gemini respondiendo con 3 URLs), fase3 ~3s (verificación). Totales ~8-10s. Si vemos fases mucho más lentas, identificar cuellos de botella (ej. PDF muy lento). También ver desviación estándar: si PDFs hacen fase2 variar de 4s a 10s, podríamos condicionar a no usar más de X PDFs a la vez.

Costo promedio en tokens (y USD) por pregunta:Sumar los tokens utilizados en fase2 (prompt + herramientas + respuesta) y en fase3 (validación). Fase1 no usa modelo (si es search API externa) o usa pocos tokens si con search tool. Importa más fase2. Por ejemplo, si promedio fase2 = 5k tokens prompt (por URLs) + 300 respuesta, y fase3 = 1k tokens (verifier output). Total ~6.3k tokens. Con precios de Gemini (imaginemos $0.001/1k for input, etc.), eso equivale a ~$0.006 por query. Esto está bien. Queremos monitorear este coste para asegurar escalabilidad. Si alguna query con PDF llegó a 15k tokens, notarlo. Establecer un presupuesto por respuesta y ver cuántas lo exceden.

Cobertura de fuentes:(Métrica interna) Porcentaje de respuestas en las que cada fuente seleccionada fue efectivamente usada (podemos medir cuántas**selected**llegaron a**used_sources**). Esto evalúa la pertinencia de fase1. Si vemos que a menudo ponemos 5 URLs pero el modelo solo usa 2 (las otras quizás no mencionadas en metadata), podemos ajustar para no mandar tantas, o revisar por qué ignora algunas (quizá eran menos relevantes de lo pensado).

Precisión vs. sensibilidad en validación:(si se evalúa manualmente) Asegurar que nuestro validador no esté marcando en rojo cosas correctas (false positives) ni dejando pasar errores (false negatives). Esto se evalúa inspeccionando algunos casos a mano. Aunque no es métrica numérica, es parte del plan de pruebas: revisar manualmente unas cuantas respuestas validadas para afinar los criterios.

Realizando pruebas con los casos arriba descritos y midiendo estas métricas, podremos iterar sobre el pipeline. Por ejemplo, si notamos que PDFs muy grandes casi siempre fallan gating de especificidad, podríamos decidir excluirlos upfront o sumariarlos. O si la latencia de fase3 sube mucho con más de 5 fuentes, quizás limitar fuentes o mejorar el enfoque de validación (tal vez no pasar texto completo sino la respuesta del modelo con referencias incorporadas, etc.).

En conclusión, este plan de pruebas nos garantiza que la integración de URL Context cumpla su cometido:respuestas correctas, bien fundamentadas, sin alucinaciones, entregadas de forma eficiente. Al cubrir distintos tipos de contenido y medir resultados, podremos pulir la solución antes de su uso en producción educativa. Con esto, aseguramos una alta confianza en que la información proporcionada al usuario final es verídica y respaldada por las fuentes consultadas.

Fuentes:Hemos citado documentación oficial de Google y blogs técnicos a lo largo del reporte para sustentar el funcionamiento de URL Context[[1]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20de%20contexto%20de,fundamentar%20y%20mejorar%20su%20respuesta)[[2]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20Contexto%20de%20URL,su%20contenido%20en%20tiempo%20real)[[11]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Cuando%20el%20modelo%20usa%20la,la%20verificaci%C3%B3n%20y%20la%20depuraci%C3%B3n)[[3]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20puede%20extraer%20contenido,los%20siguientes%20tipos%20de%20contenido)[[6]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=No%20se%20admiten%20los%20siguientes,tipos%20de%20contenido), sus limitaciones[[15]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=llamadas%20a%20funciones.%20,sola%20URL%20es%20de%2034%C2%A0MB)[[6]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=No%20se%20admiten%20los%20siguientes,tipos%20de%20contenido), y las mejores prácticas combinadas con Google Search[[24]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Fundamentaci%C3%B3n%20con%20la%20b%C3%BAsqueda). Estas referencias apoyan nuestras afirmaciones sobre cómo opera la herramienta y las consideraciones al usarla en este pipeline.




[[1]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20de%20contexto%20de,fundamentar%20y%20mejorar%20su%20respuesta)[[2]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20Contexto%20de%20URL,su%20contenido%20en%20tiempo%20real)[[3]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=La%20herramienta%20puede%20extraer%20contenido,los%20siguientes%20tipos%20de%20contenido)[[4]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,PDF%20%28application%2Fpdf)[[6]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=No%20se%20admiten%20los%20siguientes,tipos%20de%20contenido)[[7]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,Archivos%20de%20audio%20y%20video)[[8]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,Archivos%20de%20audio%20y%20video)[[9]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,com)[[10]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,las%20URLs%20que%20proporciones%20no)[[11]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Cuando%20el%20modelo%20usa%20la,la%20verificaci%C3%B3n%20y%20la%20depuraci%C3%B3n)[[12]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,chicken)[[13]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%22url_metadata%22%3A%20%5B%20%7B%20%22retrieved_url%22%3A%20%22https%3A%2F%2Fwww.foodnetwork.com%2Frecipes%2Fina,chicken)[[15]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=llamadas%20a%20funciones.%20,sola%20URL%20es%20de%2034%C2%A0MB)[[16]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=,sola%20URL%20es%20de%2034%C2%A0MB)[[18]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Recuento%20de%20tokens)[[19]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%27prompt_token_count%27%3A%2027%2C%20%27prompt_tokens_details%27%3A%20%5B%7B%27modality%27%3A%20,%27token_count%27%3A%2010309%7D%5D%2C%20%27total_token_count%27%3A%2010412)[[20]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=%27tool_use_prompt_tokens_details%27%3A%20%5B%7B%27modality%27%3A%20,%27total_token_count%27%3A%2010412)[[24]](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419#:~:text=Fundamentaci%C3%B3n%20con%20la%20b%C3%BAsqueda)URL context  |  Gemini API  |  Google AI for Developers

[https://ai.google.dev/gemini-api/docs/url-context?hl=es-419](https://ai.google.dev/gemini-api/docs/url-context?hl=es-419)

[[5]](https://medium.com/@pankaj_pandey/geminis-url-context-now-ga-practical-guide-real-world-uses-3242e0911e73#:~:text=,support%20agents%20on%20customer%20sites)Gemini’s URL Context, Now GA: Practical Guide & Real-World Uses | by Pankaj | Aug, 2025 | Medium

[https://medium.com/@pankaj_pandey/geminis-url-context-now-ga-practical-guide-real-world-uses-3242e0911e73](https://medium.com/@pankaj_pandey/geminis-url-context-now-ga-practical-guide-real-world-uses-3242e0911e73)

[[14]](https://ai.google.dev/api/generate-content#UrlContextMetadata#:~:text=Enums%20,because%20the%20content%20is%20unsafe)[[17]](https://ai.google.dev/api/generate-content#UrlContextMetadata#:~:text=,the%20content%20is%20behind%20paywall)Generating content  |  Gemini API  |  Google AI for Developers

[https://ai.google.dev/api/generate-content](https://ai.google.dev/api/generate-content)

[[21]](https://developers.googleblog.com/url-context-tool-for-gemini-api-now-generally-available/#:~:text=Context%20tool%20is%20now%20ready,your%20costs%20clear%20and%20predictable)URL context tool for Gemini API now generally available- Google Developers Blog

[https://developers.googleblog.com/url-context-tool-for-gemini-api-now-generally-available/](https://developers.googleblog.com/url-context-tool-for-gemini-api-now-generally-available/)

[[22]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,site%20with%20the%20information%20itself)[[23]](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d#:~:text=This%20is%20an%20array%20of,attributes%20in%20each%20array%20element)Grounding Results with Google Search, Gemini, and LangChainJS | by Allen Firstenberg | Medium

[https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d](https://medium.com/@afirstenberg/grounding-results-with-google-search-gemini-and-langchainjs-b2ccacdbbc2d)
```
