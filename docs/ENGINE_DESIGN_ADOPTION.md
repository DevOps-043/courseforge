# SofLIA Engine — adopción del sistema visual SofLIA

## Objetivo

SofLIA Engine comparte la identidad de SofLIA Learning sin perder la densidad que requiere un flujo operativo. La interfaz usa encabezados editoriales, navegación flotante, superficies sobrias, un solo acento turquesa y color semántico únicamente para estados.

## Fuentes de verdad

- `SofLIA-Learning/SofLIA-Learning/docs/SOFIA_DESIGN_SYSTEM.md`: identidad, tipografía, color, geometría, movimiento y accesibilidad.
- `apps/web/src/app/engine-design-system.css`: tokens semánticos y reglas transversales de Engine.
- `apps/web/src/components/layout/SharedSidebarLayout.tsx`: shell común para Admin, Arquitecto y Constructor.
- `apps/web/src/components/ui/EngineDialog.tsx`: arquitectura accesible de modales.

## Reglas de implementación

1. No agregar colores hexadecimales de marca dentro de componentes. Usar `--engine-*`.
2. Usar Newsreader para encabezados, Inter Tight para interfaz e IBM Plex Sans para labels o datos.
3. Reservar `--engine-accent` para selección, foco y acciones principales; usar success, warning y danger solo como estados.
4. Los botones deben tener un objetivo táctil mínimo de 44 px, radios de 0.8–0.95 rem y feedback de hover/press.
5. Los paneles de entrada usan `.engine-page-hero`; los flujos densos conservan tarjetas compactas.
6. Los nuevos modales deben usar `EngineDialog` para portal, bloqueo de scroll, Escape, focus trap y restauración de foco.
7. Toda animación debe respetar `prefers-reduced-motion`.

## Validación mínima

```bash
npx tsc --noEmit
npm run build
npm run test:auth-bridge
npm run test:curation
npm run test:publication
npm run test:remotion
npm run test:hyperframes
```

La revisión visual debe incluir escritorio, 390 px de ancho, apertura del drawer móvil, tema oscuro y un flujo operativo largo.
