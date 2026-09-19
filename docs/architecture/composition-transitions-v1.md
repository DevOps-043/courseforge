# ADR: transiciones reales entre clips

## Estado

Aceptado para implementación — 2026-09-17.

Alcance de este documento: fases 0 a 7 del trabajo de transiciones. El runtime
visual compartido por preview/render se añadió en las fases 2 y 3; las fases 4
y 5 incorporan la autoría en timeline y el crossfade de audio; las fases 6 y
7 cierran persistencia, snapshots y contrato local/cloud.

## Problema

Las animaciones actuales pertenecen a un único clip. Componer un `FADE_OUT`
del clip saliente con un `FADE_IN` del entrante no crea una transición real:
no existe una identidad común, una ventana compartida ni una validación que
garantice que ambos medios pueden renderizarse simultáneamente.

Una transición real pertenece al punto de edición `A -> B`. Durante su ventana
debe disponer del final de A y del inicio de B y debe conservar el mismo estado
al reproducir, pausar, buscar o renderizar cualquier frame.

## Decisión

### Fuente de verdad

El documento editable continúa usando `courseforge-composition-v2`. Se añade
un subcontrato opcional y versionado:

```ts
transitions?: {
  schemaVersion: 1;
  items: CompositionTransition[];
}
```

No se crea `courseforge-composition-v3` porque el cambio es aditivo: los
documentos anteriores sin `transitions` siguen siendo válidos y equivalen a
`items: []`. Toda transición nueva se persiste como datos estructurados; no se
aceptan selectores, callbacks, CSS, JavaScript ni expresiones arbitrarias.

### Identidad y tiempo

Una transición referencia dos clips visuales mediante `fromClipId` y
`toClipId`. El punto de edición se deriva del final canónico del clip saliente
y del inicio canónico del entrante; no se persiste otro reloj independiente.

La duración se cuantiza al FPS del documento. La ventana se deriva según la
alineación:

- `CENTER_AT_CUT`: mitad antes y mitad después del corte.
- `START_AT_CUT`: comienza en el corte y se extiende hacia el clip entrante.
- `END_AT_CUT`: termina en el corte y se extiende hacia el clip saliente.

### Media handles

Para video, el handle de entrada es `sourceOffsetSeconds` y el handle de salida
es el contenido disponible después de `sourceOffsetSeconds + durationSeconds`.
El cálculo exige `sourceDurationSeconds` verificado. Imágenes y diapositivas
pueden congelar determinísticamente su estado inicial o final.

En esta entrega no se repiten frames ni se aplica ripple de manera implícita.
Si no existen handles suficientes, la operación falla e informa la duración
máxima disponible o una alineación alternativa.

### Separación respecto de Motion

- `motion.animations[]` continúa apuntando a un solo clip.
- `transitions.items[]` apunta a un par ordenado de clips.
- Una animación de borde que compita con la ventana de transición invalida la
  transición.
- El movimiento ambiental interior puede coexistir cuando no ocupa ese borde.

### Catálogo V1

El contrato reconoce:

- `CROSS_DISSOLVE`
- `DIP_TO_COLOR`
- `PUSH`
- `SOFT_WIPE`
- `BLUR_DISSOLVE`

Las primeras cuatro forman el MVP del runtime. `BLUR_DISSOLVE` permanece en el
contrato para experimentación controlada. El runtime limita el blur a 40 px;
la futura interfaz deberá etiquetarlo como efecto de mayor costo.

Para `PUSH` y `SOFT_WIPE`, `direction` nombra el desplazamiento del clip
saliente o del borde de revelado: `LEFT`, `RIGHT`, `UP` o `DOWN`.

### Audio

Cada transición declara `audioMode: CUT | CROSSFADE`. `CUT` conserva las
ventanas canónicas y el corte duro. `CROSSFADE` solo es elegible cuando ambos
extremos poseen audio configurable confirmado; entonces el runtime extiende
sus ventanas de audio con los mismos handles verificados de la imagen y crea
dos envolventes de volumen en el timeline GSAP pausado. No se persiste una
segunda base de tiempos ni se modifica el timing canónico de los clips.

## Condiciones de elegibilidad V1

1. Ambos extremos existen, son visuales, visibles y distintos.
2. Sus pistas existen, están visibles y desbloqueadas.
3. Comparten `trackId` y `layout.zIndex`.
4. El final de A y el inicio de B coinciden con tolerancia máxima de un frame.
5. La duración es positiva, cuantizada al FPS, no supera dos segundos ni el
   25% del clip más corto.
6. La ventana queda dentro del canvas y de ambos clips.
7. Los videos tienen duración de fuente verificada y handles suficientes.
8. No existe otra transición en el mismo punto de edición.
9. Ningún tercer clip del mismo track y profundidad ocupa la ventana.
10. No existe una animación de borde que compita con la transición.
11. `CROSSFADE` requiere audio configurable en ambos videos; silenciar una
    pista conserva la relación y produce volumen efectivo cero.

## Integridad durante la edición

- Eliminar un clip elimina sus transiciones conectadas.
- Mover, recortar o cambiar duración debe conservar la elegibilidad al final
  del batch; de lo contrario se rechaza todo el batch.
- Dividir un clip conserva la transición de entrada en el fragmento izquierdo
  y transfiere la transición de salida al fragmento derecho.
- Eliminar un rango intermedio transfiere la transición de salida al fragmento
  que conserva el borde final; si ripple o trim rompe el empalme, se rechaza.
- Reiniciar un asset elimina relaciones de fragmentos descartados y vuelve a
  validar las restantes.
- Restore y reconcile deben producir un documento semánticamente válido.

## Consecuencias

