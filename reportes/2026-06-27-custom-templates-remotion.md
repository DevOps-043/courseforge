# Reporte de avance - Custom Templates Remotion

Fecha: 27 de junio de 2026  
Ultimo push revisado: `fadddc8d - feat: implement production pipeline for custom Remotion templates with sandbox runner and library management support`

## Resumen ejecutivo

Se avanzo de forma importante en la capacidad de usar plantillas personalizadas de Remotion dentro del flujo de postproduccion. El sistema ya permite cargar bundles ZIP, validarlos, aprobarlos para sandbox, generar una vista previa externa y usarlos como candidato para el ensamblado final.

El avance principal es que el flujo ya no se queda solo en "plantillas de referencia": ahora existe una ruta real para probar plantillas externas y conectarlas con los videos del curso. Sin embargo, todavia estamos en una etapa de estabilizacion operativa. Actualmente el sistema depende de una computadora local encendida, del backend corriendo y de ngrok para exponer ciertas rutas. Esto significa que el flujo funciona en ambiente controlado, pero aun no es una solucion completamente autonoma o productiva en la nube.

## Lo que ya se logro

### 1. Plantillas personalizadas con ZIP

Ya existe soporte para subir y registrar plantillas Remotion empaquetadas como ZIP. Estas plantillas incluyen un manifest que describe informacion clave, como el nombre de la composicion, duracion base, resolucion y FPS.

En terminos simples: el sistema ya puede recibir una plantilla externa y entender sus datos principales para usarla dentro del flujo de produccion.

### 2. Validacion y aprobacion para sandbox

Se agrego un estado especial para marcar una version como aprobada para ejecucion en sandbox. Esto es importante porque no cualquier ZIP subido deberia ejecutarse automaticamente.

El flujo actual diferencia entre:

- Plantilla subida.
- Plantilla validada.
- Plantilla aprobada para sandbox.
- Plantilla lista para usarse como opcion de ensamblado.

Esto reduce riesgo y mantiene una separacion sana entre "archivo cargado" y "archivo autorizado para ejecutarse".

### 3. Base de datos preparada para versiones y builds

Se extendio la base de datos para guardar mas informacion de las plantillas y sus builds. Tambien se agrego una tabla para registrar builds compilados.

En lenguaje no tecnico: el sistema ya tiene donde guardar el historial de versiones y los resultados de preparacion de cada plantilla, en lugar de depender solo de archivos sueltos.

### 4. Sandbox runner para render externo

Se implemento un runner separado para ejecutar plantillas externas en un entorno controlado. Esto permite que una plantilla personalizada pueda generar un video sin mezclarse directamente con el render interno tradicional.

Este punto es clave para seguridad y mantenimiento: las plantillas externas no se tratan igual que el codigo base de la aplicacion.

### 5. Preview externo del bundle

Se agrego una vista previa para plantillas externas. El sistema puede generar un MP4 corto y un poster PNG para revisar visualmente la plantilla antes del ensamblado final.

Estado actual del preview:

- El MP4 ya se genera y puede verse por fuera usando el link directo.
- El poster tambien se genera correctamente.
- En la pagina principal ya se muestran controles y links para abrir el MP4 o poster.
- Aun puede haber casos donde la reproduccion embebida en la pagina no sea tan confiable como abrir el archivo directo.

Esto significa que la vista previa ya existe, pero todavia debe considerarse una herramienta de revision preliminar, no una garantia total del render final.

### 6. Preview recortado por segundos

Se cambio el preview para que su duracion se configure por segundos, no por frames. Esto evita confusion como la que ocurrio con previews de 4 segundos.

Actualmente el preview esta pensado para ser corto, porque se genera de forma sincrona. Si se hace demasiado largo, la pagina puede tardar mucho o llegar a timeout.

Recomendacion actual:

- Mantener previews cortos, por ejemplo 6 a 10 segundos.
- Para previews largos, moverlo despues a un proceso asincrono tipo job.

### 7. Mejoras visuales en postproduccion

Se reorganizo la pantalla de postproduccion para que la previsualizacion tenga mas espacio y las plantillas queden en una barra lateral con busqueda.

En la practica esto hace que el flujo sea mas usable: primero se ve el video/preview, y a la derecha se elige la plantilla.

### 8. Biblioteca administrativa

Tambien se avanzo en la biblioteca administrativa, con una estructura mas ordenada por empresa, taller, leccion y materiales. Esto no es parte directa del sandbox de Remotion, pero si mejora la gestion del contenido que alimenta el pipeline.

## Funcionamiento actual con ngrok

Hoy el sistema funciona usando ngrok como puente temporal.

Esto quiere decir:

- Debe haber una PC encendida.
- El backend debe estar corriendo localmente.
- ngrok debe estar activo.
- La URL publica de ngrok debe apuntar correctamente al backend.
- Si se apaga la PC, se cierra ngrok o cambia la URL, el flujo externo puede dejar de funcionar.

ngrok no debe verse como la solucion final de produccion. Es una herramienta temporal para poder exponer el ambiente local mientras se estabiliza el flujo.

