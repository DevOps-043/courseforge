# Patron de construccion de bundle personalizado

Este documento describe el patron seguido para construir la plantilla "Avatar fijo izquierda con diapositiva y B-roll derecha".

## Que hago al momento de hacer el bundle

1. Identifico el contrato tecnico del sistema: manifiesto requerido, `entryPoint`, `compositionId`, modo de exportacion, props aceptadas y dependencias permitidas.
2. Reviso como Courseforge entrega assets al render: `avatarVideoUrl`, `voiceAudioUrl`, `bgMusicUrl`, `slides[]`, `brollClips[]`, `totalDurationInFrames` y `layoutOverrides`.
3. Traduzco la peticion visual a reglas deterministas:
   - avatar siempre a la izquierda;
   - contenido educativo siempre a la derecha;
   - diapositiva arriba cuando hay B-roll;
   - B-roll abajo a la derecha cuando existe para la diapositiva activa;
   - diapositiva sola cuando no hay B-roll;
   - cero texto visual dentro del render.
4. Construyo la composicion Remotion como una funcion pura de props y frame actual.
5. Resuelvo la duracion con `calculateMetadata`, priorizando `totalDurationInFrames` para que el render final controle la duracion real.
6. Ordeno slides por `index` y B-roll por `order` para respetar el orden normalizado por SofLIA - Engine.
7. Calculo el indice activo de diapositiva dividiendo la duracion total entre el numero de diapositivas.
8. Busco el B-roll con el mismo indice de la diapositiva activa. Si no hay clip, no renderizo la caja de B-roll.
9. Mantengo audio de voz y musica como capas independientes que no modifican el layout.
10. Declaro `editableLayers` en el manifest con `layerId`, `kind`, capacidades y `defaultBox` en pixeles para que el editor de posiciones empiece desde el layout real del bundle.
11. Declaro un root Remotion con `registerRoot` y `<Composition>` para que el builder compile el ZIP fuente a un sitio Remotion con `index.html`.
12. Empaqueto el bundle con los tres archivos obligatorios: manifest, source y package.

## Recursos que investigo

- Guia interna de plantillas Remotion: `docs/remotion_templates_internal_guide.md`.
- Validador de bundles externos: `apps/web/src/domains/production/validation/bundle-validator.ts`.
- Generador base del bundle agent: `apps/web/src/domains/production/bundle-agent/generation.service.ts`.
- Contrato de props de Remotion: `apps/web/src/remotion/types.ts`.
- Normalizacion de assets de ensamblado: `apps/web/src/remotion/assembly-assets.normalizer.ts`.
- Composiciones internas existentes: `apps/web/src/remotion/compositions`.
- Ejemplos locales de bundles y manifiestos: `smoke-test-bundle` y ZIPs de plantillas Remotion existentes.
- Modelo de capas editables: `apps/web/src/remotion/layout-overrides.ts` y `apps/web/src/domains/materials/components/layoutOverrideDraftModel.ts`.

## Que tomo en cuenta para realizar el bundle

- Compatibilidad con el sistema de carga: el ZIP debe incluir `courseforge-remotion-template.json`, `src/index.tsx` y `package.json`.
- Compatibilidad con Desktop Worker: el `entryPoint` debe llamar `registerRoot()` para que `@remotion/bundler` genere `index.html` durante "Construir con worker".
- Seguridad del validador: no uso `fs`, `path`, `process`, `fetch`, `eval`, lifecycle scripts ni dependencias fuera de la allowlist.
- Portabilidad: todos los assets llegan por props, sin URLs hardcodeadas.
- Duracion correcta: el numero de slides manda la distribucion visual, no la duracion individual de los B-rolls.
- Cobertura completa de slides: todas las diapositivas deben aparecer al menos una vez durante la duracion total.
- Comportamiento ante faltantes:
  - sin avatar, no se dibuja reemplazo textual;
  - sin slide activa, el lado derecho queda limpio;
  - sin B-roll para una diapositiva, la diapositiva ocupa el espacio derecho disponible.
- Sin texto en pantalla: no se renderizan titulos, subtitulos, labels, captions, placeholders ni instrucciones visuales.
- Estabilidad visual: el avatar no se mueve de zona, el lado derecho conserva una jerarquia clara y el B-roll no altera el timeline.
- Maleabilidad posterior: se declaran capas compatibles con `layoutOverrides` para ajustes no destructivos desde el editor.
- Metadatos de posicion inicial: cada material editable debe declarar su caja base (`x`, `y`, `width`, `height`) en coordenadas del canvas 1920x1080. El editor usa esa caja como punto de partida y luego guarda diferencias como `position`, `size`, `crop`, `rotation` o `visibility`.

## Flujo ideal de bundles personalizados

1. El autor genera un ZIP fuente con `courseforge-remotion-template.json`, `src/index.tsx` y `package.json`.
2. El manifest declara `exportMode`, `compositionId`, `propsSchema`, `defaultProps`, `editableLayers`, dimensiones, FPS y version de Remotion.
3. El sistema sube el ZIP fuente a Storage y registra una nueva version en `remotion_template_versions`.
4. La auditoria estatica valida rutas, dependencias, manifest, `layoutOverrides` y metadatos de capas editables.
5. Un revisor aprueba la version, dejando el ZIP fuente como aprobado para compilacion.
6. El builder descarga el ZIP fuente, extrae el entrypoint, ejecuta `@remotion/bundler` y genera un sitio Remotion compilado.
7. El builder verifica que el artefacto compilado contenga `index.html` en la raiz.
8. El sistema sube el ZIP compilado a `template-bundles/template-builds/...` y marca el build como `BUILT`.
9. Preview y render final consumen el ZIP compilado, no el ZIP fuente.
10. El editor de posiciones consume `editableLayers` para mostrar las posiciones iniciales y guarda cambios como `layoutOverrides`.

## Regla replicable para el creador de bundles

Cuando un usuario pida una plantilla, convertir la solicitud en:

1. Contrato de assets requeridos.
2. Reglas de layout por zona.
3. Regla de timeline.
4. Reglas de fallback ante assets faltantes.
5. Restricciones explicitas de contenido visual.
6. Manifiesto compatible.
7. Composicion Remotion sin dependencias innecesarias.
8. Documento de patron que explique investigacion, decisiones y supuestos.
