# Plan de arquitectura: editor de layout para postproducción Remotion inspirado en Hyperframes

Fecha: 2026-07-17

Estado: borrador de planificación, sin implementación

## 1. Objetivo

Diseñar un plan incremental para potenciar el apartado de postproducción visual de Courseforge sin migrar forzosamente de Remotion a Hyperframes.

El objetivo no es adoptar Hyperframes completo ni reemplazar el pipeline actual. El objetivo es estudiar qué patrones de Hyperframes pueden ayudarnos a construir un editor propio para realizar correcciones pequeñas de layout dentro de Courseforge, principalmente:

- mover elementos visuales;
- ajustar tamaño;
- recortar/croppear zonas visuales;
- corregir composición del avatar, slides, B-roll, captions o elementos de apoyo;
- guardar esos cambios sin modificar el código de la plantilla;
- asegurar que preview y render final usen los mismos ajustes.

La restricción principal es conservar el flujo actual de Remotion y evitar una migración amplia mientras no exista una justificación técnica, operativa y económica suficiente.

## 2. Principios de decisión

Este plan sigue `prompt_maestro.md` como fuente de verdad para las decisiones de arquitectura:

1. Correctitud funcional antes que velocidad de entrega.
2. Seguridad explícita, especialmente porque se trata de edición visual, assets, plantillas y render.
3. Compatibilidad hacia atrás con el flujo Remotion actual.
4. Cambios incrementales y de bajo radio de impacto.
5. Contratos claros entre UI, preview, render y persistencia.
6. Observabilidad suficiente para diagnosticar diferencias entre preview y render.
7. Testabilidad desde el primer diseño, aunque todavía no se implemente.

## 3. Contexto actual del sistema

El apartado relacionado vive principalmente en:

- `apps/web/src/domains/materials/components/PostproductionAssemblyContainer.tsx`
- `apps/web/src/domains/materials/components/RemotionPreviewPlayer.tsx`
- `apps/web/src/domains/materials/components/RemotionExternalPreviewPlayer.tsx`
- `apps/web/src/remotion/buildAssemblyProps.ts`
- `apps/web/src/remotion/compositions/*`
- `apps/api/src/features/production/*`
- `apps/web/src/lib/server/desktop-worker-control-plane.ts`
- tablas como `production_jobs`, `remotion_template_versions` y `remotion_template_builds`

Actualmente existen dos rutas relevantes:

1. Preview interno:
   - usa `@remotion/player`;
   - construye props con `buildAssemblyProps`;
   - resuelve composiciones internas de Remotion;
   - no necesariamente ejecuta bundles externos.

2. Preview/render externo o worker:
   - usa `templateVersionId`, builds, `serve_url`, `production_jobs.input_snapshot` y `variables`;
   - puede usar plantillas aprobadas, builds externos y desktop worker;
   - depende de que los mismos datos lleguen al render final.

El riesgo principal es que el usuario vea una corrección en preview pero el video final no la respete. El plan debe diseñarse alrededor de esa regla:

> Lo que el editor muestra en preview debe ser exactamente lo que viaja al render.

## 4. Qué nos aporta Hyperframes

Hyperframes no se toma como reemplazo directo. Se toma como referencia técnica para tres ideas:

### 4.1 DOM o escena editable como fuente visual

Hyperframes facilita edición visual porque su composición es HTML/CSS/media. El mismo DOM que se ve en pantalla puede ser seleccionado, medido y ajustado.

En Courseforge no necesitamos convertir las plantillas Remotion a HTML. Podemos adaptar el patrón conceptual:

- identificar capas editables;
- representar cada capa con un contrato estable;
- dibujar overlays encima del preview;
- guardar cambios como deltas de layout.

### 4.2 Ediciones no destructivas

Hyperframes Studio guarda cambios manuales como manifiestos de edición, por ejemplo offsets, tamaños o rotaciones. Ese patrón es muy útil para Courseforge.

En vez de modificar la plantilla, Courseforge debería guardar algo equivalente a:

```json
{
  "version": 1,
  "canvas": {
    "width": 1920,
    "height": 1080
  },
  "edits": [
    {
      "layerId": "avatar",
      "kind": "position",
      "x": 1280,
      "y": 620
    },
    {
      "layerId": "supportVisual",
      "kind": "size",
      "width": 720,
      "height": 405
    }
  ]
}
```

### 4.3 Reaplicación determinística durante preview/render

La parte más importante es que los cambios no sean solo visuales en la UI. Deben aplicarse en cada render y, si hay seek o preview por frame, deben mantenerse estables.

Para Courseforge, eso significa que `layoutOverrides` debe entrar al mismo contrato que usa el render:

