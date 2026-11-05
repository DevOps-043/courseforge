# Diseño

El documento mantiene sus invariantes globales. composition-clip.contract.ts
posee layout/crop/fuentes y validaciones de un clip. El contrato tipográfico vive
en composition-font-reference.contract.ts; su lector puede seguir consumiendo el
documento sin ser una dependencia del schema. Las primitivas compartidas tienen
un único módulo de schemas; no se crean versiones alternativas de las reglas.

El plan de captions depende de CompositionClip y acepta { clips: readonly
CompositionClip[] }, que satisface el documento existente. No cambia su algoritmo
ni la validación global del presupuesto que llama al plan completo. Los tipos,
schemas, constantes y funciones públicos existentes conservan sus rutas mediante
reexports. Se mueven bloques existentes, sin reordenar los campos Zod.

Comparar antes/después serialización y plan de fixtures válidas y problemas Zod
de entradas inválidas. Comprobar identidad de los reexports y componente ausente
en el grafo, además de suites HyperFrames y gate proporcional.
