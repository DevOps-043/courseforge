# Hanademi Deck SVG Implementation Notes

Fecha de captura: 2026-08-01

Fuente observada: `https://hanademi.com/decks/indice-economico-de-anthropic-explicado-20260801-200245/es/`

Fuente de criterio para este analisis: `prompt_maestro.md`

## Objetivo

Conservar el analisis tecnico de la pagina/deck de Hanademi como referencia para una posible implementacion futura en Courseforge, especialmente para la Fase 6 de produccion visual, slides exportables y graficas responsive.

Este documento no define una implementacion final. Es una base de arquitectura y criterios para evaluar si conviene replicar, adaptar o redisenar el patron.

## Hallazgo principal

Las diapositivas no estan renderizadas como imagenes planas ni como canvas interactivo. Cada diapositiva esta construida como un SVG inline autonomo dentro de una card HTML.

La unidad base observada es:

```html
<div class="item loc-es" data-ct="line">
  <div class="head-row">...</div>
  <div class="card">
    <svg viewBox="0 0 1600 1200" class="v6-svg" role="img">...</svg>
  </div>
  <div class="story">...</div>
  <div class="slide-sources">...</div>
</div>
```

La pagina contiene dos versiones completas del deck en el DOM:

- `loc-en`: version en ingles.
- `loc-es`: version en espanol.

El idioma activo se controla con `body[data-lang]` y CSS.

## Estructura interna de las diapositivas

Cada slide usa `viewBox="0 0 1600 1200"`, equivalente a formato 4:3. La responsividad principal viene de:

```css
.card svg {
  display: block;
  width: 100%;
  height: auto;
}
```

Esto significa que el layout interno no se recalcula en runtime segun el viewport. La slide completa escala como vector.

Elementos observados:

- Fondo SVG con `rect width="1600" height="1200"`.
- Logos como `image` duplicadas por marca y tema.
- Titulos, subtitulos, notas y fuentes como nodos `text`.
- Graficas con primitivas SVG: `rect`, `line`, `path`, `circle`, `text`, `image`.
- Sin `foreignObject`.
- Sin canvas para el render visible.

Conteos observados en el HTML:

- 62 SVGs totales.
- 31 diapositivas por idioma.
- 524 `rect`.
- 140 `circle`.
- 84 `path`.
- 248 `line`.
- 915 `text`.
- 242 `image`.
- 0 `foreignObject`.

## Tipos de slides/graficas detectados

Los tipos aparecen como `data-ct`:

- `area`
- `bar`
- `column`
- `cover`
- `dumbbell`
- `funnel`
- `glossary`
- `line`
- `lollipop`
- `number_ladder`
- `photo`
- `pictograph`
- `proportion`
- `reference_bars`
- `statement`
- `surprise_list`
- `treemap`
- `waterfall`

Estos tipos funcionan como una taxonomia visual. Para Courseforge convendria modelarlos como templates de slide o chart renderers.

## Como se conforman las graficas

Las graficas estan precalculadas a coordenadas SVG. El navegador no recibe un dataset y recalcula escalas en cada resize. El responsive es vectorial, no algoritmico.

### Barras horizontales

Patron observado:

```html
<line data-zero-axis="true" x1="499" y1="476" x2="499" y2="944" />
<rect x="90" y="512" width="1420" height="34" fill="var(--v6-track)" />
<rect x="499" y="512" width="913" height="34" fill="var(--v6-green)" />
<rect data-negative="true" x="188" y="742" width="311" height="34" fill="var(--v6-coral)" />
```

Interpretacion:

- El track horizontal ocupa aproximadamente `x=90` a `x=1510`.
- El eje cero puede estar desplazado, por ejemplo `x=499`.
- Valores positivos crecen desde el eje cero hacia la derecha.
- Valores negativos terminan en el eje cero y empiezan a la izquierda.
- Las etiquetas y valores se posicionan con `text-anchor`.

### Line charts

Patron observado:

```html
<line x1="170" y1="1030" x2="1350" y2="1030" />
<path
  d="M170.0 514.7 L204.7 524.6 ... L1350.0 842.7"
  fill="none"
  stroke="var(--v6-blue)"
  pathLength="1"
/>
```

Interpretacion:

- El area de plot se materializa en coordenadas SVG.
- Los puntos X suelen estar distribuidos de forma equidistante.
- Los puntos Y ya vienen convertidos a pixeles SVG.
- `pathLength="1"` permite animar el dibujo del trazo con `stroke-dasharray` y `stroke-dashoffset`.

### Area charts

Patron observado:

```html
<path
  d="M170.0 919.5 ... L1480.0 477.4 L1480.0 1030.0 L170.0 1030.0 Z"
  fill="var(--v6-green)"
  opacity="0.14"
/>
<path
  d="M170.0 919.5 ... L1480.0 477.4"
  fill="none"
  stroke="var(--v6-green)"
  pathLength="1"
/>
```

Interpretacion:

- El area se cierra contra una baseline, por ejemplo `y=1030`.
- La linea principal se dibuja encima como otro `path`.
- Los callouts se componen con `circle`, `path` curvo, `rect` de fondo y `text`.

## Temas, marcas y estilos

El sistema usa variables CSS dentro de `.v6-svg`:

```css
.v6-svg {
  --v6-paper: #F7F5EF;
  --v6-ink: #181B28;
  --v6-green: #0AE88A;
}

body.theme-dark .v6-svg {
  --v6-paper: #181B28;
  --v6-ink: #F2F0EA;
}
```

La marca activa se resuelve por CSS y JS. El SVG contiene assets de varias marcas/tonos, y se ocultan los no activos:

- `brand-hanademi`
- `brand-platzi`
- `hane-black`
- `hane-white`
- `platzi-black`
- `platzi-white`