- preview interno;
- preview externo;
- job de producción;
- desktop worker;
- Remotion render final.

## 5. Qué necesitamos

### 5.1 Contrato de capas editables

Necesitamos definir qué elementos de una plantilla son editables.

Ejemplo conceptual:

```ts
type EditableLayerDefinition = {
  layerId: string;
  label: string;
  kind: "avatar" | "slides" | "broll" | "caption" | "background" | "decorative" | "custom";
  capabilities: {
    canMove: boolean;
    canResize: boolean;
    canCrop: boolean;
    canRotate: boolean;
    canHide: boolean;
  };
  constraints?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    lockAspectRatio?: boolean;
    safeArea?: "full" | "title-safe" | "custom";
  };
};
```

Cada plantilla interna debería exponer un conjunto limitado de capas editables. Ejemplos:

- `avatar`;
- `primaryVisual`;
- `slides`;
- `broll`;
- `caption`;
- `supportStrip`;
- `title`;
- `background`.

Para plantillas externas, este contrato tendría que venir del manifest o de metadata validada.

### 5.2 Contrato de overrides de layout

Necesitamos un formato único para guardar ajustes sin tocar la plantilla.

Ejemplo:

```ts
type LayoutOverrideManifest = {
  version: 1;
  templateId: string;
  templateVersionId?: string | null;
  componentId: string;
  canvas: {
    width: number;
    height: number;
    fps?: number;
  };
  edits: LayoutOverrideEdit[];
};

type LayoutOverrideEdit =
  | {
      layerId: string;
      kind: "position";
      x: number;
      y: number;
    }
  | {
      layerId: string;
      kind: "size";
      width: number;
      height: number;
    }
  | {
      layerId: string;
      kind: "crop";
      top: number;
      right: number;
      bottom: number;
      left: number;
    }
  | {
      layerId: string;
      kind: "rotation";
      angle: number;
    }
  | {
      layerId: string;
      kind: "visibility";
      hidden: boolean;
    };
```

Primera recomendación: iniciar con `position`, `size` y `crop`. Dejar `rotation` y `visibility` para una fase posterior.

### 5.3 Editor visual encima del preview

Necesitamos una capa UI encima del preview actual, no un editor de timeline.

Funciones iniciales:

- seleccionar capa editable;
- mostrar bounding box;
- mover con drag;
- redimensionar con handles;
- aplicar crop básico;
- resetear cambios por capa;
- guardar borrador;
- comparar contra layout original.

No debe permitir:

- editar código;
- editar timeline;
- editar duración;
- editar animaciones internas;
- insertar scripts;
- cambiar props fuera del contrato permitido.

### 5.4 Persistencia

Necesitamos decidir dónde guardar el manifiesto.

Opción A: persistencia mínima en JSON existente

- Guardar en `material_components.assets.layout_overrides`.
- Incluir en `production_jobs.input_snapshot.variables.layoutOverrides`.

Ventajas:

- Menor radio de impacto.
- Más rápido para MVP.
- Compatible con el flujo actual de `variables`.

Riesgos:

- Auditoría limitada.
- Menor trazabilidad de versiones.
- Difícil consultar historial por usuario o plantilla.

Opción B: tabla dedicada

Crear una tabla como `production_layout_overrides`.

Campos sugeridos:

- `id`
- `organization_id`
- `artifact_id`
- `material_component_id`
- `template_id`
- `template_version_id`
- `layout_manifest`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Ventajas:

- Mejor auditoría.
- Mejor control multi-tenant.
- Mejor versionado.
- Más limpio para workflows de QA.

Riesgos:

- Requiere migración.
- Requiere políticas RLS y servicios nuevos.
- Mayor alcance inicial.

Recomendación de planificación:

- MVP con persistencia mínima si queremos validar experiencia rápido.
- Tabla dedicada antes de producción real o antes de habilitarlo a múltiples organizaciones.

### 5.5 Aplicación de overrides en Remotion

Las composiciones internas deben poder recibir `layoutOverrides`.

Flujo esperado:

```text
PostproductionAssemblyContainer
  -> editor visual produce layoutOverrides
  -> RemotionPreviewPlayer recibe templateConfig + layoutOverrides
  -> buildAssemblyProps incluye layoutOverrides
  -> composición Remotion aplica overrides por layerId
  -> al crear production_job, variables incluye layoutOverrides
  -> worker/render final aplica el mismo layoutOverrides
```

Punto clave:

`layoutOverrides` debe viajar como dato de negocio controlado, no como CSS libre.

### 5.6 Compatibilidad con plantillas externas

