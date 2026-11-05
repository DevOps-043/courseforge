# Autoridad tenant verificable — TD-26

## Why
En el corte inicial el resolver y el acceso privilegiado admitían cookies de
navegación como autoridad. Los claims firmados tampoco prueban que una membresía
siga activa; se exige autoridad vigente y fallos cerrados en todos los consumidores.

## What Changes
- F1.1 caracterizó autoridad, revocación, compatibilidad y fixtures negativos.
- F1.2 implementó el resolver sin autoridad de cookies.
- F1.3 cierra fallbacks privilegiados y revisa consumidores por flujo; sigue en curso.
- F1.3.c.3.c.4 normaliza errores de autoridad en doce rutas/diecinueve métodos
  HeyGen, preservando permisos, contratos y compensación de jobs existentes.

## Impact
La ejecución incluye resolver, identidad, helpers de recursos y fronteras HTTP,
con caracterización y pruebas de cada lote. F1.3, permisos efectivos de escritura,
RLS/Storage y aceptación de ambiente siguen pendientes; no acredita cierre de
TD-26. Las ramas inseguras originales conservan su evidencia histórica. Sin SQL
remoto, lectura de secretos, generación pagada o despliegue.
