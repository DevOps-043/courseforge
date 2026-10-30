# Diseño

- Reutilizar el inspector y los patches existentes; no crear un editor paralelo.
- CompositionTimelineWorkspace encuentra clips con placement de intro/outro y
  abre propiedades mediante onSelect. Limpia selección múltiple/grupo antes de
  seleccionar y mueve el cursor a la ventana del clip.
- El reconciliador corporativo identifica por asset y placement. Conserva la
  instancia y sus animaciones mientras recalcula únicamente el inicio y la
  envolvente temporal. Reserva sus IDs al construir clips nuevos.
- Reaplicar la misma intro de Producción devuelve el documento existente.
- Sustituir o retirar recursos conserva la limpieza previa de animaciones.
- Los patches siguen validando pistas bloqueadas y los servicios existentes
  mantienen autoridad por organización; no se agregan URLs ni credenciales.
- Separar audio sólo se muestra para PRODUCTION_ASSET, que es la fuente admitida
  por su handler. No se simula soporte de derivados para recursos corporativos.

Alternativa descartada: duplicar controles exclusivos de branding, que crearía
dos implementaciones de motion y profundidad. Compatibilidad V1/V2 intacta.
Rollback: revertir estos archivos, conservando lectura del documento V2.

Fuentes: CompositionInspector.tsx, LayerDepthControls.tsx,
CompositionMotionControls.tsx, composition-branding.service.ts,
composition-production-intro.service.ts y editor-patch.service.ts.
