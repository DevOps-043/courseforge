# Contexto y diseño

- Actor: equipo de producto preparando el branding global; nombre aprobado el 2026-10-28: SofLIA Architect. Nombre corto SofLIA; asistente y recursos gráficos actuales conservados.
- Base: staging, commit 2750311a; checkout limpio al iniciar; rama codex/global-branding.
- Alcance: identidad visible de la aplicación y valores predeterminados para contenido nuevo.
- Fuente: apps/web/src/config/app.ts, módulo puro de datos públicos apto para cliente, servidor y jobs con imports relativos donde corresponda.
- Mantener separadas identidad del producto, identidad del asistente e integraciones externas.
- No objetivos: modificar autenticación, recursos cloud, nombres de paquetes, historial documental, contenido persistido, paleta visual ni diseñar nuevos logos.
- Compatibilidad: prefijo de carpetas cloud permanece estable porque puede usarse para localizar recursos existentes. Los esquemas y namespaces conservan sus valores.
- Icono: mover `src/app/icon.png` a `public/icon.png` conserva URL y bytes; `metadata.icons` usa la configuración para evitar que la convención de archivo prevalezca sobre la marca elegida.
- Seguridad: React escapa contenido; generadores HTML deben escapar también la marca antes de interpolarla. No introducir secretos ni lectura de entorno en el módulo público.
- Criterios: cambiar la configuración propaga nombre/logos/contacto; metadata, UI y prompts compilan; pruebas detectan literales de producto nuevos fuera de excepciones justificadas.
- Efectos externos: ninguno durante implementación y pruebas. Reversión mediante revert del cambio; no hay datos que migrar.
