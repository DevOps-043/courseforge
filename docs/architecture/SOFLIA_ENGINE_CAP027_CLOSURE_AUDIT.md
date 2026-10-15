# CAP-027 — auditoría de brechas de cierre

Fecha: 2026-10-12. Alcance: código y contratos actuales, sin ejecución física ni QA formal.
Esta auditoría no modifica flags, seguridad del equipo, vendor, infraestructura o migraciones.

Actualización posterior 2026-10-13: inventario exacto runtime conectado al binding del assembly
y receta de doble build implementados. 6/6 pruebas de admisión y 5/5 adaptador pasan; ambos TS
compilan; AST/XML de build pasan. No existe build binario ejecutado ni loader que acredite
clausura dinámica/ACL. [Detalle](SOFLIA_ENGINE_CAP027_NETWORK_CONTROLLER.md).
CAP-027 91.30% parcial; promedio siete 98.76%. No convertir checks fuente en evidencia física.

Actualización 2026-10-13: existen entrada CLR precompilable y adaptador Node para edge.
[Implementación y límites](SOFLIA_ENGINE_CAP027_NETWORK_CONTROLLER.md): falta loader/admisión
de clausura completa, artefacto CLR/ABI y conexión física. No equivale a runtime operativo.
CAP-027 91.30% parcial; promedio siete 98.76%, sin incremento por entrada aún no integrada.

## Estado actualizado — evidencia de fuentes al publicar (2026-10-12)

El controlador WFP, su protocolo y el canal autenticado cuentan ahora con código fuente;
las afirmaciones de ausencia en el diagnóstico original inferior son históricas. Siguen sin
acreditarse un binding CLR operativo, política efectiva, provisión ni ejecución nativa integral.
No confundir implementación fuente con aislamiento instalado y verificado.

Se reprodujo una brecha de evidencia: un evento CSS de fuente inválida posterior al último
checkpoint no impedía `finish`. El observador conserva el fallo y ahora expone `assertValid`;
la sesión original lo consulta antes y después de los awaits finales. Preview lo consulta
tras verificar el ejecutable y después de persistir sus metadatos, antes de entregar el paquete.
Un evento válido posterior no limpia el fallo. El rechazo conserva la limpieza de listeners
y de archivos propios del intento. No se inventa procedencia de glifos ni attestation nativa.

Validación dirigida: reproducción roja previa (22/23 en captura controlada), seguida de
23/23 captura controlada, 7/7 observador de fuentes y 26/26 captura visual con la corrección.
Ambos proyectos TypeScript (hyperframes-test y composition-worker) compilan. CDP/navegador,
glifos y fuentes son fixtures; archivos, hashing y servidor HTTP local sí se ejercitan.
No se ejecutaron navegador real, SDK productivo, render, WFP, migraciones ni QA formal.

CAP-027 permanece en **91.30% estimado, parcial**; promedio simple de siete **98.76%**.
CAP-004/009/010/017/023/026: 100% de implementación registrada, QA pendiente, sin reauditoría.
Esta corrección no cierra el corpus ni demuestra fuentes reales; no obtiene crédito adicional.

Actualización posterior: el usuario autorizó desarrollar sin instalar ni activar. Se implementó
el [núcleo del controlador separado](SOFLIA_ENGINE_CAP027_NETWORK_CONTROLLER.md); ya no falta esa
autorización de desarrollo. Falta adaptador nativo/canal y conexión efectiva, no solo QA. Las
referencias a autorización pendiente abajo describen el estado anterior a esa respuesta.

## Diagnóstico original — histórico, anterior al desarrollo del controlador

La conversión SDR NO está ausente: `original-session-sdr-stages.mjs` conecta el encode de
frames originales con `encodeSdrCapturedFrames`, aplica el par fijo de filtros y verifica
el ensamblado final conservando el mux del SDK. La política declara un perfil sRGB de captura;
su implementación no demuestra por sí sola ese perfil efectivo ni la paridad del corpus real.
No desarrollar otro encoder ni sustituir el pipeline por una captura alternativa.

Sí falta una frontera OS de red compatible con el servidor loopback original. El helper
`OwnedRenderAppContainer.cs` solicita cero capacidades y verifica el token suspendido; no
instala filtros de conexiones por puerto. `original-session-network-guard.mjs` intercepta
HTTP de la página original por CDP: su propio scope excluye aislamiento OS. No cubre por sí
solo otros targets/procesos, DNS, UDP, WebRTC, brokers locales ni política loopback efectiva.

