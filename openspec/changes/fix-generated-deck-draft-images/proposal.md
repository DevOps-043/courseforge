# Reparar apertura del editor para decks con imágenes generadas

La apertura del borrador falla cuando la proyección narrativa vuelve a procesar
un deck con imágenes y no recibe la lista de URLs ya verificadas. Conservar todas
las comprobaciones de ownership, registro, ruta, checksum y hashes; permitir solo
esas referencias exactas en la proyección. Informar errores editoriales conocidos
con diagnóstico seguro en lugar de un INTERNAL_ERROR genérico.