El editor obtiene una entidad seleccionable y reversible distinta de las
animaciones. Preview y render podrán compilar exactamente la misma relación.
La asignación de tracks de render deberá considerar las ventanas extendidas,
pero los tiempos canónicos de los clips y la navegación narrativa no cambian.

## Rollback

La función puede ocultarse y dejar `transitions.items` sin compilar. Los
documentos anteriores siguen siendo válidos y los documentos nuevos conservan
datos declarativos que pueden eliminarse mediante `transition.remove`.

## Definition of Done de fases 0 y 1

- Contrato documentado y schema backward-compatible.
- Cálculo determinista de corte, ventana, handles y duración máxima.
- Operaciones `transition.add`, `transition.update` y `transition.remove`.
- Integridad con delete, move, trim, split, remove-range, reset y restore.
- Pruebas de schema, handles, elegibilidad, operaciones y rollback atómico.

## Implementación de fases 2 y 3

- Un proyector runtime deriva ventanas extendidas sin modificar el timing
  canónico persistido.
- El clip entrante de video ajusta temporalmente su `sourceOffset` para leer el
  head verificado; el saliente continúa hacia su tail verificado.
- El layout asigna lanes visuales distintos durante el solapamiento. Los lanes
  de audio conservan los tiempos canónicos mientras `audioMode` siga en `CUT`.
- Preview interactivo y render HyperFrames reciben el mismo payload de
  transición y la misma proyección de handles.
- Los cinco tipos del catálogo se ejecutan en el timeline GSAP pausado y único:
  disolvencia, dip a color, push, wipe suave y disolvencia con blur.
- El efecto se aplica al contenedor del clip y Motion al sujeto interior, para
  que ambos sistemas no compitan por la misma propiedad DOM.
- Un smoke test en navegador verifica el frame anterior, el punto medio, el
  final y un seek hacia atrás de la disolvencia.

## Definition of Done de fases 2 y 3

- Paridad del payload y de los handles entre preview y render.
- Medios visuales extendidos sólo en la proyección compilada.
- Separación de lanes durante el solapamiento real.
- Catálogo V1 compilado sobre un único reloj seek-safe.
- Pruebas unitarias, de compilación y smoke en navegador aprobadas.

## Implementación de fases 4 y 5

- La timeline deriva los puntos de edición elegibles a partir de clips
  visuales adyacentes de la misma pista y profundidad.
- Cada transición persistida aparece como un marcador seleccionable en el
  corte. El panel permite añadir, editar o quitar la relación y distingue el
  efecto compartido de las animaciones de entrada/salida de un clip.
- La duración se limita a frames completos y al máximo calculado a partir de
  handles, canvas, duración de clips y alineación.
- El catálogo expone parámetros específicos: color, dirección o blur, además
  de easing, alineación y modo de audio.
- `CROSSFADE` amplía únicamente la proyección de los elementos `<audio>` de
  ambos videos, asigna lanes distintos durante el solapamiento y anima sus
  volúmenes base en la misma timeline determinista usada por preview y render.
- `CUT` mantiene el comportamiento anterior y permite compartir lane de audio
  cuando los intervalos canónicos no se solapan.

## Definition of Done de fases 4 y 5

- Autoría completa add/update/remove desde la timeline.
- Marcadores de corte navegables y límites de duración visibles.
- Parámetros del catálogo editables sin estados intermedios inválidos.
- Crossfade condicionado a audio confirmado y paridad preview/render.
- Tests de edit points, elegibilidad de audio, ventanas runtime, lanes y
  compilación de envolventes.

## Implementación de fases 6 y 7

### Persistencia, historial y snapshots

- El subcontrato `transitions` atraviesa el round-trip JSON del documento v2;
  los documentos previos continúan siendo válidos con la colección vacía.
- El hash semántico cambia al añadir o modificar una transición y permanece
  estable después de serializar y volver a validar el mismo documento.
- Las operaciones atraviesan la cola versionada existente. La metadata de cada
  versión registra `transitionCount` y los tipos de operación, sin persistir
  URLs, selectores ni estado del panel.
- `document.restore` y la restauración RPC de snapshots recuperan exactamente
  la relación aprobada, creando una nueva versión editable y sin mutar el
  histórico.
- El ZIP inmutable incluye `composition-document.json`; por ello una revisión
  puede restaurar los parámetros visuales, la alineación y el modo de audio.

### Contrato local/cloud

- El snapshot conserva `format: hyperframes-html-v1`, 25 FPS y el perfil de
  render aprobado e inmutable.
- Los medios siguen representados mediante variables remotas versionadas; el
  HTML no contiene rutas de Storage ni URLs firmadas.
- El video permanece silenciado y cada fuente audible se compila como elemento
  `<audio>` separado. Un crossfade reserva lanes distintos solo durante su
  ventana runtime.
- El preflight valida tamaño del ZIP, manifiesto, entrega remota, duración y
  presupuesto antes de contactar al proveedor.
- La suite automatizada construye y abre un ZIP representativo, valida el
  documento editable, el HTML y el perfil. No inicia un render cloud real:
  esa operación consume recursos y requiere aprobación explícita del preview.

## Definition of Done de fases 6 y 7

- Guardar, recargar, restaurar historial y restaurar snapshot conservan la
  transición completa.
- Auditoría versionada registra el recuento y la operación aplicada.
- El archivo aprobado contiene HTML determinista y documento fuente válido.
- El preflight cloud pasa con variables remotas y perfil durable a 25 FPS.
- Cambiar el perfil después de aprobar el snapshot se rechaza.
- Las pruebas focalizadas de dominio, persistencia y cloud pasan; el único paso
  externo pendiente es un render real autorizado después de revisión visual.