No se ha encontrado una implementación WFP/firewall que vincule permiso de red al puerto del
servidor original. La búsqueda de APIs/comandos de control de red y la lectura de los helpers
no acreditan un control inexistente. Tampoco se ha probado que AppContainer acepte el pipeline
completo sin excepciones. Por tanto esta brecha no se puede clasificar como «solo QA pendiente».

## Separación de trabajo restante

| Bloque | Evidencia actual | Lo que falta para cerrar |
| --- | --- | --- |
| Identidad/ejecutor | Inventario pinneado, sesión original, jobs/token/ACL/cuotas y fences en código | Frontera OS de red compatible, provisión mínima y ejecución efectiva |
| Corpus | Recetas deterministas nativas/medios/decks/video y compiladores | Materializar y medir cobertura completa con productor original; no contar recetas como renders |
| Checkpoints | Contratos, particiones/eventos, forward/reverse y comparación | Evidencia integral de bordes/efectos sobre las recetas reales |
| Imagen/texto | SSIM, píxeles, máscaras y obligaciones por contrato | Paridad real con blur, oclusiones, motion/transiciones y texto/decks |
| Tiempo | Deriva por checkpoint y gates de eventos | Repetibilidad y timing efectivos del pipeline completo |
| Audio | Captura/mezcla/RMS/loudness/sync y gates de audio o silencio | Calibración, límites y A/V sobre salidas reales; no extrapolar PCM sintético |
| Fuentes/codecs/SDR | Bindings de fuentes, captura de uso, transformación SDR y verificación mux | Perfil efectivo, fuentes/decoder reales y carta/corpus renderizados |
| Diagnósticos | Etapas seguras, checkpoint y bloqueo por spool retenido | Reconciliación operativa y retención administrada; no borrar por TTL |
| Gate durable | Autoridad, recibos, reserva/outbox y worker en código | PostgreSQL: migraciones, permisos, atomicidad, carreras, ACK perdido y operación entre hosts |

Las mediciones físicas son verificaciones de integración/aceptación técnica; el QA formal del
tester permanece separado. Sin ambas no hay cierre integral. Las migraciones siguen preparadas,
no aplicadas. Esta auditoría no atribuye porcentajes nuevos a evidencia ausente.

## Decisión de arquitectura pendiente de autorización

Recomendación: evaluar y desarrollar un componente de control de red separado del worker
restringido. WFP es un candidato, NO una solución ya implementada o demostrada. El componente
necesita permisos explícitos sobre BFE; el worker y el HTML no deben recibirlos. No instalar
servicios, conceder capacidades, crear excepciones o cambiar filtros sin autorización adicional.

El contrato de ese componente debe resolver antes de implementación nativa:

- Identidad de host/tenant/ejecución/paquete, autenticación del canal y rechazo de órdenes del HTML.
- Denegación efectiva desde antes del arranque, IPv4/IPv6, protocolos y descendientes.
- Descubrimiento autorizado del puerto dinámico del SDK sin confiar en el documento y sin abrir
  todos los puertos locales; mantener sus etapas originales.
- Concurrencia por ejecución y no reutilizar una identidad de paquete con permisos cruzados.
- Pérdida del controlador/ACK, aborto y reinicio: no puede abrir la red mientras sobreviva el job.
- Verificación de política efectiva y cierre; no inferir enforcement desde un JSON o test simulado.

Microsoft documenta [el control de acceso de BFE](https://learn.microsoft.com/en-us/windows/win32/fwp/access-control)
y [las capas ALE](https://learn.microsoft.com/en-us/windows/win32/fwp/application-layer-enforcement--ale-).
La elección del controlador separado es una inferencia arquitectónica para preservar mínimo
privilegio, no una garantía de viabilidad de todas las restricciones anteriores.
Además, los objetos de [sesiones dinámicas WFP](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management)
se eliminan al terminar la sesión: usarlos como única denegación puede dejar una ventana sin
protección. El diseño debe resolver ese fallo antes de declararse fail-closed.

## Métricas y alcance

Métrica histórica del diagnóstico original: CAP-027 91.15%; promedio siete 98.74%.
La actualización superior sustituye estos valores; no deben usarse como avance vigente.
CAP-004/009/010/017/023/026: 100% de implementación registrada cada una, QA pendiente, sin reauditoría.
La rúbrica es estimación ponderada, no porcentaje de pruebas físicas aprobadas ni de tareas contadas.
Se preservan los cambios de otros CAP y el objetivo sigue activo. Esta revisión cambia la siguiente
acción: priorizar la frontera OS y su autoridad, no añadir otro encoder o más pruebas sintéticas
como sustituto del requisito integral.
