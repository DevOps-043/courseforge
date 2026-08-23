# Timeline de composición por capas

## Decisión

El editor conserva `trackId` y `semanticRole` como clasificación de negocio,
pero deriva su presentación visual desde `layout.zIndex` y los intervalos de
tiempo. La persistencia no guarda filas de UI ni índices de render.

- Los grupos visuales se ordenan por profundidad, de frente hacia atrás.
- Dentro de una capa y rol semántico, clips consecutivos comparten fila.
- Un solapamiento temporal crea la cantidad mínima de subfilas necesaria.
- Las pistas de audio permanecen separadas de las capas visuales.
- Expandir un grupo muestra una fila por clip; contraerlo vuelve al layout compacto.

`composition-timeline-layout.service.ts` es la única fuente de verdad para la
distribución de filas y los `data-track-index` enviados a HyperFrames. Esto evita
que la UI muestre dos filas mientras el render intenta solapar ambos clips en un
mismo track temporal.

## Audio por clip

Cada clip con una fuente audible confirmada puede guardar `clip.volume` entre 0
y 1. El volumen efectivo es:

```text
track.volume × clip.volume
```

El volumen del track funciona como master y el del clip como ajuste local. Para
compatibilidad, B-roll sin valor explícito inicia en 0%, mientras avatar, voz y
música inician en 100%. Un avatar histórico sin `hasAudio` conserva narración;
un B-roll histórico sin ese dato permanece silenciado.

Al dividir un clip, los segmentos derivados conservan el volumen del clip de
origen y pueden ajustarse independientemente después.

## Invariantes

- Los intervalos son semiabiertos: `[inicio, inicio + duración)`.
- Clips adyacentes pueden compartir `data-track-index`.
- Clips solapados siempre reciben índices temporales distintos.
- El audio de un video se compila como un elemento `<audio>` separado.
- Cambiar el modo compacto/expandido nunca modifica el documento persistido.
