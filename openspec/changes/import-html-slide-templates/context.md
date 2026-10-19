# Contexto

- Objetivo y actor: ADMIN/SUPERADMIN importa diseños HTML y los revisa para reutilizar contenido educativo del agente dentro de su organización.
- Base y alcance: `staging` en `3b9e7be6`; rama `codex/import-html-slide-templates`. Plantillas de diapositivas, catálogo existente, productor HTML/editorial y generación.
- No objetivos: nuevo proveedor/modelo IA, migraciones, descarga de assets externos, render cloud, despliegue o publicación. El perfil inicial no admite gráficas dinámicas ni contenido dibujado solo por scripts.
- Dominios/contratos: `slides/import`, paquete `slide_template`, extensión opcional `importedDesign` de `course-deck-v1`, API admin de importación, UI de biblioteca/estudio.
- Permisos y efectos externos: identidad y tenant de servidor, solo administradores para importar. Guardado privado con persistencia existente; pruebas locales sin servicios ni modelos pagados. OpenSpec se validó con herramienta temporal fijada a la versión del lockfile.
- Criterios verificables: saneamiento, preview aislado, revisión de campos, binding sin truncado, compilación editorial, selección de plantilla real, reintentos sin duplicados y aislamiento de organizaciones.
- Riesgos e incertidumbres: falta un export real del proveedor y prueba de persistencia remota; caracteres no garantizan ajuste visual; compuertas globales tienen fallos ajenos documentados en reports/verification.md.