Para plantillas externas o custom bundles, no debemos asumir que existen las mismas capas internas.

Requisitos mínimos:

- cada plantilla externa debe declarar capas editables;
- cada capa editable debe tener un `layerId` estable;
- el schema o manifest debe declarar capacidades permitidas;
- el render externo debe aceptar `layoutOverrides` explícitamente;
- si la plantilla no soporta una capa, el override debe ignorarse con warning trazable o bloquearse en UI.

Esto evita que Courseforge intente editar una plantilla que no expone puntos de control.

## 6. Enfoque propuesto

El enfoque recomendado es híbrido:

```text
Remotion permanece como renderer principal
Hyperframes inspira el modelo de edición visual
Courseforge define su propio contrato de layoutOverrides
Preview y render comparten el mismo manifiesto
```

No se migra todo a Hyperframes.

No se ejecuta HTML arbitrario como parte del MVP.

No se rompe el flujo actual de plantillas internas ni custom templates.

El sistema se expande con una capa nueva:

```text
Layout Editing Layer
  -> contracts
  -> UI overlay
  -> persistence
  -> Remotion adapter
  -> validation
```

## 7. Qué se queda

Debe quedarse:

- Remotion como pipeline principal de render.
- `RemotionPreviewPlayer` para preview interno.
- `RemotionExternalPreviewPlayer` para preview externo cuando aplique.
- `PostproductionAssemblyContainer` como pantalla dueña del flujo de postproducción.
- `templateConfig` como configuración general de plantilla.
- `variables` como canal para pasar datos al render, con validación.
- `production_jobs.input_snapshot` como snapshot de render.
- `remotion_template_versions` y `remotion_template_builds` para versionado/builds de plantillas.
- desktop worker y control plane actual.
- separación entre composiciones internas y custom/external bundles.

## 8. Qué se tiene que ir o evitarse

Debe evitarse:

- depender del editor externo de Remotion para correcciones pequeñas;
- editar código de plantillas desde la UI de postproducción;
- guardar CSS arbitrario como override;
- usar HTML/JS arbitrario de Hyperframes dentro del flujo Remotion actual;
- crear un segundo renderer obligatorio sin necesidad;
- duplicar lógica de layout entre preview y render;
- permitir que preview muestre algo que el render final no puede reproducir;
- mezclar controles de timeline con controles de layout en el MVP;
- aplicar `templateConfig` como sustituto de un contrato real de layout overrides;
- fallback silencioso cuando un override no puede aplicarse.

También debe irse, como deuda conceptual, la idea de que "si se ve en preview interno, entonces ya representa el render final". Esa suposición solo será válida cuando ambos consuman el mismo contrato.

## 9. Lo que queda pendiente de decidir

Antes de implementar, debemos decidir:

1. ¿El primer MVP será solo para plantillas internas o también para externas?
2. ¿Qué capas exactas serán editables en cada plantilla interna?
3. ¿El manifiesto se guardará inicialmente en `material_components.assets` o en tabla dedicada?
4. ¿El editor aplicará cambios por componente individual o por plantilla completa?
5. ¿Los ajustes se comparten entre lecciones o son específicos por video/componente?
6. ¿Qué roles pueden editar layout: admin, architect, builder?
7. ¿Los cambios requieren aprobación QA antes de renderizar?
8. ¿Qué pasa si cambia la plantilla después de guardar overrides?
9. ¿Cómo se versionan los overrides cuando cambia `templateVersionId`?
10. ¿Cuál será la política de reset y comparación contra original?

## 10. Plan por fases

### Fase 0: definición de alcance

Objetivo:

Definir el alcance exacto del MVP antes de tocar código.

Entregables:

- lista de plantillas internas soportadas;
- lista de capas editables por plantilla;
- decisión de persistencia inicial;
- reglas de seguridad;
- criterios de aceptación.

Resultado esperado:

Un contrato claro que evite implementar un editor demasiado amplio.

### Fase 1: contratos y modelo de datos

Objetivo:

Diseñar los contratos TypeScript/Zod y la estrategia de persistencia.

Archivos probables:

- `apps/web/src/remotion/layout-overrides/*`
- `apps/web/src/remotion/types.ts`
- servicio o util de validación de overrides
- posible migración Supabase si se elige tabla dedicada

Validaciones:

- schema acepta solo capas conocidas;
- schema rechaza valores no finitos, negativos inválidos o tamaños imposibles;
- schema no permite CSS, JS, selectores arbitrarios ni URLs.

### Fase 2: adaptación de composiciones Remotion internas

Objetivo:

Hacer que las composiciones internas puedan aplicar `layoutOverrides` por `layerId`.

