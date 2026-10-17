# Diseño

El flex exterior conserva alineación vertical, padding, fondo y estilo. Un único
bloque interior contiene el texto y los spans sincronizados en flujo inline.
Esto evita convertir cada palabra en un flex item independiente. Los captions con
efectos ya tienen un bloque equivalente y conservan su estructura y animaciones.

Mantener anclas, tiempos, saltos explícitos, puntuación, Unicode y escapes HTML.
Preview y render usan el mismo renderer; no persistir posiciones por palabra ni
introducir un segundo algoritmo de layout. Rollback: revertir el diff, sin migraciones.
