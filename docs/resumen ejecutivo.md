Resumen Ejecutivo

Visión general:Para construir un pipeline robusto de“URL Context”optimizado en tres fases (Búsqueda → Recuperación → Validación profunda), se identificaron herramientas open source líderes en cada bloque. En lafase debúsqueda, destaca el uso de un meta-buscador de código abierto (p. ej., SearXNG) que agrega resultados de múltiples motores[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled). Para lafase derecuperación(fetching & parsing), existen librerías robustas de extracción de contenido principal tanto en HTML como PDF: por ejemplo, en Node.js sobresaleExtractus Article Extractor(derivado de Mercury/Article-Parser) para aislar texto relevante[[2]](https://github.com/extractus/article-extractor#:~:text=To%20extract%20main%20article%20from,js), mientras en Python destacanTrafilatura(máxima precisión enboilerplate removalsegún benchmarks[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201)) yGoose3/Newspaper3k(alternativas MIT/Apache). Complementariamente, se recomiendan clientes HTTP resilientes (requests/httpx en Python[[4]](https://pypi.org/project/httpx/0.7.5/#:~:text=is%20BSD%20licensed%20code,Changelog), got/axios en Node) con retries y opciones deheadless(Playwright/Puppeteer) comofallbackpara páginas pesadas en JS. En lafase devalidación profunda, herramientas comoSimhash/MinHashdetectan duplicados cercanos (técnica usada por Google para webs similares[[5]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages)), y heurísticas/librerías para identificarsoft-404s(ej. comparativa de contenido con un URL inexistente[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good)), páginas de índice opaywalls. Finalmente, paraobservabilidad y seguridad, el estándarOpenTelemetryproporciona instrumentación unificada de logs, métricas y trazas[[7]](https://www.dynatrace.com/news/blog/what-is-opentelemetry/#:~:text=OpenTelemetry%20is%20an%20open,in%20the%20world%20of%20observability), mientras librerías especializadas endurecen la seguridad: p. ej.,ssrf-protect(Python) odssrf(Node) validan URLs contra SSRF (normalizando URL, resolviendo DNS e impidiendo IP internas)[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden)[[9]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Server,vulnerabilities%20in%20modern%20web%20applications). Todas las herramientas recomendadas son activamente mantenidas y de licencia mayormente permisiva (MIT/Apache2), priorizando calidad de extracción, rendimiento y facilidad de integración en pipelines Node/TS o Python.

Resumen por bloques:
-Búsqueda/Descubrimiento:SearXNG(metabuscador AGPL-3.0, activo) para recuperar múltiples fuentes relevantes[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled). Alternativamente, integrar APIs de búsqueda (Bing/Google) si se permiten servicios externos (con caches para controlar costo).
-Recuperación & Extracción:Article Extractor(Node, MIT, última actualización ~2025[[10]](https://github.com/extractus#:~:text=extractus%2Farticle,There%20was%20an%20error)) yMozilla Readability(JS, MPL) para extracción HTML con alta fidelidad[[11]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Mozilla%20Readability); en Python,Trafilatura(GPLv3, última versión 2025, sobresaliente en precisión[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201)) oGoose3(Apache-2.0, mantenido activamente[[12]](https://github.com/goose3/goose3#:~:text=License)) para obtener texto limpio, metadatos (título, autor, fecha) y conservar estructura básica.PDFPlumber(Python, MIT) para PDFs estructurados (tablas, texto)[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2), conPyTesseractopcional (Apache-2.0) en casos de imágenes escaneadas. Clientes HTTP robustos (con backoff, timeouts):httpx(Python, async, BSD-3-Clause[[4]](https://pypi.org/project/httpx/0.7.5/#:~:text=is%20BSD%20licensed%20code,Changelog)) ogot(Node, retries y HTTP2).Headless browsers:Playwright(Node/Python, Apache-2.0) para cargar páginas dinámicas solo cuando detectemos contenido vacío o bloqueos (latencia ~2-5s extra por página).
-Validación & Ranking:Reglas para rechazar content vacíos o genéricos: detectarsoft-404(usar heurística decontenido duplicado con URL falso[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good)), detectarhomepageso índices (ej. conteo anómalo de enlaces vs texto).Simhash/MinHash(MIT/Apache) para eliminar duplicados cercanos (≥ 80–90% similar).Rankinginicial por puntaje heurístico: combinar relevancia (p. ej. BM25 usando librerías como**rank-bm25**en Python), longitud/calidad del texto extraído, y señales de fuente (dominio confiable, presencia de fecha/autoría). Paraobservabilidad, integrarOpenTelemetry(CNCF, Apache-2.0) en cada componente para rastreo de requests, uso dePrometheusclient (MIT) para métricas (p. ej., tiempo de respuesta por fuente) y logging estructurado (Winstonen Node,Structlogen Python). Enseguridad, aplicarSSRF hardeningcon librerías que validan URLs resolviendo DNS (bloquean IPs privadas, localhost, esquemas no HTTP)[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden), sanitizar entradas (ej. eliminar inyección en logs), usarblocklists/allowlistsde dominios, y limitar tasa de requests por dominio (evitar sobrecargar sitios y controlar costo). Estas herramientas combinadas aseguran un pipelinepreciso, eficiente y seguro, minimizando “alucinaciones” al alimentar a los modelos solo con contenido verificado y relevante.

Matriz Comparativa de Herramientas

| Categoría                 | Herramienta/Repo                                                                                                                                                                                                                                                                                                                                                                                                       | Lenguaje          | Licencia                                                                                                              | ¿Qué resuelve?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pros                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Contras                                                                                                                                                                                                                                                                                                                                                                                                                                      | Señales de mantenimiento                                                                                                                                                                                                                                                                                                                                                                      | Puntajes(Robustez, ExtracCalidad, Rendimiento, Integración, Mantenim., Seguridad, Compatibilidad)                                                                                                                                                                                                                                                                                                                                                                                            | Fase                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Metabuscador (Discovery)  | SearXNG–Metasearch engine[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled)                                                                                                                                                                                                                                                                 | Python (Docker)   | AGPL-3.0[[14]](https://github.com/searxng/searxng#:~:text=License)                                                    | Agrega resultados de múltiples motores (Google, Bing, etc.) sin tracking del usuario[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled). Permite búsqueda unificada vía API propia.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | + Privacidad (no tracking)[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled);`<br>`+ Altamente configurable (hasta ~70+motores)[[15]](https://www.reddit.com/r/Searx/comments/1nm3n1q/search_results_not_as_good_as_individual_search/#:~:text=r%2FSearx%20www,more%20than%2070%20search%20services);`<br>`+ Comunidad activa (24k★) y releases frecuentes.                                                                                                                                                     | – Licencia AGPL (incompatibilidad si proyecto privativo);`<br>`– Despliegue requiere hosting propio + mantenimiento de instancias.                                                                                                                                                                                                                                                                                                           | 9k+ commits, últimos cambios recientes (ej. Docker actualizado “2 days ago”[[16]](https://directory.fsf.org/wiki/Searxng#:~:text=most%20recent%20revision,searxng)). Comunidad robusta (24k estrellas) indicando adopción[[17]](https://github.com/searxng/searxng#:~:text=,63).                                                                                                              | 5/5/4/3/5/4/5– Robusto en agregación, alta calidad de resultados; rendimiento aceptable (cacheable), integración moderada (API JSON); mantenido; seguridad buena (evita llamadas directas a terceros); encaja perfecto en fase 1.                                                                                                                                                                                                                                                            | 1 (Búsqueda)        |
| Crawling & Fetch          | Scrapy–Framework de crawling[[18]](https://github.com/fhamborg/news-please#:~:text=news,Newspaper%20%2C%20and%20%2093)                                                                                                                                                                                                                                                                                                 | Python            | BSD-3-Clause[[19]](https://github.com/scrapy/scrapy#:~:text=Scrapy%2C%20a%20fast%20high,2k%20forks%20Branches%20Tags) | Rastrear y descargar páginas con soporte a paralelismo, colas, politicas derobots.txty pipelines de parseo. Adecuado si se necesita crawl extensivo o politicas robustas deretry/backoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | + Muy robusto y probado en crawling a gran escala;`<br>`+ Mecanismos integrados demiddlewares(redirects, user-agents, auto-throttle);`<br>`+ Extensible (pipelines para limpiar HTML, integración con Splash para JS).                                                                                                                                                                                                                                                                                                                                                                     | – Overkill para <10 URLs por búsqueda (setup complejo);`<br>`– No extrae texto principal por defecto (requiere custom parse o usar Newspaper/Readability dentro).                                                                                                                                                                                                                                                                            | ~60k★ en GitHub, actualizado a Py3.12 recientemente[[19]](https://github.com/scrapy/scrapy#:~:text=Scrapy%2C%20a%20fast%20high,2k%20forks%20Branches%20Tags). Versión 2.14.x activa en 2025, issues activos. Amplia comunidad & docs.                                                                                                                                                         | 5/3/4/3/5/4/4– Excelente robustez (reintentos, fallos de red); extracción bruta OK (pero requiere complemento para main text); muy buen rendimiento en crawling concurrente; integración compleja (framework opinionado); mantenibilidad alta; seguridad media (necesita añadir SSRF filters manualmente); encaja fase 2 (si crawling masivo).                                                                                                                                               | 2 (Recuperación)    |
| Extractor HTML (Node)     | Extractus Article Extractor[[2]](https://github.com/extractus/article-extractor#:~:text=To%20extract%20main%20article%20from,js)(antes Mercury)                                                                                                                                                                                                                                                                        | Node.js (TS)      | MIT[[20]](https://github.com/extractus/article-extractor#:~:text=License)                                             | Extrae el artículo principal, título, autor, fecha e imagen principal de una URL dada (automatiza “lector” similar a Mercury). Funciona con promesas o CLI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | + Alta calidad de extracción (limpia menús/ads, preserva subtítulos, listas)[[11]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Mozilla%20Readability);`<br>`+ Incluye meta-datos (autor, fecha) y resumen (excerpt);`<br>`+ Actualizado regularmente (v8.0.x en 2025) y pruebas integradas.                                                                                                                                                                                                           | – Puede fallar en páginas muy dinámicas (JS pesado) sin pre-render;`<br>`– No soporta PDF ni OCR (solo HTML);`<br>`– MPL dep (Readability) implica licenciamiento MPL transitivo.                                                                                                                                                                                                                                                            | ~1.9k★ GitHub, commit activo Sep 2025[[10]](https://github.com/extractus#:~:text=extractus%2Farticle,There%20was%20an%20error). Folk derivado dearticle-parser, mantenimiento continuo por comunidad (commits + CI tests)[[21]](https://github.com/extractus/article-extractor#:~:text=Name%20Name)[[10]](https://github.com/extractus#:~:text=extractus%2Farticle,There%20was%20an%20error). | 4/5/5/5/5/4/5– Robusto en HTML (redirects y casos edge manejados, salvo JS extremo); extracciónexcelente(signal-noise alto[[11]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Mozilla%20Readability)); muy buen rendimiento (rápido en Node, sin dependencias pesadas); fácil integración (NPM, simple API); activo; seguridad: respetar misma-origin fetch en servidor; totalmente alineado con fase 2. | 2 (Recuperación)    |
| Extractor HTML (Python)   | Trafilatura[[22]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=,scraping%20%2A%20Requires%3A%20Python%20%3E%3D3.6)[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201)                                                                                                                                                                                                                    | Python            | GPL-3.0+[[23]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=)                                                  | Descarga y extrae el texto principal, metadatos (título, autores, fecha) y comentarios opcional de páginas web. Incluye limpieza de boilerplate usando combinación de heurísticas (densidad de texto, jusText, readability)[[24]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=). Soporta entrada de HTML crudo y tiene caching.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | + Máxima precisión en benchmarks (F1≈0.91 superando otras libs)[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201);`<br>`+ Maneja casos difíciles: contenido paginado, idiomas distintos, detección de fechas y autores integrado;`<br>`+ Permitefeeds, sitemaps y crawling básico con respeto arobots.txt.                                                                                                                                                                                                                                                         | – Licencia GPL obliga a uso aislado (p.ej. servicio separado) si la solución no es open-source;`<br>`– Más lento que librerías simples (usa parseos múltiples, ~7x baseline)[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201);`<br>`– Instalación algo pesada (requiere lxml, etc.).                                                                                                                                | Proyecto academicamente respaldado (Adrien Barbaresi). Último release v1.6 en 2025, activo en PyPI. Reconocida por Scrapinghub y publicaciones científicas[[25]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=).                                                                                                                                                                       | 5/5/3/4/4/3/5– Muy robusta (maneja edge cases, hasta comentarios); extracción dealtísima calidad(mejor F1); rendimiento moderado; integración sencilla en Python (API funcional, CLI); mantenibilidad buena (active dev); seguridad: requiere añadir validación URL externa; encaje total en fase 2 (contenido).                                                                                                                                                                             | 2 (Recuperación)    |
| Extractor Noticias        | News-Please[[18]](https://github.com/fhamborg/news-please#:~:text=news,Newspaper%20%2C%20and%20%2093)[[26]](https://pypi.org/project/news-please/#:~:text=news)                                                                                                                                                                                                                                                        | Python            | Apache-2.0[[27]](https://pypi.org/project/news-please/#:~:text=,information%20%2C%20%20retrieval)                     | Crawler + extractor especializado en noticias. Combina Scrapy (crawling), Newspaper3k & Readability para extraer artículos completos de sitios de noticias con un solo comando[[18]](https://github.com/fhamborg/news-please#:~:text=news,Newspaper%20%2C%20and%20%2093). Puede rastrear un medio completo (via RSS/sitemaps) o extraer lista de URLs dada (modo librería).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | + Soluciónend-to-endpara noticias (descarga, deduplicación por título, exporta JSON/CSV);`<br>`+ Extrae campos estructurados: titular, bajada, texto, autores, fecha, imágenes[[28]](https://github.com/fhamborg/news-please#:~:text=json%20file%20as%20extracted%20by,please%20can%20be%20found%20here);`<br>`+ Soporta Common Crawl News (procesa archivos WARC).                                                                                                                                                                                                                        | – Enfoque en noticias: puede no rendir igual con páginas no periodísticas;`<br>`– Peso considerable (usa Scrapy + varias libs internas);`<br>`– Configuración de crawling requiere ajuste para evitar sobrecarga.                                                                                                                                                                                                                            | Activo: versión 1.6.16 (Sep 2025)[[26]](https://pypi.org/project/news-please/#:~:text=news)con soporte Py3.12. Mantenido por comunidad académica (Felix Hamborg). ~1.4k★, releases regulares en 2024-2025[[29]](https://pypi.org/project/news-please/#:~:text=1).                                                                                                                             | 4/4/4/3/4/4/4– Robustez alta en entorno noticias (múltiples libs redundantes); calidad de extracción buena (usa Newspaper/Readability, pero no tan preciso como Trafilatura); rendimiento aceptable (Scrapy concurrency), pero pesado; integración media (mucha dependencia); bien mantenido; seguridad: mismo caveat de requests; encaja principalmente en fase 2 (cuando el contexto es noticias).                                                                                         | 1→2 (Búsq.+Recup.)  |
| Extractor PDF             | pdfplumber[[30]](https://pypi.org/project/pdfplumber/#:~:text=pdfplumber%20,splitting%2C%20merging%2C%20cropping%2C%20and)[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2)                                                                                                                                                                                                                               | Python            | MIT[[30]](https://pypi.org/project/pdfplumber/#:~:text=pdfplumber%20,splitting%2C%20merging%2C%20cropping%2C%20and)   | Biblioteca para extraer textoy estructurade PDFs. Construida sobre PDFMiner, facilita extraer párrafos, tablas (detecta líneas/celdas), imágenes y coordenadas de cada texto. Ideal para obtener contenido legible y conservar organización (ej. tablas a CSV).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | + Extracción granular: permite eliminar encabezados/pies repetitivos, recombinar columnas;`<br>`+ Maneja PDFs complejos (tablas con bordes, text wrapping) mejor que extractores simples;`<br>`+ Mantenimiento activo (v2023.12.28)[[31]](https://deps.dev/pypi/pdfplumber/0.11.0/dependencies?filter=license%3A%22non-standard%22#:~:text=Dependencies%20,analyzer%2C%20Advisories%20in%20this), comunidad de usuarios amplia (documentación y ejemplos).                                                                                                                                 | – No realiza OCR (necesario usar PyTesseract aparte para PDFs escaneados);`<br>`– Más lento que PyMuPDF en PDFs muy grandes (PDFMiner es puro Python);`<br>`– Sin soporte nativo en Node (requeriría microservicio Python).                                                                                                                                                                                                                  | Último release Dec 2023[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2), con commits hasta 2024. Desarrollador principal activo (Jeremy Singer-Vine). Alto uso en data journalism.                                                                                                                                                                                              | 5/5/3/4/5/4/5– Robusto en variedad de PDFs (formularios, multipágina); extracción de alta calidad (respeta estructura, tablas); rendimiento medio (OK para docs cortos, pesado >100p); fácil de integrar en Python; bien mantenido; seguridad alta (no ejecuta código, solo parsing); encaja fase 2 para PDF (y fase 3 si se analiza calidad del contenido).                                                                                                                                 | 2 (Recuperación)    |
| Detección duplicados      | Simhash (Py)[[32]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages)/MinHash                                                                                                                                                                                                                                | Python/Node       | MIT (simhash)                                                                                                         | Algoritmos denear-duplicate detection.Simhashgenera una huella difusa donde documentos similares producen hashes cercanos[[32]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages);MinHashestima Jaccard de conjuntos deshingles. Útiles para identificar si dos URLs devuelven contenido esencialmente igual (por ej., mirror o copia).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | + Muy eficientes: simhash es O(n) por doc, comparaciones rápidas bit a bit;`<br>`+ Implementaciones disponibles en Py (C extension por SeoMoz[[33]](https://github.com/seomoz/simhash-py#:~:text=seomoz%2Fsimhash,simhash%20using%20a%20C%2B%2B%20extension)) y JS (algoritmos existentes) – se pueden integrar fácilmente;`<br>`+ Permiten deduplicación escalable en muchas páginas (usado por Google para web index[[5]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages)). | – Simhash puede dar falsos positivos con textos diferentes pero con mismas palabras frecuentes (necesaria afinación de stopwords);`<br>`– MinHash requiere ajustar número de hashes y umbral de similitud;`<br>`– Librerías JS menos mantenidas; posible tener que portar algoritmo manualmente en Node.                                                                                                                                     | Python simhash última release 2022[[34]](https://pypi.org/project/simhash/#:~:text=Released%3A%20Mar%202%2C%202022%20A,not%20provided%20a%20project%20description)(paquete simple pero funcional). Alternativa:**datasketch**(MIT, activo) ofrece MinHash configurable. Estas técnicas son maduras y ampliamente documentadas (no requieren lib muy activa).                                  | 4/4/5/4/4/4/5– Robustez buena (identifica duplicados incluso con pequeñas diferencias); calidad: mantiene contenido único; rendimiento excelente (hashing rápido); integración sencilla (usar lib o función); mantenibilidad neutral (poca actualización requerida); seguridad n/a (no externo); vital en fase 3 para compatibilidad con anti-hallucination (evita repetir contextos).                                                                                                       | 3 (Validación)      |
| Soft-404 / Calidad página | Soft404 heuristics(ej.benhoyt/soft404)[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good)                                                                                                                                                                                                                                                            | Python (script)   | MIT (script)                                                                                                          | Algoritmo para detectarsoft-404: páginas que devuelven 200 OK pero en realidad son "no encontradas". Estrategia del script de Ben Hoyt (2010) implementa técnica de Tomkins et al.: compara la página objetivo con el contenido de un URL ficticio en el mismo sitio[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good). Si son casi idénticas, la original es soft-404; si difieren, es válida.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | + Enfoque inteligente que evita solo buscar palabras "Not Found": detecta casos en que servidores devuelven home genérica en lugar de 404[[35]](https://github.com/benhoyt/soft404#:~:text=properly%20detect%20dead%20pages,trivial%20to%20detect)[[36]](https://github.com/benhoyt/soft404#:~:text=But%20if%20the%20known%20dead,must%20be%20a%20good%20page);`<br>`+ Fácil de implementar con cualquier extractor de texto y comparador (e.g., similitud Jaccard entre contenidos);`<br>`+ Minimiza falsos negativos (se adapta a cada sitio probándolo).                                | – Requiere2 fetchespor URL (aumenta latencia y costo de fase 3);`<br>`– No disponible como librería mantenida (el repo original está archivado) – se implementa custom;`<br>`– Puede fallar en sitios que devuelven páginas dinámicas distintas cada vez (difícil comparar).                                                                                                                                                                 | Técnica citada en publicaciones; el script es corto (100 líneas) y puede actualizarse fácilmente. No tiene comunidad activa por sí, pero su lógica sigue válida.                                                                                                                                                                                                                              | 4/3/3/3/3/4/5– Robusto en detectar soft-404 en muchos casos; calidad de verificación decente (no perfecta si site randomiza contenido); rendimiento bajo (doble request, pero solo fase validación final); integración manual; mantenibilidad sencilla (poco código); seguridad: cuidado con fetch extra pero mitigable; crucial fase 3 (filtra basura).                                                                                                                                     | 3 (Validación)      |
| Ranking (Relevancia)      | Rank-BM25(Py) /Elastic-Lite                                                                                                                                                                                                                                                                                                                                                                                            | Python/Node       | MIT                                                                                                                   | Implementación ligera del algoritmoBM25para ranking de textos. Dado el query original y los textos extraídos, calcula una puntuación de relevancia basada en term frequency & document length. Útil para reordenar las fuentes antes de la respuesta final. (Alternativas:Whoosh,lunr.jspara indexación local).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | + Muy fácil de usar: inicializar con docs y hacer**.get_scores(query)**;`<br>`+ Sin dependencias pesadas (puro Python, <200 LOC); rápido para decenas de docs;`<br>`+ Mejora pertinencia: prioriza fuentes cuyo contenido coincide más con la consulta, complementando el orden del motor de búsqueda.                                                                                                                                                                                                                                                                                     | – Modelo léxico: no capta sinónimos ni contexto semántico profundo (posible usar embeddings si se requiere más precisión);`<br>`– Para pocas fuentes tal vez no cambie mucho el orden original de búsqueda;`<br>`– No disponible nativo en Node (pero lunr.js puede suplir con TF-IDF).                                                                                                                                                      | rank_bm25 última versión 0.2.2 (2021) pero estable – poco mantenimiento requerido dada su simplicidad. Alternativas más complejas (ElasticSearch/OpenSearch) son Open Source pero implican despliegue pesado.                                                                                                                                                                                 | 3/NA/5/5/5/5/5– (No aplica a extracción) Rendimiento alto (docs pequeños en mem); integración muy fácil; mantenible (código corto estable); seguridad buena (no externo); encaja fase 3 como componente para scoring de relevancia.                                                                                                                                                                                                                                                          | 3 (Validación)      |
| Observabilidad            | OpenTelemetry SDK[[7]](https://www.dynatrace.com/news/blog/what-is-opentelemetry/#:~:text=OpenTelemetry%20is%20an%20open,in%20the%20world%20of%20observability)                                                                                                                                                                                                                                                        | Multi (Python/TS) | Apache-2.0                                                                                                            | Estándar CNCF para instrumentar telemetría (trazas distribuidas, métricas y logs) de apps. Ofrece APIs para registrar spans (e.g. fetch de cada URL como span hijo), medir latencias, contadores de eventos, etc., con exportadores a herramientas (Jaeger, Prometheus, etc.). Aporta monitoreo completo del pipeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | + Enfoque unificado: una sola librería/código para logs estructurados, métricas de rendimiento y trazas[[7]](https://www.dynatrace.com/news/blog/what-is-opentelemetry/#:~:text=OpenTelemetry%20is%20an%20open,in%20the%20world%20of%20observability);`<br>`+ Soporta múltiples idiomas: hay SDK para Node y Python, facilitando estrategia consistente en ambos stacks;`<br>`+ Integración con OpenTelemetry Collector para centralizar datos; amplio soporte por la industria (estándar de facto).                                                                                       | – Curva de aprendizaje: requiere configurar tracer providers, exporters – overhead inicial de implementación;`<br>`– Puede añadiroverheadligero en rendimiento (captura de métricas y trazas);`<br>`– Licencia Apache es permisiva, pero hay que velar por no exportar datos sensibles sin sanitizar (no es un “problema” de la herramienta en sí).                                                                                          | Proyecto muy activo (bajo CNCF). Versiones estables 1.x en 2025. Amplio ecosistema de contribuciones (soportado por Google, Microsoft, Dynatrace, etc.). Comunidad + especificación sólida.                                                                                                                                                                                                   | NA/NA/4/3/5/5/5– (No aplicable a extracción de contenido) Rendimiento razonable (aunque añade meta-datos); integración moderada (necesita instrumentar el código); mantenibilidad alta (comunidad CNCF);criticopara fase 2/3 en monitoreo, y seguridad/compatibilidad (evita cajas negras, visibilidad completa del pipeline).                                                                                                                                                               | X (Transversal)     |
| Seguridad (SSRF & URL)    | dssrf (Node)[[9]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Server,vulnerabilities%20in%20modern%20web%20applications)[[37]](https://github.com/HackingRepo/dssrf-js#:~:text=License)/ssrf-protect (Py)[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden) | Node.js / Python  | MIT                                                                                                                   | Librerías especializadas en prevenir SSRF.dssrfnormaliza URLs, resuelve DNS e inspecciona cada redirección, permitiendo solo esquemas http/https y bloqueando IP locales, enlaces con credenciales o unicode engañoso[[38]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Instead%20of%20blacklists%2C%20dssrf%20uses,a%20multi%E2%80%91step%2C%20safe%E2%80%91by%E2%80%91construction%20approach)[[39]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=,Redirect%20chain%20validation).ssrf-protectofrece validación sencilla en Python (lanza excepción si URL apunta a IP privada o loopback)[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden). Ambas ayudan a asegurar que las URL externas no accedan recursos internos. | + Implementan mejores prácticas OWASP automáticamente (filtros de IPv4/IPv6 locales, blacklist de metadata cloud, etc.)[[39]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=,Redirect%20chain%20validation);`<br>`+ dssrf en TS incluye definiciones para integrar fácil en Node (middleware o wrapper fetch); ssrf-protect se integra con requests antes del .get()[[40]](https://github.com/kobotoolbox/ssrf-protect#:~:text=Trivial%20case);`<br>`+ MIT License, se pueden usar en proyectos comerciales sin problema.  | – Proyectos relativamente nuevos/poco maduros (dssrf lanzado 2025 con 3★[[41]](https://github.com/HackingRepo/dssrf-js#:~:text=MIT%20license), ssrf-protect con 1★); verificar a medida que crezcan;`<br>`– dssrf aún sin amplia adopción, podría tener edge cases no cubiertos; ssrf-protect es básico (no cubre redirecciones, p. ej.);`<br>`– Añaden pequeña carga de DNS lookup sin caching (posible mitigarlo con cache global de DNS). | dssrf creado Dic 2025 por investigador seguridad (activo en dev.to). Código abierto en GitHub MIT[[37]](https://github.com/HackingRepo/dssrf-js#:~:text=License). ssrf-protect por Kobotoolbox (2019), no muy activo pero funcional. La necesidad SSRF es conocida; pueden aparecer más herramientas, pero estas muestran señales de adopción emergente.                                      | 5/NA/4/4/3/5/5– Robustece la etapa defetchsignificativamente; (no aplicable a extracción); desempeño bueno (resolución DNS rápida, pero impacta un poco latencia); integración sencilla (función**validate(url)**antes de fetch); mantenibilidad moderada (código simple, comunidad pequeña por ahora);critico en seguridad(mitiga vector SSRF); encaja fase 2 (antes de cada request) y transversal.                                                                                        | 2→3 (Recup.+Valid.) |

(Puntajes: 1–5 donde 5 es el mejor. Las columnas corresponden a: Robustez en edge cases, Calidad de extracción, Rendimiento, Facilidad de integración, Mantenibilidad, Seguridad, Compatibilidad con pipeline de 3 fases.)Se priorizaron licencias permisivas (MIT/Apache) siempre que fue posible. En casos GPL/AGPL (marcados), sugerimos aislar su uso en servicios independientes si la aplicación final no puede ser GPL.

Arquitectura Sugerida (Stack Composable)

A continuación, se proponen dosstacksde implementación end-to-end – uno priorizando Node/TypeScript y otro Python – detallando cómo cada componente encaja en el flujo deBúsqueda → Recuperación → Validación Profunda:

Stack Node/TypeScript-first

Descripción general:En este enfoque, Node.js orquesta todo el pipeline, aprovechando librerías en TS/JS para búsqueda web, scraping HTML y lógica de control, mientras delega a servicios auxiliares solo cuando necesario (p.ej., Python para PDF u OCR). Es ideal si ya se tiene infraestructura en Node, permitiendo integración directa con aplicaciones web/Backends JS.

Flujo End-to-End (Node):

Búsqueda (Node):La aplicación recibe la consulta y utiliza un conector Node hacia un buscador. Opciones:

Llamar a una instancia SearXNG via HTTP (usando**node-fetch/axios**), obteniendo resultados en JSON[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled). La respuesta se parsea para extraer las top N URLs relevantes.

(Alternativa): Usar la API de Bing Web Search u otro servicio, manejando la autenticación y luego normalizando resultados (esto no es open source, pero puede ser unquick wininicial antes de montar SearXNG).

Filtrar resultados obvios: eliminar URLs duplicadas o dominio repetido excesivamente; aplicar un blocklist de dominios poco confiables.

Recuperación HTML (Node):Para cada URL candidata:

Fetch:Se usa una librería HTTP robusta como**got**con timeouts y follow-redirects. Antes de la petición, se valida la URL condssrf: se normaliza y verifica DNS (rechaza si es privada)[[38]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Instead%20of%20blacklists%2C%20dssrf%20uses,a%20multi%E2%80%91step%2C%20safe%E2%80%91by%E2%80%91construction%20approach). Se añade un User-Agent genérico o uno realista.

Detección de tipo:Al recibir la respuesta, se inspeja**Content-Type**.

Si es HTML (**text/html**), continuar flujo HTML.

Si es PDF (**application/pdf**o filename**.pdf**), derivar a flujo PDF.

Otros (imágenes, etc.) se descartan o manejan según caso (normalmente no útiles para texto).

Extracción HTML:UsarExtractus Article Extractor(Node). Este recibe el HTML (o la URL directa) y devuelve un objeto con**content**,**title**,**date**, etc.[[42]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Our%20analysis%20revealed%20distinct%20strengths,and%20weaknesses).

SiArticle Extractorfalla (devuelve contenido muy corto o vacío):

Verificar si la página requiere JS (p. ej., el HTML contiene mensajes tipo "enable JavaScript" o muy poco texto).Then, usarPlaywright: lanzar un browser headless en background, cargar la URL, esperar X seg a que se renderice contenido, extraer**page.content()**, luego volver a pasar ese HTML rendereado por Article Extractor.

Esto incrementa costo/latencia, así que solo se hacefallbackpara 1–2 fuentes críticas o si ninguna fuente tuvo buen contenido.

Si el HTML parece ser unhomepage/índice(por ej., Article Extractor devuelve muchos enlaces o título genérico “Inicio”):

Podemos marcarlo para validar en fase 3 (posible descarte), pero aún conservar si tiene algo de texto.

Capturar también la URL final (tras redirecciones) y código de estado. Registrar si hubo redirecciones múltiples (posible señal de mirror o contenido movido).

Extracción PDF:Si es PDF, por eficiencia llamar a un pequeño servicio Python (microservicio o función serverless):

Enviar la URL o el PDF descargado al servicio. Este correpdfplumberpara texto y tabulado[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2). Alternativamente, usarpdf.jsen Node (via**pdf-parse**npm) si se prefiere pure Node, aunque pdfplumber tiene más capacidades.

Si el PDF no tiene texto (ej: escaneado) – pdfplumber retornará vacío – el servicio puede aplicarpytesseractOCR página a página. Esto es costoso; se puede limitar a primeras páginas o según necesidad.

Retornar texto extraído (y potencialmente meta info: número de páginas, etc.).

Resultados intermedios:Para cada URL obtendremos un objeto**{url, content, title, date, sourceDomain, length, ...}**. Almacenar estos objetos en un array para fase 3.

Nota de rendimiento:Este proceso de fetch+extract se realiza preferentementeen paralelo(Node maneja bien IO concurrente). Limitar concurrencia a, digamos, 5 URLs simultáneas para no exceder límites de CPU/memoria, usando por ejemplo una queue (libreríap-queueo similar) y delay entre dominios para ser cortés. Implementar reintentos con backoff (ej. 2 intentos si fallo de red 5xx o timeout).

Validación Profunda (Node):Una vez tenemos los contenidos:

Deduplicación:Calcularsimhashde cada**content**. Comparar cada par rápidamente (XOR Hamming distance). Marcar como duplicados cercanos aquellos con distancia baja (ej. <=3 bits diferencia, configurable). Si duplicados:

Conservar solo uno (p.ej., el más completo o el de fuente más confiable). Registrar que se eliminaron duplicados para logs.

Soft-404/Homepage detection:Para cada página:

Si el extractor devolviócerotexto o texto muy corto (< ~50 palabras)yel título contiene "404" o "Not Found", marcar comosoft404.

Si sospecha pero no seguro: ejecutar la técnica delURL ficticio[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good):Tomar la URL, generar una variante inexistente (añadir**?nonexistent=1**o cambiar la última parte aleatoriamente), fetch con mismo cliente (respetando dssrf). Si devuelve 200 con HTML, extraer texto y comparar con el original (por ej., Jaccard similarity o Levenshtein entre los textos). Si son muy similares (>90% común), entonces la original era una página de error genérica → descartar o al menos puntuar muy bajo.

Homepage/Thin content:Si el texto es relativamente largo pero parece más índice que artículo:

Heurística: alto porcentaje de anchor links o la densidad de contenido informativo es baja en comparación con el HTML total. Ej: calcular % de**`<a>`**tags en el texto; si > X% del total de palabras son parte de enlaces de navegación, probablemente no es artículo.

O usar pistas en URL: si la URL es la raíz del dominio o rutas**/news/**sin artículo específico, es índice.

Marcar estos casos y bajar su puntaje luego.

Paywall detection:Si la longitud de**content**es sospechosamente corta para lo que suele ser (ej: noticia con solo un párrafo) y el dominio coincide con medio conocido de paywall (listado predefinido), marcar. También buscar palabras clave en el HTML original (antes de limpiar) como “subscribe”, “log in to read more”, etc.

Si la info es crucial:Podríamos intentar unfallbackespecial: buscar si hay versión AMP (muchos sitios ofrecen**`<link rel="amphtml" href=...>`**). De ser así, intentar fetch de AMP URL (generalmente libre de paywall). Pasar ese HTML por extractor nuevamente.

Scoring de calidad y relevancia:Ahora, asignar un puntaje a cada fuente:

Iniciar con un base score, p. ej., la posición original del buscador invertida (primera = 100 puntos, etc.) o alguna métrica dePageRank/autoridad si disponible.

Sumar puntos por calidad técnica: ej. +20 si no fue marcado como homepage ni soft404; +10 si longitud de contenido > 500 palabras (suficiente contexto); -10 si excesivamente largo >5000 palabras (puede diluir respuesta, aunque esto es relativo al caso de uso).

Relevancia al query: utilizarBM25o TF-IDF: Por ejemplo, conrank-bm25, obtener score de cada**content**dado la query[[43]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=1). Normalizar esos scores y sumarlos al puntaje.

Si tenemos embeddings (opcional, con modelo abierto tipoSentenceTransformers), podríamos calcular similitud coseno entre embedding de la pregunta y del contenido para reordenar, pero esto añade peso (omitir en quick solution).

Fuente confiabilidad: Si se dispone de un ranking de dominio (ej. Wikipedia, .edu, etc.), se puede incorporar. O más simple, si el dominio coincide con uno en una allowlist de alta calidad, +X puntos.

Finalmente, restar gran cantidad si**soft404**o paywall (virtualmente excluir, a menos que no tengamos más).

Ordenarlas fuentes por puntaje descendente.

Selección final:Tomar top 3 (o N) fuentes finales. Estas serán las que se devuelvan como contexto. En un sistema RAG, se los pasaría al modelo; en un verificador factual, se los presentaría al usuario.

Observabilidad & Logs:Cada etapa arriba genera logs estructurados:

Búsqueda: log de consulta y URLs obtenidas.

Fetch: log de status por URL (200 OK, tiempos, tamaño contenido) con trazas (e.g. usar**otel**spans: un span “Fetch URL” con atributos de dominio, tiempo, éxito/fallo).

Validación: log de cuántos duplicados eliminados, cuáles descartados por soft404, etc., y puntajes finales.

Estos logs y métricas (contadores de URLs procesadas, latencia media por fase) se emiten a consola o a un colector. Esto permite monitorear rendimiento y costo (ej., contabilidad de cuántas veces usamos Playwright, importante por su costo alto).

Seguridad final:Sanitizar cualquier contenido antes de uso: p.ej., eliminar scripts en texto (aunque extractor ya suele hacerlo) y manejar encoding para evitar inyección si se embebe en HTML de respuestas.

Diagrama resumido Node stack:(Consulta)→**SearXNG API**→(URLs)→**for**cada URL: {**dssrf.validate()**→**got**fetch →**ArticleExtractor.parse()**or**pdfplumber**→**content**} →**simhash deduplicate**→**soft404 check**→**score (BM25 + heuristics)**→(Top N resultados)→ (enviar a LLM o responder).
Todas las comunicaciones instrumentadas con OpenTelemetry (trazas distribuidas) para debugging.

Stack Python-first

Descripción general:Esta arquitectura aprovecha la riqueza de librerías Python para web scraping y procesamiento de texto, siendo ideal si el núcleo de la solución reside en Python (por ejemplo, integrándose con frameworks ML o de datos). Python facilita implementar lógica sofisticada de validación con menos código (gracias a bibliotecas especializadas), aunque puede ser menos eficiente en multi-threading puro (se puede usar multiproceso o async IO con**httpx**).

Flujo End-to-End (Python):

Búsqueda (Python):

Utilizar laAPI de SearXNGmediante**requests**o**httpx**. SearXNG expone un endpoint**/search**que retorna JSON[[44]](https://pkoretic.medium.com/improved-web-search-with-local-llm-searxng-and-deno-2-0-d587302e8e17#:~:text=2,are%20neither%20tracked%20nor%20profiled). Enviar la query del usuario, parsear resultados en Python (lista de dicts con URL, título, snippet).

Alternativamente, levantar unwrapperpara Google/Bing (p. ej. usar API REST de Bing via**requests**con su key). Pero para mantener open source puro, preferible SearXNG (incluso se puede correr SearXNG local vía Docker y consultarlo en localhost).

Filtrar resultados iniciales similar al stack Node (dedupe URLs exactos, descartar dominios bloqueados).

Nota:Python puede también usar librerías tipoSerpAPI(no open) ogooglesearch-python(scrapea Google, pero riesgo bloqueos). SearXNG es la vía más completa y ética.

Recuperación & Extracción (Python):Iterar sobre las URLs:

HTTP Fetch:Utilizar**requests**con timeouts o mejor**httpx**(async support). Implementar retries (por ej. con biblioteca**tenacity**o manual loop). Antes de cada fetch, validar URL conssrf-protect:

**from ssrf_protect import SSRFProtect**
SSRFProtect.validate(url) # lanza excepción si IP privada

[[40]](https://github.com/kobotoolbox/ssrf-protect#:~:text=Trivial%20case). Esto garantiza que**requests.get()**no acceda a internos[[45]](https://github.com/kobotoolbox/ssrf-protect#:~:text=from%20ssrf_protect).

Parse según tipo:Inspeccionar**response.headers['Content-Type']**o URL:

Si HTML: continuar.

Si PDF: guardar bytes en un archivo temporal o BytesIO, luego usar**pdfplumber.open(file)**para extraer texto.

Si**len(text)==0**: intentar OCR con**pytesseract**sobre imágenes de pdfplumber (este puede renderizar cada página a imagen con Pillow).

Marcar en el resultado metadata:**is_pdf=True**,**pages=n**, etc.

Otros (JSON, etc.): no aplican normalmente, omitir.

Extracción HTML:Varios enfoques posibles:

Opción A (recomendada):Trafilatura– simple:

**import trafilatura**
result = trafilatura.extract(html, include_comments=False, output_format='json')

Esto retorna JSON con content, title, author, date, etc. Trafilatura internamente ya limpia boilerplate[[24]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=), usando su mezcla de técnicas. Ofrece excelente calidad, especialmente para artículos noticiosos o blog posts, y tolera HTML malformado.

Si Trafilatura devuelve**None**(fracaso inusual), fallback a otra lib.

Opción B:Newspaper3k/Goose3– para contenido de noticias/blog:

**from newspaper import Article**
article = Article(url)
article.download(); article.parse()
text = article.text; title = article.title; # etc.

Newspaper es fácil pero puede quedar congelado en algunos sitios (tiene timeouts internos). Goose3 similar (genera un objeto con .cleaned_text).

Opción C:Readability-lxml– port de Mozilla Readability a Python (ej.**readability.readability.Document(html).summary()**).Esto devuelve HTML simplificado del artículo; se puede extraer texto con BeautifulSoup. Precisión buena pero puede extraer de más o fallar ciertos encodings.

Elegir una de esas;Trafilaturase destaca por robustez (y ya incorpora Readability y jusText internamente[[46]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=,lxml)). Su contra es GPL, pero si nuestro proyecto es cerrado, podríamos optar por Newspaper (MIT) sabiendo que sacrificamos algo de recall[[47]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=newspaper3k%200).

JS-required fallback: Python no tiene nativo un DOM env. Podríamos integrarPlaywrightPython: lanzar un browser context, obtener**page.content()**. O usarrequests_html(que integra PyPPeteer) – pero esa librería está desactualizada. Lo más directo: si detectamos**`<script>`**heavy content, hacer:

**import asyncio**
from playwright.async_api import async_playwright
async with async_playwright() as p:
browser = await p.chromium.launch()
page = await browser.new_page()
await page.goto(url, timeout=5000)
html = await page.content()

# then feed html to Trafilatura or Newspaper

Este approach es costoso, así que condicionar: ej., usarlo solo si**len(text_extracted)<50 and has_signs_of_js**.

Almacenar resultados en lista**extractions[]**con campos:**url_final, text, title, author, date, is_pdf, source, content_length**.

Validación & Análisis (Python):

Deduplicación:Utilizarsimhash. Ejemplo with [seomoz]simhash-py:

**from simhash import Simhash**
for article in extractions:
article['simhash'] = Simhash(article['text']).value

# Compare pairwise Hamming distances

Implementar una comparación O(n^2) para n~5-10 (trivial), marcar duplicados (podemos elegir conservar el de texto más largo). O usar un set to drop exact duplicates of text easily.

Soft-404 detection:Podemos encapsular la lógica debenhoyt/soft404:

Para cada artículo con poco texto o indicios de error (palabras “404” en title):

Construir url_fake = url + str(uuid4()) o similar (o mejor: si url tiene path, reemplazar la última sección por garbage).

**try: resp2 = requests.get(url_fake, timeout=5)**(respetando SSRF protect, same host).

Si resp2.status_code >=400 → el host sí devuelve 404 duros, entonces el originalque devolvió 200 con poco contenidoes sospechoso; si resp2.status_code 200:

extraer texto2 (Trafilatura quizá, o incluso comparar raw HTML).

Calcular similitud, ej. Jaccard de shingles (use**textdistance**lib or simply sets of trigrams). Si similitud > 0.9, marcar original como soft404.

Alternativamente,heurística simple:if**len(text)<100 and any(keyword in text for keyword in ["404", "not found", "error"])**-> soft404. (Menos robusto).

Homepage/Index detection:Si el texto contiene muchos enlaces y poca narrativa:

Ejemplo: calc = number of occurrences of**<a**or “http” in text.

Or use Trafilatura output: it sometimes provides**comments**or can detect if page is listing (not sure if directly).

En todo caso, si confirmado, podríamos descartar o penalizar.

Paywall/Incomplete detection:Si un artículo tiene**`<html>`**length grande pero extracted text muy corto, y dominio es de paywall popular:

Señalarlo. Quizá intentarNewspaperen ese caso (a veces Newspaper extrae un poco más via full text rss if available).

O usar servicio externodiffbotomercury-api(pero eso viola no usar pago).

Probablemente lo más práctico: marcarlo como de baja calidad.

Scoring:Similar a Node:

Calcular relevancia vs query: usarrank_bm25:

**from rank_bm25 import BM25Okapi**
docs_tokens = [doc['text'].split() for doc in extractions]
bm25 = BM25Okapi(docs_tokens)
scores = bm25.get_scores(query.split())

Esto da un score por doc. Normalizar 0-1.

Calcular calidad: normalizar longitud (e.g. length 300-1000 palabras ideal => score alto, <100 o >5000 => más bajo).

Sumarle pequeña ponderación si**author**y**date**están presentes (fuente bien estructurada).

Aplicar penalizaciones: soft404 = score cero; paywall flagged = score muy bajo; duplicate = eliminar (score = 0 y excluir).

Domain trust: si tenemos lista (por ejemplo, preferir sitio oficial vs foro desconocido), añadir.

Combinar en un**final_score**.

Ordenar y seleccionar:Tomar top 3 con score > umbral. Si ninguno pasa umbral mínimo (ej. todos muy malos), se podría:

Re-pensar búsqueda (ej. relajar query o usar otro motor)en futura iteración, o en contexto LLM, al menos devolver lo menos malo con disclaimer.

Salida/Integración con LLM:En un pipeline RAG, formatear estos resultados a, por ejemplo: una cadena por fuente con cita. O crear embeddings de cada texto para usar en prompt.

Anti-alucinación final:Si se generará una respuesta, instruir al LLM a usarsoloestos textos y si ninguno aplica, decir “no encontrado”. Esto ya es parte del prompt design, fuera del scope de herramientas.

Observabilidad:

UtilizarOpenTelemetry Python: iniciar un tracer (**opentelemetry.sdk.trace**) y un meter para métricas. Encapsular cada fase en spans: one for Search, one for FetchEach, one for Extraction, etc. Esto permitirá ver tiempos en Jaeger u otro.

Logging con**structlog**o el logger estándar, formateado JSON. Por ejemplo, loggear a nivel INFO cada URL con campos: fetched_bytes, time_ms, soft404_flag, etc.

Contadores Prometheus: e.g.**urls_fetched_total**,**soft404_detected_total**,**phase2_duration_seconds**.

Seguridad/hardening:

Asegurarse de manejar bien excepciones: cualquier error en fetch o parse de una URL, capturar (no romper todo el pipeline). Si una URL falla, log error y continuar con las demás.

Rate limit: si nuestro sistema hará muchas búsquedas, implementar un pequeño delay global o token bucket para no bombardear un mismo dominio (respetar**robots.txt**crawl-delay si aplicable).

Sanitización: igual que Node, asegurar que el texto pase por escapado/strip de caracteres raros antes de incorporar a salida (para evitar, por ejemplo, que secuencias de control en el texto original pasen al terminal o interfieran).

Diagrama resumido Python stack:(Consulta)→ SearXNG (por requests/httpx) →(lista URLs)→ loop: {**SSRFProtect.validate(url)**→**requests.get**→**trafilatura.extract**(o Newspaper) /**pdfplumber**según tipo } →(lista contenidos limpios)→**simhash**dedup →**soft404_check()**→**rank_bm25**relevancia → heurística puntaje →(ordenar)→(Top N)→ respuesta/uso con trazabilidad. Telemetría OpenTelemetry instrumentada en cada función.

Comparativa Node vs Python:Ambas stacks cubren las mismas etapas.Node-firstbrilla en integrarse con entornos web JS y alta performance IO (ideal para microservicios serverless por ejemplo), mientrasPython-firstofrece librerías más maduras para análisis de texto y NLP. En Node, la mayor desventaja es la falta de un ecosistema tan completo para PDF u OCR (se solventó llamando Python externamente). En Python, se debe vigilar la concurrencia (usar async o threading para fetch paralelos, o limitarse a secuencial si el volumen es bajo). Según el equipo y componentes existentes, se puede tambiénhibridar: por ejemplo, usar Node para la orquestación y llamadas a un servicio Python para extraction heavy (unworkerPython que recibe URL y devuelve texto), combinando lo mejor de ambos.

“Blueprint” de Implementación Detallado

A continuación, un pseudoflujo paso a paso que entrelaza los componentes seleccionados, mostrando las decisiones lógicas (if/then) yfallbacksen cada fase:

Fase 1: Búsqueda y Pre-selección

Input:Recibir la consulta del usuario (ej. pregunta natural o keywords). Normalizar consulta (trim, manejar caracteres especiales).

Buscar fuentes:

Ejecutar búsqueda web:

**results = searxng.search(query, language="es", num_results=10)**– llamada HTTP GET al endpoint de SearXNG con parámetros adecuados (puede usarse también**categories=news**si se quiere priorizar noticias, etc.).

Si la API de búsqueda falla(timeout o 50x):

Intentar un motor alterno: por ejemplo, llamar a Bing API (si se dispone de clave) como fallback.

Si no hay alternativa, log error y retornar respuesta indicando no se pudo realizar búsqueda (early exit).

Recibir lista**results**con campos típicos: título, URL, snippet.

Filtrado inicial:

Eliminar resultados duplicados (misma URL canónica). Utilizar**urllib.parse**para normalizar URLs (lowercase dominio, strip**www.**y trailing slashes, quitar UTM query params comunes). Usar un set para filtrar duplicados.

Aplicarblocklist: Si existe lista de dominios no confiables o no permitidos (ej. sitios conocidos por spam, o internos no deseados), filtrar fuera.

Si la búsqueda no devolvió resultados válidos tras filtro:

Fallback:relajar criterios: tomar resultados adicionales (ej. top 20) o reformular query (quizá quitar términos muy restrictivos). Esto puede hacerse de forma limitada o pedir al usuario refinar.

Si aún nada, abortar con respuesta “No se encontraron fuentes”.

Seleccionar candidatos:Tomar hasta N resultados (ej. 5) para procesar en fase 2. Priorizar por orden original salvo casos de dominio repetido: si 3 resultados son del mismo dominio, quizás coger solo 1–2 para diversidad.

Justificación: reducir duplicados y ampliar cobertura.

(Al finalizar fase 1, tenemos una lista de URLs candidatas listas para ser recuperadas.)

Fase 2: Recuperación de Contenido (con reintentos y variaciones)

Para cada URL en la lista (fase 2 puede hacerse secuencialmente o en paralelo controlada):

2.1 Preparación y validación de URL:- Extraer dominio para logging.- Verificar que el esquema sea http/https. Si es otro (ftp:, file:, data:):- Rechazar inmediatamente por seguridad (no procesar esos).- EjecutarSSRF check:- En Node:**dssrf.validateUrl(url)**(ficticio) – esto internamente normaliza y resuelve DNS. En Python:**SSRFProtect.validate(url)**[[40]](https://github.com/kobotoolbox/ssrf-protect#:~:text=Trivial%20case).- Si lanza excepción o retorna falso:- Loggear advertencia (“URL bloqueada por SSRF policy”) con detalles (IP detectada). Saltar a siguiente URL (no fetch).- (Opcional:Robots.txtcompliance) – Si deseamos respetar robots, podríamos consultar un caché de robots por dominio y verificar si la ruta está permitida para "User-agent: \*". Dado que es un sistema de lectura, podríamos ignorarlo en muchos casos sin problemas éticos mayores, pero es un punto a decidir.

2.2 Fetch de la URL:- Configurar la petición:- Establecer cabeceras: User-Agent (simular un navegador común para evitar bloqueos), Accept-Language, quizás DNT.- Timeout global (ej. 5-10s).- Enviar GET:- Si recibe redirect (3xx):- seguir automáticamente hasta cierta cantidad (3-5 saltos). Los clientes HTTP config por defecto suelen seguir.- Actualizar la**final_url**.- Si status código >=400 (error):- Log error (“Failed to fetch, status X”). No reintentar en 400 (client error irreparable, ex: 404).- Si 500-599 (server errors/timeouts):- Reintentar hasta 1-2 veces con backoff exponencial (esperar 1s, luego 3s).- Si sigue fallando, marcar esta URL como no recuperable; continuar con siguiente.- Si no puede conectar (DNS error, etc.):- Similar: reintento breve, luego abandono si persiste.- Resultado esperado:**response**con código 200 y contenido bruto.

2.3 Determinar tipo de contenido:- Leer**Content-Type**header:- Si contiene “html” -> Tipo = HTML.- Si “pdf” or URL endswith**.pdf**-> Tipo = PDF.- Si “text/plain” u otro texto -> tratar como HTML plano (podría ser texto sin HTML, igual útil).- Si es imagen, video u otro binario inesperado:- No procesar (posiblemente resultado irrelevante).- Continuar con siguiente URL (o si imagen podría haber un OCR, pero fuera de scope, así que descartamos).-Edge case:Páginas que devuelven HTML de redirección meta o script (ej. cookie consent interstitial). Podría detectarse buscando**`<meta http-equiv="refresh">`**o certain scripts. Manejar en 2.5 if content seems problematic.

2.4 Extraer contenido según tipo:

HTML Branch:- Parsear el HTML:- En Node stack:Article Extractor.parse(html)– devuelve objeto con**content**(texto limpio) y**title**etc.[[48]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=%2F%2F%20Mozilla%20Readability%20const%20doc,parse)[[11]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Mozilla%20Readability).- En Python stack:Trafilatura–**trafilatura.extract(html, output_format="json")**– devuelve JSON con**text**y metadata.- Guardar texto extraído (podemos limpiarlo de espacios extra).- Validar extracción:- Si**content**length < 50 caracteres:- Posible caso de página vacía o extracción fallida.- Revisar el raw HTML: contiene**`<title>`**? contiene significativa cantidad de texto quizá en**`<p>`**? Si sí pero extractor devolvió poco, quizás el contenido está cargado via JS.-Fallback JS:- Node: usar Playwright (Chromium) para recargar la página; tras load completo, extraer**document.body.innerHTML**y volver a ejecutar extractor sobre ese.- Python: similar con Playwright or Selenium.- Si Playwright tampoco produce texto significativo (p.ej., página realmente vacía de contenido útil), entonces descartar esta fuente o marcar como fallo.- Si HTML raw contiene palabra clave tipo “paywall” o estructuras que indican contenido recortado (ej: “... subscribe to continue”):- Podemos marcar un flag**paywall=True**para esta URL.- Intentar fallback AMP: buscar en HTML**`<link rel="amphtml" href="...">`**. Si existe,fetchesa URL (rápidamente, es HTML ligero) y extraer texto de allí.- AMP a veces provee versión simplificada del artículo sin muro.- Si el extractor devuelve texto muy largo (>100k chars):- Podría ser porque no filtró comentarios o listó todo el menú (some extractors lo hacen). Se podría post-procesar: por ejemplo, Trafilatura ya quita boilerplate, pero Mercury a veces deja textos de sidebar.- Una técnica: calcular densidad de palabras por sección, eliminar secciones con densidad muy baja (indicador de navegación).- Esto se puede omitir si la librería elegida es confiable en limpieza.- Recuperar metadatos:- Título: usar el que da el extractor o en su defecto**`<title>`**del HTML.- Fecha y autor: si extractor provee (Trafilatura/Newspaper lo hacen), guardarlo; si no, se podría usar regex sobre el texto para patrones de fecha o bylines, pero eso puede ser complejo – podemos dejarlo.- URL canónica: buscar**`<link rel="canonical" href="...">`**en el HTML raw, para usarlo en dedup potencial (dos URLs diferentes con misma canónica → probablemente mismo contenido).- Construir objeto**article = { url, final_url, text, title, author?, date?, source=domain, paywall_flag, content_length=len(text) }**.

PDF Branch:- Usar pdf extractor:- Python:**pdfplumber.open(BytesIO(response.content))**y extraer todas las pages:**'\n'.join(page.extract_text() for page in pdf.pages)**.- Node: llamar a Python microservicio con PDF bytes (o usar**pdf.js**which yields text but less structured).- Obtener texto.- Si texto es None para alguna página (pdfplumber no pudo parsear):- Podría contener imágenes. Aplicar OCR: usar PyMuPDF or pdfplumber to render page images, luego pytesseract.- Esto es costoso; se puede limitar a primeras N páginas o al menos advertir al usuario que PDF es imagen no texto.- Combinar texto de todas páginas. Quizás recortar si excesivamente largo (> e.g. 10k chars) para no sobrecargar la fase LLM (o se hará recorte luego).- Crear objeto**article**similar, con flag**is_pdf=True**.

Ambas branches:

Almacenar el objeto en lista**articles**.

Registrar logs: “Fetched {url} status 200, {len} chars extracted, {paywall_flag}, used JS fallback or not, etc.” para trazabilidad.

2.5 Variaciones / Retries particulares:- Si la respuesta fue un HTML genérico (ex: ciertos sitios devuelven siempre una página “captcha” o “500 error” HTML):- Podríamos detectar palabras clave (“temporarily unavailable”, cloudflare challenge). En ese caso, unfallbackespecial es difícil (quizás usar proxies o simplemente descartar).- Si durante extracción de varios, notamos todos los artículos vacíos:- Quizá la búsqueda devolvió cosas no útiles → Podríamos decidir volver a Fase 1 con términos más amplios. Esto sería una lógica meta, quizás avisar al usuario.

(Al terminar fase 2, esperamos tener una lista de**articles**con contenido textual relativamente limpio para cada URL exitosa.)

Fase 3: Validación Profunda + Scoring

Deduplicación de contenido:

Recorrer pares de artículos en**articles**:

Calcular similitud. Uso rápido: normalizar texto (minúsculas, quitar espacios) y comparar si una cadena es substring de otra con longitud > X. O mejor, usar Simhash:

Compute simhash 64-bit para cada texto.

Si Hamming distance < 5 bits entre dos, considerarlos duplicados.

O usar MinHash: generar shingles (e.g. 5-word shingles) y Jaccard.

Para duplicados detectados:

Elegir uno “representante”. Criterios: si uno tiene canonical URL que indica ser original, o uno de dominio de mayor confianza, o simplemente el que apareció primero.

Marcar los otros como**dup=True**y quizás referenciar al que dejamos.

Eliminarlos de la lista de candidatos para scoring final.

Log: “Removed duplicate: URL2 dup of URL1”.

También, aunque no textual dup, podría haber duplicados denoticia en distintos medios(mismo suceso contado). Eso ya es más de contenido semántico, fuera de alcance a detectar automáticamente sin ML pesado. Podríamos ignorar eso por ahora (cada fuente se tratará por separado).

Validación de calidad técnica:

Soft-404 check(como descrito):

Por cada artículomuy corto(< ~100 palabras) O cuyo título sugiera error:

Realizar procedimiento de URL ficticia en mismo dominio.

Comparar texto de esa respuesta con la original.

Si similar → marcar**soft404=True**.

Si original era corto pero la ficticia devuelve 404 real, entonces original quizás es una página válida pero simplemente pequeña. En ese caso, si content < 50 palabras, prácticamente no servirá, podríamos descartarla igual por irrelevante.

Otra señal: si el snippet original del buscador era largo pero el contenido extraído es corto, sospechoso (tal vez extractor falló).

Indice/Homepage check:

Para cada artículo, si**content_length**es grande pero contiene muchos enlaces (podemos contar**text.count('http')**o**'href='**en el HTML original vs length):

Si ratio enlaces/palabras > un umbral, marcar**index_page=True**.

Si el título coincide con el nombre del sitio (ej. "BBC News - Home"):

Claramente homepage, marcar.

Estas páginas de índice no responden probablemente la pregunta del usuario de forma directa, por lo que se pueden penalizar.

Paywall check refinado:

Si previamente marcamos**paywall_flag**, aquí decidimos:

Si logramos contenido vía AMP u otro, entonces OK.

Si no, y el texto es solo introductorio (ej. primeras 2 líneas de un artículo), este artículo no es utilizable para respuesta.

Podemos intentar buscarresumenen su snippet (a veces el snippet de Google contiene más info que la página misma si es paywall).

Pero lo más seguro: descartarlo o asignar puntaje cero para que no se use.

Lenguaje y spam:

Comprobar idioma del texto (Trafilatura puede detectar idioma). Si está en idioma no deseado (ej. inglés cuando queremos español), penalizar o descartar, ya que difícil usarlo si el usuario espera info en español.

Si el texto es repetitivo o lleno de palabras clave irrelevantes (indicador de spam SEO):

Ejemplo métrico: la entropía del texto muy baja o la densidad de ciertas palabras muy alta. Este es un plus a considerar, aunque complejo de ajustar manualmente.

En proyectos avanzados, se podría tener un clasificador de calidad de fuente (ML) para esto. Aquí manual: si domain es sospechoso (no conocido y contiene muchos números o palabras extrañas), se puede penalizar.

Remover o marcar para exclusión aquellos con**soft404=True**o**paywall=True**sin remedio, y quizás**dup=True**.

Scoring & Ranking:

Para cada artículo restante:

Inicializar score = 0.

Relevancia semántica:calcular similitud con laquery:

Usar BM25: score_rel = bm25_score (si implementamos). Normalizar en rango 0–1.

O más simple, contar coincidencias de palabras clave importantes (removiendo stopwords). P.ej., número de términos de la consulta presentes en el texto. No muy sofisticado, pero sumaría evidencia.

Calidad del contenido:

score_len = escalar longitud: e.g. si 300–1000 palabras => puntaje máximo, si muy corto (<100) = 0, si >2000 = ligeramente menos (podría ser demasiado info).

Añadir puntos si encontró autor/fecha (indicador de página de noticia legítima).

Restar puntos si**index_page**(ej. -0.5) porque es menos probable responda directamente, aunque podría contener links útiles.

Fuente/domain trust:

Si tenemos una lista de dominios “preferidos” (ej. sitios oficiales, Wikipedia, medios reconocidos) asignar +0.x.

Inverso: si domain es de foro desconocido, tal vez -0.x.

Esto requiere curación manual, pero se puede codificar básico.

Penalizaciones duras:

if**soft404**or**dup**: score = -inf (o marcar para no seleccionar).

if**paywall**(no content): score = -inf.

Combinar: score_total = w1score_rel + w2score_len + w3\*trust + ... (ponderaciones definidas, por ejemplo, relevancia más importante).

Ordenar la lista de artículos por score_total descendente.

Salida de Fase 3:

Escoger losTop K(ej. 3) artículos con mayor score positivo.

Si ninguno tiene score > cierto umbral (por ejemplo, la relevancia fue bajísima para todos):

Podría significar que la búsqueda no encontró nada útil. En tal caso, como sistema podríamos:

O bien devolver los dos mejores aunque sean malos, pero con advertencia.

O hacer un ciclo adicional: reformular la pregunta (tal vez usar un modelo de consulta alterna) y volver a Fase 1. Esto es avanzado, podríamos simplemente notificar “Lo siento, no encontré fuentes confiables”.

Preparar los datos de salida (por ejemplo, en formato JSON: list of {title, url, content, score, ...}).

Estos datos luego serán usados para:

Contexto LLM:concatenar los contenidos para pase al modelo, con quizás el título como encabezado citando fuente.

O presentar al usuario:“Encontré X fuentes:” con los títulos y snippets, dando opción de leer más.

Anti-alucinación final:

Al usar estas fuentes en un LLM, implementar una regla: el LLM debe limitarse a la información contenida en los textos. Se puede inyectar un prompt del sistema: “No inventes información fuera de las fuentes proporcionadas. Si la respuesta no está en las fuentes, responde que no se encontró.”

Además, cualquier afirmación en la respuesta idealmente vendrá acompañada de la referencia de cuál fuente la respalda (esto es un diseño a nivel prompt/respuesta).

Este control escapa un poco al pipeline de datos en sí, pero es crucial mencionarlo: El pipeline de URL Context reduce la alucinación al forzar evidencias, pero la adherencia final depende de cómo formules la instrucción al modelo.

Pseudocódigo simplificado integrando todo (Python-style):

**results = search_api(query)**
candidates = filter_results(results)
articles = []
for url in candidates:
try:
SSRFProtect.validate(url)
resp = httpx.get(url, timeout=10)
except Exception as e:
log(f"Fetch fail {url}: {e}"); continue
if resp.status_code != 200:
continue
content_type = resp.headers.get('Content-Type','').lower()
if 'pdf' in content_type or url.endswith('.pdf'):
text = extract_pdf(resp.content)
elif 'html' in content_type or 'text' in content_type:
html = resp.text
text = extract_main_text(html)
if len(text) < 50:
text_js = fetch_with_playwright(url)
text = extract_main_text(text_js)
else:
continue
if not text or len(text)<50:
log(f"No content from {url}"); continue
article = {"url": url, "text": text, "title": get_title(text), ...}
articles.append(article)

# Phase 3:

for art in articles:
art['simhash'] = Simhash(art['text']).value

# mark duplicates

for i,a in enumerate(articles):
for j,b in enumerate(articles):
if i<j and hamming_dist(a.simhash, b.simhash) < 5: # drop the one with lower quality (e.g., shorter text)
to_drop = i if len(a.text) < len(b.text) else j
articles[to_drop]['dup'] = True

articles = [a for a in articles if not a.get('dup')]

for art in articles:
if is_soft404(art):
art['soft404'] = True
if is_index_page(art):
art['index'] = True # compute relevance and quality
art['rel_score'] = bm25_score(art['text'], query)
art['qual_score'] = quality_score(art)
art['trust_score'] = domain_trust_score(art['url'])
art['total_score'] = art['rel_score']*0.6 + art['qual_score']*0.3 + art['trust_score']\*0.1
if art.get('soft404') or art.get('paywall'):
art['total_score'] = -1 # exclude

articles = sorted([a for a in articles if a['total_score'] > 0], key=lambda x: x['total_score'], reverse=True)
top_answers = articles[:3]
return top_answers

(El código arriba es ilustrativo; maneja la lógica principal con simplificaciones.)

Este blueprint garantiza que en cada paso hay validaciones yfallbacks: búsqueda alternativa si falla la primaria, reintentos en fetch, método alterno (headless) si la extracción sale vacía, segundo chequeo de soft404 comparando contenidos, etc. Cada decisión prioriza mantenerfidelidadde la información (evitando alucinaciones mediante verificación cruzada) yeficiencia(no usar métodos pesados salvo que los ligeros fallen).

Plan de Adopción

Finalmente, se propone una ruta de adopción para incorporar estas soluciones de forma incremental, con horizonte de corto y mediano plazo, así como riesgos identificados y mitigaciones:

Quick Wins (1–2 semanas):Comenzar implementando un esqueleto funcional del pipeline:- Integrar labúsqueda básicausando un servicio existente (por rapidez inicial, quizá API de Bing Web Search con clave gratuita de prueba, o un SearXNG público). Obtener 5–10 resultados por consulta.- Implementar laextracción HTMLcon una librería de alta nivel disponible fácilmente: por ejemplo, usarNewspaper3k(instalación sencilla, MIT) para obtener texto de los primeros 3–5 resultados. También utilizar**requests**para fetch con timeouts.- Hardcodear algunas validaciones ligeras: descartar resultados duplicados por URL, ignorar si texto extraído contiene “404”.- Montar un prototipo que dado un query imprime los textos extraídos y sus fuentes.-Observabilidad inicial:Añadir logging simple de cada etapa (inicio/fin de fetch, longitudes, etc.). Medir aproximadamente latencia total por consulta.- Esto entregaría valor rápido: se podría ya alimentar esos textos a un LLM para ver mejoras en respuestas factuales.-Herramientas quick win:Newspaper3k (no la mejor calidad pero rápida de integrar), requests, simple dedupe check. Esto es todo MIT, ningún conflicto.

Mediano Plazo (1–2 meses):Iterar enfocándose en robustez y calidad:- Reemplazar/augmentar la extracción con herramientas másrobustas:- IntegrarArticle Extractoren Node stack si nos movemos a TS, oTrafilaturaen Python stack para mejorar recall de contenido[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201). Validar licencias: si Trafilatura (GPL) no encaja en nuestro licensing, considerar Goose3 (Apache) con posiblemente menor rendimiento.- Añadir soportePDF: incorporar pdfplumber para parsear enlaces PDF, y probarlo con PDFs de ejemplo. Si el dominio de nuestro problema incluye PDFs (ej. papers, informes), esto es prioritario.- Implementarfase de validacióncompleta:- Escribir la lógica desoft-404 detectioncon la técnica comparativa[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good). Probarla en escenarios conocidos (crear un pequeño set de URLs de test que incluyen 404 blandos).- Programar deduplicación con Simhash e integrar la librería correspondiente (testear con textos duplicados para ajustar umbral).- Introducir el cálculo descore: usar rank_bm25 (Py) o implementar TF-IDF manual en Node. Validar con casos donde la búsqueda devuelve algo no tan relevante – ver si re-rank corrige.- Mejorarobservabilidady control:- Integrar OpenTelemetry: por ejemplo, instrumentar un tracer que mida tiempo de búsqueda, tiempo promedio de fetch por URL, etc. Configurar un simple exporter (console or OTLP to a local collector).- Añadir contadores de eventos como “número de soft404 detectados” para cada consulta (de interés para saber cuántos resultados inútiles se filtran).- Establecer monitors sencillos: si una consulta tarda demasiado (> threshold), loggear warning con breakdown (qué URL tardó más).-Seguridad:- Incorporardssrfen Node (o ssrf-protect en Py) concretamente y probar peticiones a URLs locales (simular un usuario malicioso poniendo**http://127.0.0.1:port**– esperar a ver que es bloqueado).- Implementar unblocklistde dominios si aplica (por ejemplo, no permitir**\*.local**o ciertos TLD).- Configurar límites de concurrencia y quizá un rate limit global (ej. max 10 URLs por minuto a un mismo dominio) para no ser baneados. Esto puede hacerse con un simple token bucket en memory.-Pruebas y tuning:Durante este periodo, hacer pruebas con diversas consultas:- Medir latencia total. Si >, digamos, 5 segundos en promedio, optimizar: quizá reducir N resultados o paralelizar más.- Medir porcentaje de veces que se activó headless fallback – si es muy frecuente, considerar optimizar ese paso (o identificar patrones: quizás muchas páginas de cierto sitio requieren headless; se podría decidir bloquear ese dominio en búsquedas futuras por costo).- Evaluar calidad de respuestas LLM con y sin este pipeline, ajustar scoring si el LLM aún usa info irrelevante.- Documentar los flujos con diagramas para facilitar mantenimiento.

Riesgos y Mitigaciones:

Costo de Computo:El mayor riesgo es la latencia/costo del headless browser (Playwright) y OCR para PDFs.Mitigación:utilizarlos condicionalmente y lo menos posible. Por ejemplo, si 4 de 5 fuentes ya dieron buen contenido, quizás no vale gastar recursos en la 5ta que requeriría headless – se podría omitir. Asimismo, cachear resultados: si frecuentemente consultamos la misma URL o dominio, guardar su contenido en una caché local (con TTL corto) para evitar recarga. OpenTelemetry metrics ayudarán a identificar cuellos de botella (e.g., “X% de consultas invocaron headless”).

Errores de extracción que pasen inadvertidos:A veces extractores pueden tomar contenido equivocado (ej. agarran un menú en vez del artículo). Esto podría hacer que el LLM alucine usando texto irrelevante.Mitigación:mejorar validación de calidad – por ejemplo, si el texto extraído no contiene ninguna de las palabras clave de la consulta, tal vez es ruido. En fase 3, podríamos filtrar artículos cuya relevancia BM25 al query sea muy baja (indicando posiblemente contenido fuera de tema, quizá extracción fallida). Así no se los pasamos al LLM.

Mantenimiento de librerías:Dependencia de proyectos open source que podrían quedar sin soporte (especialmente los menos conocidos como dssrf o ssrf-protect).Mitigación:Seleccionar alternativas o estar listos para tomar el relevo en ajustes sencillos. Por ejemplo, si dssrf no madura, se puede implementar manualmente la lógica SSRF (basándose en OWASP guidelines[[49]](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#:~:text=Server%20Side%20Request%20Forgery%20Prevention,SSRF%29%20attack)). Igual con content extraction: tener 2 libs en fallback nos protege – si una falla en algún caso, la otra puede funcionar.

Compatibilidad Licencias:Uso de Trafilatura (GPL) en una solución comercial sería riesgoso.Mitigación:Si no podemos abrir todo el código, es mejor optar por MIT/Apache libs (Newspaper, Goose, Readability). Alternativamente, ejecutarla como un servicio separado (microservicio GPL que se comunica via API REST) para intentar aislar la copyleft (aunque hay que consultar legal, pero generalmente consumir outputs de un GPL service no obliga a GPL en el consumidor[[50]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=Trafilatura%20is%20distributed%20under%20the,compatible%20licenses%2C%20or%20contacting%20me)).

Seguridad:SSRF es una vector, pero también está la estabilidad ante input del usuario:

Si el usuario puede forzar ciertas búsquedas, podría intentar saturar el sistema (ej. consulta con miles de resultados). Mitigar limitando N resultados y quizás incorporando auth/cotas si es una API pública.

Inyección en logs: loggear URLs puede ser peligroso si no se escapan (podrían contener caracteres que manipulen el terminal). Mitigar asegurando logging en JSON o escapado.

Payloads maliciosos en HTML:El extractor ya quita scripts, pero podría haber algo como**`<svg onload=…>`**con ataques XSS persistentes si mostramos ese HTML en una interfaz. Mitigar limpiando cualquier HTML antes de almacenarlo (convertir todo a texto plano seguro).

Tasa de falsos positivos en filtros:Es posible descartar una página buena creyendo que es soft404 (ej. si la página real es muy minimalista).Mitigación:calibrar heurísticas con un conjunto de prueba. Se puede registrar en logs cuando se marca soft404 o index, y manualmente revisar algunas para ajustar thresholds.

Costo de APIs externas:Si eventualmente se integra un API de pago (ej. Bing, OpenAI for embeddings), controlar costos con caches y límites. En nuestro diseño actual, se ha favorecido open source para evitar costes directos. Si en futuro se quisiera embeddings con OpenAI, implementar cache de embeddings por URL para no recomputar.

En resumen, este plan inicia con algo funcional pero sencillo, y agrega complejidad de forma controlada enfocándose en las áreas de mayor beneficio (mejor extracción = mejor contexto = menos alucinación). Laspruebas integralesen cada iteración asegurarán que añadimos módulos open source sin romper el pipeline. Con laobservabilidadimplementada, el equipo podrá monitorear el impacto de cada mejora en tiempo y eficacia, y ajustar la estrategia de acuerdo a métricas reales. Con esta hoja de ruta, en un par de meses se lograría un sistema de URL Context altamente fiable, concomponentes open source modularesque refuerzan la integridad factual de las respuestas del sistema.

Fuentes utilizadas:Herramientas y repositorios se identificaron a través de documentación oficial y evaluaciones comparativas recientes, incluyendo el análisis de Fredric Cliver sobre extracción para LLM[[51]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=We%20evaluated%20four%20popular%20content,extraction%20libraries)[[42]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Our%20analysis%20revealed%20distinct%20strengths,and%20weaknesses), benchmarks de Trafilatura[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201), y repositorios GitHub de los proyectos mencionados. Se priorizaron soluciones con licencias permisivas y actividad reciente comprobable en 2024-2025. Cada recomendación fue verificada en sus respectivas fuentes para asegurar exactitud en sus capacidades y estado de mantenimiento. Los criterios de robustez, rendimiento, etc., fueron evaluados con base en esas referencias y la experiencia esperable dado el diseño de cada herramienta.[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled)[[2]](https://github.com/extractus/article-extractor#:~:text=To%20extract%20main%20article%20from,js)[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201)[[18]](https://github.com/fhamborg/news-please#:~:text=news,Newspaper%20%2C%20and%20%2093)[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2)[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good)[[7]](https://www.dynatrace.com/news/blog/what-is-opentelemetry/#:~:text=OpenTelemetry%20is%20an%20open,in%20the%20world%20of%20observability)[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden)[[9]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Server,vulnerabilities%20in%20modern%20web%20applications)

[[1]](https://github.com/searxng/searxng#:~:text=SearXNG%20is%20a%20free%20internet,are%20neither%20tracked%20nor%20profiled)[[14]](https://github.com/searxng/searxng#:~:text=License)[[17]](https://github.com/searxng/searxng#:~:text=,63)GitHub - searxng/searxng: SearXNG is a free internet metasearch engine which aggregates results from various search services and databases. Users are neither tracked nor profiled.

[https://github.com/searxng/searxng](https://github.com/searxng/searxng)

[[2]](https://github.com/extractus/article-extractor#:~:text=To%20extract%20main%20article%20from,js)[[20]](https://github.com/extractus/article-extractor#:~:text=License)[[21]](https://github.com/extractus/article-extractor#:~:text=Name%20Name)GitHub - extractus/article-extractor: To extract main article from given URL with Node.js

[https://github.com/extractus/article-extractor](https://github.com/extractus/article-extractor)

[[3]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=trafilatura%201)[[22]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=,scraping%20%2A%20Requires%3A%20Python%20%3E%3D3.6)[[23]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=)[[24]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=)[[25]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=)[[46]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=,lxml)[[47]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=newspaper3k%200)[[50]](https://pypi.org/project/trafilatura/1.3.0/#:~:text=Trafilatura%20is%20distributed%20under%20the,compatible%20licenses%2C%20or%20contacting%20me)trafilatura · PyPI

[https://pypi.org/project/trafilatura/1.3.0/](https://pypi.org/project/trafilatura/1.3.0/)

[[4]](https://pypi.org/project/httpx/0.7.5/#:~:text=is%20BSD%20licensed%20code,Changelog)httpx 0.7.5 - PyPI

[https://pypi.org/project/httpx/0.7.5/](https://pypi.org/project/httpx/0.7.5/)

[[5]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages)[[32]](https://algonotes.readthedocs.io/en/latest/Simhash.html#:~:text=Simhash%20%E2%80%94%20algorithms%20documentation%20,to%20find%20near%20duplicate%20webpages)Simhash — algorithms documentation - Read the Docs

[https://algonotes.readthedocs.io/en/latest/Simhash.html](https://algonotes.readthedocs.io/en/latest/Simhash.html)

[[6]](https://github.com/benhoyt/soft404#:~:text=Basically%2C%20you%20fetch%20the%20URL,know%20it%20must%20be%20good)[[35]](https://github.com/benhoyt/soft404#:~:text=properly%20detect%20dead%20pages,trivial%20to%20detect)[[36]](https://github.com/benhoyt/soft404#:~:text=But%20if%20the%20known%20dead,must%20be%20a%20good%20page)GitHub - benhoyt/soft404: Soft 404 (dead page) detector in Python

[https://github.com/benhoyt/soft404](https://github.com/benhoyt/soft404)

[[7]](https://www.dynatrace.com/news/blog/what-is-opentelemetry/#:~:text=OpenTelemetry%20is%20an%20open,in%20the%20world%20of%20observability)What is OpenTelemetry?

[https://www.dynatrace.com/news/blog/what-is-opentelemetry/](https://www.dynatrace.com/news/blog/what-is-opentelemetry/)

[[8]](https://github.com/kobotoolbox/ssrf-protect#:~:text=The%20purpose%20of%20this%20library,default%2C%20these%20types%20are%20forbidden)[[40]](https://github.com/kobotoolbox/ssrf-protect#:~:text=Trivial%20case)[[45]](https://github.com/kobotoolbox/ssrf-protect#:~:text=from%20ssrf_protect)GitHub - kobotoolbox/ssrf-protect: Basic library to validate URLs again SSRF attacks

[https://github.com/kobotoolbox/ssrf-protect](https://github.com/kobotoolbox/ssrf-protect)

[[9]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Server,vulnerabilities%20in%20modern%20web%20applications)[[38]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=Instead%20of%20blacklists%2C%20dssrf%20uses,a%20multi%E2%80%91step%2C%20safe%E2%80%91by%E2%80%91construction%20approach)[[39]](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8#:~:text=,Redirect%20chain%20validation)Introducing dssrf: A Safe‑by‑Construction SSRF Defense Library for Node.js - DEV Community

[https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8](https://dev.to/relunsec/introducing-dssrf-a-safe-by-construction-ssrf-defense-library-for-nodejs-1ec8)

[[10]](https://github.com/extractus#:~:text=extractus%2Farticle,There%20was%20an%20error)Extractus - GitHub

[https://github.com/extractus](https://github.com/extractus)

[[11]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Mozilla%20Readability)[[42]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=Our%20analysis%20revealed%20distinct%20strengths,and%20weaknesses)[[48]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=%2F%2F%20Mozilla%20Readability%20const%20doc,parse)[[51]](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1#:~:text=We%20evaluated%20four%20popular%20content,extraction%20libraries)Web Content Extraction for LLM Context Augmentation: A Comparative Analysis | by Fredric Cliver | Medium

[https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1](https://fredriccliver.medium.com/web-content-extraction-for-llm-context-augmentation-a-comparative-analysis-52361bb258c1)

[[12]](https://github.com/goose3/goose3#:~:text=License)GitHub - goose3/goose3: A Python 3 compatible version of goose http://goose3.readthedocs.io/en/latest/index.html

[https://github.com/goose3/goose3](https://github.com/goose3/goose3)

[[13]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=2)[[43]](https://www.graft.com/blog/pdf-parsers-guide#:~:text=1)Graft - Exploring PDF Parsers: A Comprehensive Guide

[https://www.graft.com/blog/pdf-parsers-guide](https://www.graft.com/blog/pdf-parsers-guide)

[[15]](https://www.reddit.com/r/Searx/comments/1nm3n1q/search_results_not_as_good_as_individual_search/#:~:text=r%2FSearx%20www,more%20than%2070%20search%20services)Search results not as good as individual search engines : r/Searx

[https://www.reddit.com/r/Searx/comments/1nm3n1q/search_results_not_as_good_as_individual_search/](https://www.reddit.com/r/Searx/comments/1nm3n1q/search_results_not_as_good_as_individual_search/)

[[16]](https://directory.fsf.org/wiki/Searxng#:~:text=most%20recent%20revision,searxng)Searxng - Free Software Directory

[https://directory.fsf.org/wiki/Searxng](https://directory.fsf.org/wiki/Searxng)

[[18]](https://github.com/fhamborg/news-please#:~:text=news,Newspaper%20%2C%20and%20%2093)[[28]](https://github.com/fhamborg/news-please#:~:text=json%20file%20as%20extracted%20by,please%20can%20be%20found%20here)GitHub - fhamborg/news-please: news-please - an integrated web crawler and information extractor for news that just works

[https://github.com/fhamborg/news-please](https://github.com/fhamborg/news-please)

[[19]](https://github.com/scrapy/scrapy#:~:text=Scrapy%2C%20a%20fast%20high,2k%20forks%20Branches%20Tags)Scrapy, a fast high-level web crawling & scraping ... - GitHub

[https://github.com/scrapy/scrapy](https://github.com/scrapy/scrapy)

[[26]](https://pypi.org/project/news-please/#:~:text=news)[[27]](https://pypi.org/project/news-please/#:~:text=,information%20%2C%20%20retrieval)[[29]](https://pypi.org/project/news-please/#:~:text=1)news-please · PyPI

[https://pypi.org/project/news-please/](https://pypi.org/project/news-please/)

[[30]](https://pypi.org/project/pdfplumber/#:~:text=pdfplumber%20,splitting%2C%20merging%2C%20cropping%2C%20and)pdfplumber - PyPI

[https://pypi.org/project/pdfplumber/](https://pypi.org/project/pdfplumber/)

[[31]](https://deps.dev/pypi/pdfplumber/0.11.0/dependencies?filter=license%3A%22non-standard%22#:~:text=Dependencies%20,analyzer%2C%20Advisories%20in%20this)Dependencies | pdfplumber | PyPI - Open Source Insights

[https://deps.dev/pypi/pdfplumber/0.11.0/dependencies?filter=license%3A%22non-standard%22](https://deps.dev/pypi/pdfplumber/0.11.0/dependencies?filter=license%3A%22non-standard%22)

[[33]](https://github.com/seomoz/simhash-py#:~:text=seomoz%2Fsimhash,simhash%20using%20a%20C%2B%2B%20extension)seomoz/simhash-py: Simhash and near-duplicate detection - GitHub

[https://github.com/seomoz/simhash-py](https://github.com/seomoz/simhash-py)

[[34]](https://pypi.org/project/simhash/#:~:text=Released%3A%20Mar%202%2C%202022%20A,not%20provided%20a%20project%20description)simhash · PyPI

[https://pypi.org/project/simhash/](https://pypi.org/project/simhash/)

[[37]](https://github.com/HackingRepo/dssrf-js#:~:text=License)[[41]](https://github.com/HackingRepo/dssrf-js#:~:text=MIT%20license)GitHub - HackingRepo/dssrf-js: A library offer huge of utility and advanced SSRF defense checks making your website ssrf resistant if you use properly.

[https://github.com/HackingRepo/dssrf-js](https://github.com/HackingRepo/dssrf-js)

[[44]](https://pkoretic.medium.com/improved-web-search-with-local-llm-searxng-and-deno-2-0-d587302e8e17#:~:text=2,are%20neither%20tracked%20nor%20profiled)Improved Web Search with Local LLM, SearxNG and Deno 2.0

[https://pkoretic.medium.com/improved-web-search-with-local-llm-searxng-and-deno-2-0-d587302e8e17](https://pkoretic.medium.com/improved-web-search-with-local-llm-searxng-and-deno-2-0-d587302e8e17)

[[49]](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#:~:text=Server%20Side%20Request%20Forgery%20Prevention,SSRF%29%20attack)Server Side Request Forgery Prevention - OWASP Cheat Sheet Series

[https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

-
- [

  ]()