Alcance inicial sugerido:

- `AvatarFocus`
- `FullSlides`
- `SplitAvatar`
- `PrimaryVisual`

Regla:

Los overrides deben aplicarse mediante estilos calculados seguros, no mediante inyección de CSS.

### Fase 3: preview editable

Objetivo:

Agregar un overlay visual a la pantalla de postproducción.

Componentes probables:

- `LayoutEditorOverlay`
- `EditableLayerPanel`
- `LayoutOverrideControls`
- `useLayoutEditorState`

Funcionalidades del MVP:

- seleccionar capa;
- mover;
- redimensionar;
- crop básico;
- reset por capa;
- guardar borrador;
- mostrar estado "sin guardar".

### Fase 4: persistencia y render

Objetivo:

Garantizar que los cambios del editor viajen al render final.

Puntos de integración:

- `PostproductionAssemblyContainer`
- `production.actions.ts`
- `render-batch.service.ts`
- `production_jobs.input_snapshot.variables`
- `remotion-worker.service.ts`
- `desktop-worker-control-plane.ts`

Criterio de aceptación:

Un cambio visual aplicado en preview debe aparecer en el MP4 final.

### Fase 5: compatibilidad con plantillas externas

Objetivo:

Permitir que plantillas externas declaren capas editables de forma segura.

Requisitos:

- extender manifest o metadata de plantilla;
- validar `editableLayers`;
- permitir `layoutOverrides` solo para capas declaradas;
- incluir `layoutOverrides` en `resolvedProps` si la plantilla lo soporta.

Esta fase no debe bloquear el MVP interno.

### Fase 6: QA visual y observabilidad

Objetivo:

Agregar validaciones para detectar layouts rotos.

Inspiración de Hyperframes:

- inspección de overflow;
- elementos fuera de canvas;
- contraste;
- screenshots en timestamps clave;
- reporte legible para QA.

Eventos/logs recomendados:

- `layout_editor.opened`
- `layout_editor.override.changed`
- `layout_editor.override.saved`
- `layout_editor.override.applied_to_preview`
- `layout_editor.override.applied_to_render`
- `layout_editor.override.invalid`
- `layout_editor.render_mismatch_detected`

## 11. Riesgos

### Riesgo 1: divergencia entre preview y render

Mitigación:

Usar un único contrato `layoutOverrides` y pasarlo por `variables` hasta `production_jobs.input_snapshot`.

### Riesgo 2: edición visual demasiado libre

Mitigación:

No permitir CSS ni selectores arbitrarios. Solo operaciones tipadas sobre capas declaradas.

### Riesgo 3: plantillas externas sin anchors estables

Mitigación:

No habilitar edición visual para plantillas externas hasta que declaren `editableLayers`.

### Riesgo 4: romper plantillas internas existentes

Mitigación:

Aplicar overrides solo si existen. Sin overrides, el render debe ser idéntico al flujo actual.

### Riesgo 5: deuda por persistencia rápida

Mitigación:

Si el MVP guarda JSON en `assets`, documentar desde el inicio cuándo debe migrarse a tabla dedicada.

## 12. Criterios de aceptación del MVP

El MVP se considera válido si:

1. Se puede abrir un video en postproducción.
2. Se puede seleccionar una capa editable.
3. Se puede mover y redimensionar al menos avatar y visual principal.
4. Se puede guardar el override.
5. Al recargar la pantalla, el override persiste.
6. El preview interno muestra el override.
7. El render final muestra el mismo override.
8. Si se borra el override, el video vuelve al layout original.
9. Los overrides inválidos se rechazan con errores claros.
10. Sin overrides, el comportamiento actual no cambia.

## 13. Decisión recomendada inicial

Recomendación para avanzar:

1. No migrar de Remotion a Hyperframes.
2. No adoptar el renderer de Hyperframes para el MVP.
3. Crear un contrato propio `layoutOverrides`.
4. Empezar solo con plantillas internas.
5. Limitar el editor a posición, tamaño y crop.
6. Guardar el manifiesto como parte de las variables del render.
7. Diseñar desde el inicio una ruta limpia hacia tabla dedicada.
8. Dejar plantillas externas para una fase posterior basada en `editableLayers`.

## 14. Próximo paso de edición del plan

El siguiente paso no es implementar. El siguiente paso es revisar y cerrar estas decisiones:

- Alcance del MVP: interno solamente o interno + externo.
- Capas editables iniciales.
- Persistencia inicial.
- Operaciones permitidas.
- Roles y QA.

Una vez cerradas esas decisiones, se puede convertir este documento en un plan de implementación técnico por fases.
