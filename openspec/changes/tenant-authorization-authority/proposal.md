# Autoridad tenant verificable — TD-26

## Why
El resolver y el acceso privilegiado admiten cookies de navegación como autoridad.
Los claims firmados tampoco prueban que una membresía siga activa.

## What Changes
- F1.1 define autoridad, revocación, compatibilidad y fixtures negativos.
- F1.2 implementará el resolver sin autoridad de cookies.
- F1.3 cerrará fallbacks privilegiados y revisará consumidores por flujo.

## Impact
F1.1 añade especificación y caracterización local; no modifica runtime ni SQL.
No acredita corrección de TD-26. Los escenarios de aceptación deben fallar sobre
las ramas inseguras actuales. Sin consultas remotas, secretos o despliegue.
