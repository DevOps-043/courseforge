# Identidad global del producto

Estado: identidad configurada como **SofLIA Architect** el 2026-10-28.

## Fuente de configuración

La identidad pública vive en [app.ts](../../apps/web/src/config/app.ts). Es un módulo puro, tipado e inmutable, compartido por cliente, servidor y jobs. No consume variables de entorno ni debe contener secretos.

| Campo | Uso |
| --- | --- |
| `name` | Nombre completo: UI, metadata, errores, OAuth, prompts y contenido generado nuevo |
| `shortName` | Nombre corto en etiquetas, previews de plantillas y workers |
| `description` | Descripción de metadata raíz |
| `logo.src` | Ruta pública del logo en login, registro, dashboard y sidebar |
| `iconSrc` | Icono de pestaña declarado por metadata raíz |
| `supportEmail` | Contacto y enlace de correo de la política de privacidad |
| `assistant.name` | Identidad de Lia en el contexto predeterminado |
| `assistant.displayName` | Identidad visible del asistente de edición y Bundle Agent |

El nombre completo del producto es **SofLIA Architect** y el nombre corto sigue siendo **SofLIA**. Producto y asistente pueden cambiar de forma independiente. La plataforma externa SofLIA conserva sus textos de login, usuarios y publicación: es otra integración, no el nombre de esta aplicación. Logo, icono y contacto conservan sus recursos actuales hasta disponer de reemplazos aprobados.

## Procedimiento para cambiar la marca

1. Editar los campos públicos en `app.ts`. Usar un nombre no vacío de hasta 80 caracteres, compatible con el schema de slides; mantener nombres cortos legibles.
2. Agregar el logo e icono aprobados dentro de `apps/web/public/` y apuntar `logo.src` e `iconSrc` a rutas locales absolutas, por ejemplo `/marca/logo.png`. El icono actual se conserva en `public/icon.png`, con la misma URL `/icon.png`; no añadir `src/app/icon.png`, pues la convención de archivo tendría prioridad sobre la configuración de metadata.
3. Decidir por separado si también cambia el asistente. Confirmar el correo de contacto.
4. Ejecutar `npm run test:branding`, `npm run typecheck` y `npm run verify:pr`; revisar login, registro, sidebar, privacidad, errores, slides y OAuth en temas claro/oscuro y pantallas pequeñas.
5. Reconstruir y desplegar con autorización. La configuración se empaqueta en el build; no es un ajuste dinámico de base de datos.

Los colores y tipografías conservan el sistema de temas existente en `apps/web/src/app/globals.css` y los componentes. Esta entrega centraliza identidad textual y recursos; no rediseña la paleta ni genera nuevos assets.

## Compatibilidad y contenido histórico

No cambiar por branding:

- Variables `COURSEFORGE_*` / `SOFLIA_*`, issuer JWT, cookies, roles y proveedores.
- Formatos `courseforge-composition-*`, IDs de composición, eventos, CSS classes técnicas, claves de almacenamiento y nombres de paquetes.
- URLs, buckets, user agents y contratos externos.
- El prefijo histórico de carpetas cloud en `buildArtifactRootFolderName`, separado de la identidad de presentación.
- La normalización histórica de `ZofLIA` en contenido existente.
- El runtime educativo `SOFLIA_DIALOGUE`, sus personajes y marcas de la plataforma de destino.

Los valores predeterminados de schemas, plantillas y prompts usan la configuración para nuevas generaciones. Los documentos, decks, snapshots y prompts personalizados ya guardados mantienen su contenido. Cambiar textos históricos requiere un alcance y una migración propios; los snapshots conservan su hash y no se regeneran automáticamente.

## Seguridad y validación

React escapa el nombre al mostrarlo. HTML generado fuera de React usa el escape del renderer o [branding-html.ts](../../apps/web/src/config/branding-html.ts). Los textos incrustados en scripts no deben interpolarse como código.

`npm run test:branding` prueba una identidad alternativa, renderiza la página de privacidad, verifica metadata/correo, prompts y defaults de slides, comprueba que el proveedor conserva su ID y que OAuth escapa caracteres especiales sin cambiar su canal. Incluye una inspección AST de literales de producto en código activo con excepciones específicas de compatibilidad. No certifica un nuevo diseño visual ni un despliegue.

La especificación y evidencia se mantienen en [global-branding](../../openspec/changes/global-branding/proposal.md).