Para una version mas robusta, el sistema deberia depender de infraestructura persistente: storage accesible, worker en servidor/nube y URLs estables.

## Limitaciones y riesgos actuales

### 1. El ensamblado puede fallar por timeout

Se detecto un caso real donde el sandbox runner llego al limite de 10 minutos y fallo:

```text
Sandbox render timed out.
durationMs: 600181
```

Esto no necesariamente significa mala conexion del usuario. En ese caso especifico, el proceso de render estuvo corriendo durante 10 minutos y fue detenido por limite de tiempo.

Posibles causas:

- Render pesado para la maquina local.
- Muchos assets en la leccion.
- Videos/avatar/slides tardando en procesarse.
- Codificacion del MP4 lenta.
- Assets remotos que tardan en cargar.
- Plantilla externa mas costosa que las internas.

Se agregaron logs de progreso para saber si el render avanza lento o si se queda atorado.

### 2. Dependencia de maquina local

Mientras el render dependa de una PC local, la estabilidad depende de esa maquina:

- CPU disponible.
- Memoria disponible.
- Disco.
- Antivirus o procesos en segundo plano.
- Conexion.
- Estado de ngrok.

Esto es aceptable para pruebas, pero no para operacion estable de produccion.

### 3. Preview visible por link directo, pero no siempre perfecto dentro de la pagina

El preview ya puede abrirse como MP4 directo. Esto confirma que el archivo existe y se puede reproducir.

Sin embargo, la reproduccion dentro de la pagina puede depender del navegador, del formato final, del cache o del tiempo de generacion. Por eso se agregaron links directos al MP4 y al poster.

### 4. Preview corto por diseno

El preview no representa necesariamente toda la duracion del video. Es una muestra corta para validar visualmente la plantilla.

Esto debe comunicarse claramente para evitar confundir "preview de 6 segundos" con "video final de 6 segundos".

### 5. El flujo aun requiere supervision tecnica

Aunque el sistema ya esta funcionando en varias partes, todavia requiere supervision para:

- Confirmar que ngrok este activo.
- Revisar logs cuando un render falla.
- Validar que la plantilla este aprobada para sandbox.
- Confirmar que los assets sean accesibles.
- Ajustar timeouts si el render es pesado.

## Estado general

Estado: amarillo.

El avance funcional es alto: ya existe un pipeline real para plantillas externas y ya se puede probar con bundles. Sin embargo, la operacion todavia no es completamente estable porque depende de maquina local, ngrok y renders que pueden tardar mas de lo esperado.

No estamos bloqueados, pero si en una etapa donde conviene estabilizar antes de considerarlo listo para uso continuo.

## Recomendaciones siguientes

### Corto plazo

1. Mantener previews cortos.
2. Usar el link directo del MP4 como verificacion principal cuando el player embebido falle.
3. Revisar los nuevos logs de progreso del sandbox cuando un ensamblado tarde demasiado.
4. Documentar el comando exacto para levantar ngrok y el backend.
5. Probar el mismo bundle con una leccion pequena y luego con una leccion pesada para comparar tiempos.

### Mediano plazo

1. Mover previews largos a jobs asincronos.
2. Recuperar jobs al recargar la pagina, sin depender de que el navegador permanezca abierto.
3. Mostrar mensajes mas claros al usuario cuando un render sigue en proceso o cuando se perdio comunicacion.
4. Guardar evidencia de cada render: duracion, plantilla usada, version, assets y error si falla.

### Largo plazo

1. Sustituir ngrok por infraestructura estable.
2. Ejecutar render workers en un entorno dedicado.
3. Almacenar bundles y outputs en storage persistente.
4. Separar definitivamente entorno de prueba local y entorno productivo.

## Daily Pulse

```text
SofLIA Engine - Daily Pulse | 27/06/2026
Estado: Amarillo (avance fuerte en custom templates, pero aun con riesgos operativos por ngrok, maquina local y timeouts de render)
Done hoy: pipeline de plantillas Remotion externas, sandbox runner, preview externo, builds versionados, mejoras de UI de postproduccion y biblioteca administrativa
Ready for QA: carga de bundles, aprobacion para sandbox, preview por MP4/poster, seleccion de plantilla y ensamblado externo
Riesgo principal: el ensamblado externo puede llegar a timeout en renders pesados; actualmente depende de PC local + backend + ngrok
Foco siguiente: estabilizar renders largos, mejorar recuperacion de jobs y documentar operacion local/ngrok
Accion requerida: validar con bundles pequenos y pesados; revisar logs nuevos de progreso cuando falle un ensamblado
```

## Conclusion

El sistema ya dio el salto principal: las plantillas externas de Remotion ya pueden formar parte del flujo real de postproduccion. Lo que falta ahora no es tanto construir la capacidad base, sino hacerla mas estable, observable y menos dependiente del ambiente local.

La prioridad recomendada es estabilizar la operacion: menos dependencia de ngrok, mejor manejo de timeouts, jobs recuperables y mensajes claros para el usuario.
