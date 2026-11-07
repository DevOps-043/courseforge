# Diseño

| Perfil | Formato | Resolución | FPS | Calidad |
| --- | --- | --- | --- | --- |
| Borrador | MP4 | 1080p | 24 | draft |
| Estándar | MP4 | 1080p | 25 | standard |
| Alta calidad | MP4 | 4K | 30 | high |
| MOV para edición | MOV | 1080p | 25 | high |

Los IDs históricos preview y high conservan sus valores. Nuevas selecciones
usan IDs distintos. El lienzo editorial mantiene su base de tiempo. El perfil
viaja en el manifiesto y el servidor compara cada parámetro antes del despacho.
MOV conserva el tamaño nativo y utiliza el importador TUS ya existente.
El presupuesto de salida considera el formato y la resolución.

Para revertir, ocultar primero las nuevas opciones y conservar la lectura de
los perfiles ya persistidos hasta retirar sus revisiones de circulación.
