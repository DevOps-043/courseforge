# Bundle Agent: flujo limpio de creacion de bundles

## Objetivo

Rehacer el creador de bundles para que replique el patron probado manualmente:

1. Entender la intencion del usuario.
2. Convertirla a un blueprint tecnico auditable.
3. Generar manifest, source y ZIP desde ese blueprint.
4. Validar el ZIP fuente.
5. Aprobarlo.
6. Compilarlo a un sitio Remotion con `index.html`.
7. Usar el ZIP compilado para preview/render.

## Capas

### 1. Spec

Archivo: `apps/web/src/domains/production/bundle-agent/spec.service.ts`

Responsabilidad:

- Extraer requisitos desde la conversacion.
- Normalizar titulo, assets requeridos, color y copy seguro.
- Mantener compatibilidad con specs generadas por IA.

No debe generar codigo Remotion.

### 2. Blueprint

Archivo: `apps/web/src/domains/production/bundle-agent/blueprint.service.ts`

Responsabilidad:

- Traducir la spec a decisiones tecnicas deterministas.
- Resolver layout, timeline, si se permite texto visual y cajas iniciales.
- Declarar `editableLayers` con `defaultBox`, capacidades y constraints.

Este es el centro del nuevo creador.

### 3. Manifest

Archivo: `apps/web/src/domains/production/bundle-agent/manifest.service.ts`

Responsabilidad:

- Construir `courseforge-remotion-template.json`.
- Declarar `exportMode: "root"`.
- Incluir `propsSchema`, `defaultProps`, dimensiones, FPS y `editableLayers`.

### 4. Source

Archivo: `apps/web/src/domains/production/bundle-agent/template-source.service.ts`

Responsabilidad:

- Generar `src/index.tsx`.
- Registrar `registerRoot`.
- Declarar `<Composition>`.
- Resolver duracion con `calculateMetadata`.
- Consumir `layoutOverrides` con capas editables.
- No renderizar texto cuando el blueprint lo prohibe.

### 5. Packaging

Archivo: `apps/web/src/domains/production/bundle-agent/generation.service.ts`

Responsabilidad:

- Orquestar blueprint, manifest, source, `package.json` y README.
- Crear el ZIP fuente.
- Calcular hash.

No debe inferir layout ni escribir logica visual compleja.

## Flujo ideal

1. Usuario conversa con Bundle Agent.
2. El sistema genera una `BundleAgentSpec`.
3. La spec se convierte a `BundleBlueprint`.
4. El blueprint genera manifest/source.
5. El ZIP fuente se valida estaticamente.
6. El revisor aprueba la version.
7. El builder compila el ZIP fuente con `@remotion/bundler`.
8. El build solo se marca como usable si el ZIP compilado contiene `index.html`.
9. Preview y render consumen el ZIP compilado.
10. El editor de posiciones consume `editableLayers` y guarda cambios como `layoutOverrides`.

## Regla de oro

El creador nunca debe usar texto libre directamente para generar layout. Toda decision visual debe pasar por `BundleBlueprint`, porque ahi puede auditarse, probarse y extenderse sin aumentar deuda tecnica.
