# Agrupación de elementos en el timeline

## Estado del trabajo

Este documento fija el contrato para implementar la agrupación editable del timeline sin alterar el formato que actualmente aceptan Courseforge y HyperFrames Cloud.

- Fase 0 — contrato y compatibilidad: completada.
- Fase 1 — vínculo existente avatar + voz: completada y validada.
- Fase 2 — modelo de grupos: completada y validada.
- Fase 3 — operaciones de dominio: completada y validada.
- Fase 4 — selección y manipulación exterior: completada y validada.
- Fase 5 — navegación y edición interna: completada y validada.
- Fase 6 — persistencia, historial y snapshots: completada y validada.
- Fase 7 — contrato local/cloud: completado; smoke render real pendiente de aprobación explícita.

## Contratos no negociables

### Documento editable

- El documento editable conserva `format: "courseforge-composition-v2"`.
- Las fases 0 y 1 no incorporan una colección de grupos ni modifican el esquema persistido.
- La agrupación futura se añadirá como información opcional y compatible dentro de `courseforge-composition-v2`; no se creará una versión nueva sin demostrar primero que existe una incompatibilidad real.
- Documentos existentes sin información de grupos deben continuar cargando, editando y guardando sin migración obligatoria.

### Snapshot de render

- El snapshot aprobado conserva `format: "hyperframes-html-v1"`.
- Los grupos son una abstracción del editor. El compilador debe resolverlos a clips, pistas, variables y medios antes de generar el snapshot.
- Ningún identificador, jerarquía o estado de navegación de grupo debe ser requerido por el runtime de HyperFrames Cloud.
- Una composición agrupada y la misma composición desagrupada, sin cambios temporales o visuales, deben producir un resultado de render equivalente.

### Reglas de HyperFrames Cloud

- El perfil durable permanece en 25 FPS y se conserva inmutable después de aprobar el snapshot.
- El video se entrega silenciado y su audio se representa mediante una capa de audio separada.
- Cada fuente de video debe conservar el metadato `hasAudio` correcto.
- Las pistas expresan organización temporal; el orden visual se determina mediante `zIndex`.
- Las variables se entregan de forma remota según el contrato vigente y no se deben persistir credenciales ni URLs firmadas dentro del documento.
- El archivo enviado a cloud debe respetar el límite vigente de 200 MiB y los formatos de medios aceptados.
- Las restricciones de salida, incluyendo las combinaciones incompatibles de resolución, contenedor y transparencia, siguen siendo responsabilidad del perfil de render y no del agrupamiento.

## Relación de sistema avatar + voz

La unión existente entre avatar y voz es una relación de sistema, distinta de los grupos creados por el usuario.

### Identificación

Una relación válida requiere exactamente:

- un clip en una pista con rol semántico `AVATAR`;
- un clip de audio en una pista con rol semántico `VOICE`;
- el mismo `sceneId` en ambos clips.

Si existen varios candidatos de avatar o voz para una misma escena, la relación se considera ambigua y la operación vinculada se rechaza. No se elige silenciosamente el primer candidato.

### Operaciones acopladas

En esta fase, mover cualquiera de los dos clips mueve también su contraparte usando el mismo delta temporal. Esto preserva cualquier desfase intencional entre avatar y voz.

La operación es atómica:

- si una de las pistas está bloqueada, ninguno de los clips se mueve;
- si el movimiento llevaría a cualquiera de los clips antes de `0`, ninguno se mueve;
- si la relación es ambigua, ninguno se mueve;
- la duración del canvas se amplía usando el final real de ambos clips después del movimiento.

Las propiedades individuales —volumen, opacidad, efectos, recorte y orden visual— no quedan acopladas por esta relación.

### Convivencia con grupos de usuario

- Avatar y voz pueden pertenecer a un mismo grupo de usuario, pero el grupo no sustituye la relación de sistema.
- Desagrupar elementos no rompe la relación avatar–voz.
- El enlace o desenlace explícito de avatar y voz deberá ser una operación propia si posteriormente se incorpora al producto.
- Al mover un grupo, cada clip se desplaza una sola vez aunque también forme parte de la relación avatar–voz.

## Clips derivados

Las operaciones actuales de división o eliminación de rango pueden producir más de un clip con el mismo `sceneId` y rol semántico. Hasta definir una identidad persistente de relación para esos fragmentos:

- no se emparejan fragmentos por posición ni por orden del arreglo;
- una relación con múltiples candidatos falla de forma segura;
- la división sincronizada de avatar y voz queda fuera de las fases 0 y 1 y debe revisarse explícitamente en la fase de operaciones de dominio.

## Alcance propuesto para las siguientes fases

### Fase 2 — modelo de grupos

- Implementado como `groups?` dentro de `courseforge-composition-v2`, con identificador estable, nombre opcional, miembros y orden.
- Los grupos son planos y cada clip puede tener una sola pertenencia directa; por ello no existen ciclos ni grupos anidados en esta entrega.
- Se rechazan grupos con menos de dos miembros, clips duplicados, miembros inexistentes, identificadores repetidos u órdenes repetidos.
- El límite temporal del grupo se deriva de la unión de sus miembros; no existe un clip sintético de render.
- Una prueba de equivalencia confirma que el compilador produce exactamente el mismo HTML HyperFrames con y sin metadata de grupo.

### Fase 3 — operaciones de dominio

- Implementadas las operaciones atómicas `group.create`, `group.ungroup`, `group.add-clips`, `group.remove-clips` y `group.move`.
- Mover el grupo preserva pistas y offsets relativos, y amplía el canvas cuando es necesario.
- Toda la operación se rechaza si cualquier miembro afectado —incluida una contraparte avatar–voz externa— está bloqueado.
- Las relaciones avatar–voz se resuelven como un conjunto para que cada clip se mueva una sola vez; si el vínculo cruza dos grupos distintos, el movimiento se rechaza.
- `clip.split` y un `clip.remove-range` intermedio añaden el fragmento derivado al grupo de origen.
- Eliminar clips y consolidar fragmentos normaliza membresías; un grupo con menos de dos miembros se disuelve.
- La división individual de una relación avatar–voz se rechaza hasta disponer de una operación sincronizada que reciba identidades para ambos fragmentos.
- Cada operación modifica el documento de forma atómica dentro de una única solicitud de patch, compatible con el historial versionado existente.

### Fases 4 y 5 — experiencia de edición

- La selección múltiple usa `Ctrl`, `Cmd` o `Shift` y permite reunir clips no agrupados de pistas diferentes.
- La barra contextual informa el número de clips seleccionados y ofrece las acciones `Agrupar`, `Editar contenido`, `Desagrupar` y `Salir del grupo` según el estado actual.
- Cada grupo se representa con límites temporales derivados en todas las pistas que contienen miembros. Violeta identifica el grupo seleccionado y cian el grupo abierto para edición.
- Fuera del grupo, seleccionar o arrastrar cualquier miembro selecciona y mueve la unidad completa conservando pistas y offsets relativos.
- Se entra al grupo mediante doble clic, `Enter` o la acción explícita `Editar contenido`.
- Dentro del grupo, cada miembro recupera su selección, movimiento, recorte y ajuste de duración independientes; los clips ajenos quedan deshabilitados mientras se mantiene el contexto del grupo padre.
- Al salir del grupo se restaura la selección de la unidad completa sin perder la selección representativa del inspector.
- Las flechas izquierda y derecha desplazan el grupo completo desde fuera o el miembro activo desde dentro. `Shift` conserva el desplazamiento grueso existente.
- La metadata y la navegación de grupo existen únicamente en React y en el documento editable; no se incorporan nodos ni atributos de agrupación al DOM renderizable de HyperFrames.

### Fases 6 y 7 — persistencia y validación

