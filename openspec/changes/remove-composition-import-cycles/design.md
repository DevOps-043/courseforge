## Context
El grafo mezcla contratos y servicios. Los tipos inferidos desde esquemas vuelven a importar el documento que utiliza esos servicios durante la validación. El descriptor del render se infiere del supervisor y los adaptadores inferiores lo importan de vuelta. La autorización HTTP se declara en el adaptador que consume el controlador.

## Goals / Non-Goals
Retirar esos enlaces manteniendo la semántica existente y la compatibilidad de imports. No cambiar datos, captura, cálculo de efectos, proceso nativo ni decisiones de autorización.

## Decisions
Separar los esquemas de referencias de fuentes del lector del documento. Mover las funciones puras de planificación de captions a un módulo que recibe solo clips de captions ya discriminados; conservar los wrappers públicos del documento y clip. Extraer las funciones de fronteras Unicode sin alterar su cuerpo. Compartir un descriptor tipado de render basado en el contrato existente, separado del servicio. Compartir la autorización narrativa desde el módulo de política HTTP. Las fachadas conservan exports para consumidores actuales.

## Risks / Trade-offs
La extracción debe conservar orden, IDs, límites y errores. Se reutilizan las suites existentes para verificarlo; el análisis completo de ciclos conserva su configuración. No se declara comportamiento cloud por pruebas locales.

## Migration Plan
No requiere SQL ni configuración. Revertir el commit restaura los imports anteriores sin cambiar documentos. El esquema síncrono aplicado y su evidencia se conservan.
