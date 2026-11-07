# Contexto y diseño

- Actor: editor autorizado dentro de su organización, manual o con instrucciones.
- Objetivo: reutilizar la configuración visible y confirmada sin copiar fuentes.
- Base: checkout principal con optimizaciones de carga previas, que se preservan.
- Contratos: documento sigue siendo canónico; If-Match y autorización existentes.
- No objetivos: convertir un preset en copia de un curso, traer assets/HTML,
  grupos o transiciones de otra lección, aplicar SQL o publicar.

La captura espera flush y cola, comprueba recuperación y lee el hash confirmado.
Un fallo no limpia el formulario. Los dos modos comparten extracción V2: la IA
transforma una copia validada, no modifica el documento fuente para crear un preset.

V2 separa reglas por rol, pista ordinal y tipo. Conserva secuencias/stack; las
ventanas irregulares solo se restauran cuando coincide la cardinalidad. De lo
contrario preserva el timing del destino y avisa. No se truncan variantes.

Los datos reutilizables incluyen layout/crop/mask/fit/color, fades relativos,
motion validado sin IDs, estilo textual sin referencias de fuente privada,
efectos generales de captions y mezcla global. Las referencias, contenido,
recortes de fuente, velocidad/congelación, envolventes ancladas a fuente,
agrupaciones, revisiones HTML y transiciones se conservan en el destino y se
diagnostican al capturar. No se transportan palabras ni énfasis de otro curso.

V1 conserva su lectura y semántica. Los presets del sistema siguen V1. SQL
existente admite schema_version positivo y JSONB; V2 requiere lectores nuevos.
Rollback con presets V2 existentes exige conservar el lector V2; no reescribir
versiones históricas. Recuperar fielmente campos perdidos en V1 requiere recaptura.