- El round-trip JSON conserva grupos y continúa aceptando documentos anteriores sin `groups`.
- Las operaciones de grupo atraviesan el mismo guardado versionado y la misma cola serial de autosave que el resto de las operaciones del editor.
- La auditoría de cada versión registra `groupCount` y los tipos de operación, sin incluir esa metadata en el HTML de render.
- Recargar el documento conserva identificadores, miembros, etiquetas y orden de los grupos.
- Restaurar una versión o snapshot recupera exactamente el estado agrupado o desagrupado de esa versión, creando una versión nueva y sin mutar el histórico.
- El snapshot inmutable continúa incluyendo `composition-document.json` para restauración, mientras `index.html` permanece libre de metadata de grupos.
- La matriz automatizada valida persistencia, historial, restauración, preflight, contrato HTML, cliente cloud, idempotencia y perfil de render ligado al snapshot.
- El preflight mantiene variables remotas, buckets confiables, formatos admitidos, límite de archivo de 200 MiB, límite de video del proveedor y salida durable de hasta 2 GiB.
- La relación avatar–voz conserva video silenciado más audio separado, así como `hasAudio` obligatorio antes del snapshot.
- El perfil durable permanece en 25 FPS y se resuelve desde el snapshot inmutable.
- No se ejecuta un render cloud real como parte de las pruebas automáticas: HyperFrames exige revisión del preview y aprobación explícita antes de consumir un render. Ese smoke operacional es el único paso externo pendiente.

## Criterios de aceptación de las fases 0 y 1

- Un documento v2 existente sigue siendo válido sin cambios.
- El snapshot sigue siendo `hyperframes-html-v1`.
- Mover avatar o voz desplaza ambos por el mismo delta.
- Se conserva un desfase temporal inicial entre ambos clips.
- Un bloqueo en cualquiera de las pistas rechaza la operación completa.
- Una relación ambigua se rechaza sin mutar el documento.
- La extensión del canvas contempla el final real del clip vinculado.
- Los cambios visuales o de audio individuales continúan siendo independientes.

## Criterios de aceptación de las fases 2 y 3

- Los documentos v2 sin `groups` continúan siendo válidos.
- Se pueden agrupar clips de cualquier tipo y de múltiples pistas.
- Un clip no puede pertenecer directamente a dos grupos.
- Crear, desagrupar, añadir, retirar y mover se ejecuta de forma atómica.
- El movimiento conserva pistas, offsets relativos y vínculos avatar–voz.
- Los clips individuales del grupo conservan todas sus operaciones existentes.
- Los fragmentos derivados conservan la pertenencia al grupo cuando la operación es segura.
- Las eliminaciones y reconciliaciones disuelven grupos que quedan con menos de dos miembros.
- El HTML compilado para HyperFrames es idéntico con y sin metadata de agrupamiento.

## Criterios de aceptación de las fases 4 y 5

- Se pueden seleccionar dos o más clips no agrupados, incluso si están en pistas diferentes, y crear una sola unidad lógica.
- Un clic sobre cualquier miembro desde el contexto exterior selecciona el grupo completo.
- Arrastrar o usar las flechas desde el contexto exterior mueve todos los miembros mediante una única operación `group.move`.
- Los límites visuales del grupo acompañan el movimiento y distinguen entre selección exterior y edición interior.
- Doble clic, `Enter` y la acción contextual permiten entrar al grupo; la acción `Salir del grupo` recupera el contexto exterior.
- Dentro del grupo se puede seleccionar, mover y recortar un miembro sin desplazar automáticamente los demás, salvo las relaciones de sistema avatar–voz que continúan aplicando.
- Mientras se edita un grupo, los clips externos no aceptan gestos de edición desde el timeline.
- Desagrupar elimina solo la relación lógica y conserva clips, pistas, tiempos y la unión avatar–voz.
- La selección y los comandos principales disponen de estado visible, foco de teclado y etiquetas accesibles.
- TypeScript, ESLint y las pruebas focalizadas del compilador, política de preview y patches editoriales completan sin errores.

## Criterios de aceptación de las fases 6 y 7

- Guardar y volver a cargar un documento conserva íntegramente sus grupos.
- Un documento previo sin `groups` continúa validando y mantiene su representación original.
- El hash del documento cambia cuando cambia la agrupación y permanece estable tras serializar y deserializar el mismo estado.
- Restaurar historial o snapshot conserva exactamente el estado de agrupación de la versión seleccionada.
- El HTML HyperFrames generado es idéntico antes y después de agregar únicamente metadata de grupo.
- El snapshot mantiene `hyperframes-html-v1`, variables remotas, 25 FPS y audio de video separado.
- El preflight rechaza archivos, formatos, buckets, rutas y perfiles incompatibles antes de contactar al proveedor.
- Los reintentos cloud conservan una clave de idempotencia segura y distinta por intento del mismo snapshot.
- Las pruebas focalizadas de estas fases completan sin errores; un render real solo se autoriza después de revisar el preview final.
