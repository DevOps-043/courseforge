# Contexto del refinamiento del plan por fases

- **Objetivo y actor:** permitir que ingeniería y un agente ejecuten correcciones
  en unidades verificables, conservando continuidad al cambiar de chat o compactar.
- **Base y alcance:** seguimiento de B2026-11-04 y del plan ya creado. El checkout
  contiene los cambios documentales de la auditoría anterior, conservados; no se
  consideran trabajo de producto de este refinamiento ni se sobrescriben sus logs.
- **No objetivos:** implementar fixes, abrir chats/worktrees, delegar agentes,
  instalar dependencias, obtener secretos, publicar o desplegar/aplicar SQL remoto.
- **Dominios/contratos:** planificación y seguimiento documental; los contratos
  runtime y formatos persistidos no cambian.
- **Permisos y efectos externos:** solo edición documental local; pruebas de
  documentación/arnés. Una plantilla de ejecución no concede autorización futura.
- **Criterios verificables:** todos los 12 IDs del corte aparecen en unidades;
  dependencias sin ciclos de planificación; cada unidad tiene entrada, frontera
  y salida; protocolo y plantilla permiten retomar desde Git/archivos; la línea
  base y estados no reciben crédito por escribir el plan.
- **Decisiones:** seis fases, 25 unidades iniciales ampliables con sufijos. Una
  unidad por chat como valor predeterminado, sin prometer tokens/turnos exactos.
  TD-26 avanza tras la base mínima; no espera la refactorización de UI o todo TD-06.
- **Riesgos e incertidumbres:** disponibilidad de entorno SQL/Edge/browser,
  autoridad real de membresías, divergencias del ambiente y tamaño de controladores
  pueden exigir subdivisiones. El esfuerzo permanece en findings.md; no se suman
  estimaciones nuevas por unidad ni se comprometen fechas.
- **Siguiente ejecución recomendada:** F0.1, una vez solicitada su ejecución;
  después F1.1–F1.3 para autorización. Correcciones aún no iniciadas.
