# Diseño

Se reutiliza el contrato de transición CROSS_DISSOLVE + audioMode CROSSFADE para
dos clips AUDIO; cualquier efecto visual u otro modo se rechaza. No se modifica
el tipo persistido ni se simula una transición con fades independientes. CUT se
obtiene quitando la transición, sin alterar el corte canónico.

Los audios necesitan duración original y material disponible antes/después del
corte según la alineación. Se conservan controles de pista, vecindad, ventana,
tercer clip y límites de duración existentes. Runtime marca audioOnly, no agenda
opacity/transform sobre medios y extiende offsets/ventanas de audio reales.
Las lanes del proveedor separan solapamientos de runtime. La ganancia se calcula
con la envolvente compartida, incluido maestro, curvas y fades.

El zoom «Ampliar audio» centra el clip seleccionado y apunta a ocho píxeles por
frame hasta un máximo de 128x. No cambia duración ni playbackRate. doble clic sobre
el audio sitúa el cursor en el frame pulsado sin arrastrarlo; luego «Dividir» usa
el comando existente, con undo/historial. El ruler limita marcas para no crear
un árbol DOM proporcional a la cantidad de muestras o frames del archivo.

Compatibilidad: lectores anteriores rechazan transiciones sobre AUDIO aunque el
JSON conserve su forma. Desplegar servicios, compilador y UI juntos. Reversión:
conservar lector/runtime compatible o quitar las transiciones de audio antes de
degradarlo. No se permiten handles fuera de fuente ni se promete corte por muestra.
