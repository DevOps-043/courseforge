# Reparar autorización del worker de slides

El worker de Netlify utilizaba un helper ligado a la sesión HTTP de Next.js.
Un fallo antes de autorizar el componente no guardaba FAILED, dejando la cola
pendiente. Usar la reserva firmada, membresía vigente y coincidencia de job,
creador, organización, curso y componente sin cookies. Conservar firma, nonce,
claim atómico, QA y autorización de la ruta HTTP. No desplegar ni generar HeyGen.
