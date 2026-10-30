# Controles de intro y outro en el editor

## Objetivo

Hacer accesibles capas y animaciones de las intros y outros insertadas y evitar
que reaplicar el mismo recurso descarte sus ajustes.

## Diagnóstico y alcance

El inspector nativo ya renderiza LayerDepthControls y CompositionMotionControls
para clips VIDEO, incluidas fuentes ASSEMBLY_BRAND_ASSET. La limitación es de
descubrimiento y conservación: el selector corporativo no abre el inspector y
reconcileAssemblyBrandingDocument reconstruye los clips y elimina su motion.
reconcileProductionIntroDocument también reinicia la intro al reaplicar el asset.
En el checkout actual, las intros nuevas proceden de Producción y la biblioteca
corporativa administra outros; las intros corporativas históricas siguen legibles.

## Resultado

Accesos Editar intro/outro junto al selector, selección individual y cursor al
inicio del clip. Reaplicar el mismo recurso conserva identidad, layout, recortes,
audio y motion; sustituirlo crea los ajustes iniciales y retira su motion anterior.
Se conserva la colocación corporativa al inicio/final y su duración editada.

No cambia upload, acceso a OneDrive, permisos, base de datos, formato V2 ni
proveedor de render. No hay publicación, despliegue ni consumo cloud.