Para Courseforge, esto sugiere separar:

- tokens de tema,
- tokens de marca,
- layout de slide,
- chart renderer,
- export pipeline.

## Responsive de pagina

La slide es responsive por escalado SVG, pero la pagina tambien cambia layout externo:

- Vista `deck`: una slide por fila.
- Vista `table`: grid de miniaturas.
  - Desktop: 3 columnas.
  - Mobile: 2 columnas.
- Vista `talk`: texto narrativo al lado de la slide en desktop.
  - En mobile, la slide y el texto se apilan.

El toolbar se vuelve horizontal con scroll en mobile y oculta labels secundarios.

## Animacion

La animacion se activa con `IntersectionObserver`, agregando/removiendo la clase `.seen`.

Patrones:

- Lineas con `path[pathLength]`: animacion de dibujo con dash offset.
- Circulos: animacion de crecimiento con `scale(0)`.
- Barras horizontales: `scaleX(0)` desde el borde izquierdo.
- Barras verticales/columnas: `scaleY(0)` desde la base.
- Slides de statement/photo/cover: subida suave.

La animacion esta protegida por:

- `prefers-reduced-motion: no-preference`.
- clase `anim-ok`.
- exclusion en modo tabla.
- exclusion cuando `navigator.webdriver` esta activo, para capturas headless estables.

## Exportacion PNG/PDF

El render visible es SVG, pero la exportacion usa canvas.

Flujo observado para PNG:

1. Clonar el SVG de la slide.
2. Inyectar variables CSS del tema activo dentro del SVG clonado.
3. Filtrar logos/marcas no activas.
4. Convertir imagenes externas a `data:` via `fetch` + `FileReader`.
5. Serializar con `XMLSerializer`.
6. Cargar como `data:image/svg+xml`.
7. Dibujar en canvas.
8. Exportar como blob PNG.

Resolucion observada:

- SVG base: `1600x1200`.
- Canvas de exportacion: `3200x2400` con `scale=2`.

Flujo observado para PDF:

1. Exportar cada slide activa como JPEG.
2. Ensamblar un PDF 1.4 manual.
3. Una pagina por slide.
4. Pagina landscape 4:3.

Este enfoque evita dependencias pesadas para exportacion, pero exige pruebas estrictas porque un escritor PDF propio puede ser fragil ante edge cases.

## Implicaciones para Courseforge

El patron es valioso para Courseforge porque:

- Produce slides consistentes y exportables.
- Mantiene nitidez en cualquier viewport.
- Facilita exportar PNG/PDF desde el navegador.
- Permite dark/light theme sin regenerar contenido.
- Permite decks publicos, embebibles o revisables por QA.

Pero no conviene copiarlo como HTML monolitico. Segun `prompt_maestro.md`, la implementacion correcta deberia ser modular, tipada, testeable y desacoplada.

## Propuesta arquitectonica futura

Separar responsabilidades:

```text
domains/visual-production/
  slide-spec.schema.ts
  chart-spec.schema.ts
  slide-renderer.service.ts
  chart-layout.service.ts
  export.service.ts

components/slides/
  DeckViewer.tsx
  DeckToolbar.tsx
  SlideShell.tsx
  SvgSlide.tsx
  charts/
    BarChartSvg.tsx
    LineChartSvg.tsx
    AreaChartSvg.tsx
    ColumnChartSvg.tsx
    ProportionChartSvg.tsx
```

Modelo recomendado:

- Persistir `SlideSpec` y `ChartSpec` semanticos.
- No persistir solo SVG final como unica fuente de verdad.
- Generar SVG determinista desde specs.
- Guardar tambien snapshots/exportaciones como artefactos derivados.

Ejemplo conceptual:

```ts
type SlideSpec = {
  id: string;
  locale: "es" | "en";
  type: SlideType;
  title: string;
  subtitle?: string;
  story?: string;
  sources: SlideSource[];
  chart?: ChartSpec;
};

type ChartSpec =
  | BarChartSpec
  | LineChartSpec
  | AreaChartSpec
  | ColumnChartSpec
  | ProportionChartSpec;
```

El renderer deberia convertir:

```text
SlideSpec + ThemeTokens + BrandTokens -> SVG
```

La exportacion deberia convertir:

```text
SVG -> PNG/PDF
```

## Riesgos tecnicos

- Si se guardan solo coordenadas SVG, sera dificil auditar o regenerar graficas desde datos.
- Si se guarda solo HTML final, se mezcla contenido, layout, tema, marca y exportacion.
- Si se usa canvas como fuente principal, se pierde accesibilidad y trazabilidad.
- Si se implementa PDF manual, se requiere suite de regresion visual.
- Si se duplican idiomas como DOM completo, el payload puede crecer rapidamente en cursos grandes.

## Validaciones recomendadas

Para una implementacion futura, validar:

- Render desktop y mobile con screenshots.
- Export PNG por slide.
- Export PDF completo.
- Dark/light theme.
- Marca activa.
- Localizacion ES/EN.
- Slides con titulos largos.
- Series con valores negativos y positivos.
- Graficas con muchos puntos.
- Fuentes externas y logos.
- Modo reducido de movimiento.
- Capturas headless sin animaciones inestables.

## Decision recomendada

Adoptar el principio tecnico, no el monolito:

- Si: SVG inline 4:3 como salida visual canonica.
- Si: renderer declarativo desde specs tipados.
- Si: exportacion PNG/PDF desde SVG.
- Si: temas y marcas por tokens.
- No: HTML gigante inline como fuente unica.
- No: coordenadas SVG como unico modelo persistido.
- No: JS de exportacion mezclado con cada pagina sin capa reusable.

