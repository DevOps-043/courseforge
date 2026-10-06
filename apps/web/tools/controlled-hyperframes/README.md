# Herramientas controladas de HyperFrames

Instalación local opt-in con SDK fijado; no es un worker productivo activado ni
un sandbox para documentos no confiables. Los drivers `observe-neutral-render`
y `controlled-sdk-*` siguen reservados al prototipo synthetic.

## Build operativo separado

Desde la raíz del repositorio:

```powershell
npm run build:composition-worker
npm run test:composition-worker-runtime
```

`apps/web/tsconfig.composition-worker.json` compila únicamente entradas operativas
y sus imports transitivos a `apps/web/dist/composition-worker`. No incluye tests
ni API routes; resolución Node16 conserva imports dinámicos ESM del SDK. El
colector materializado, el runner de conformidad y el gate final usan esa salida
fija, sin fallback a `.tmp/hyperframes-tests`. Si falta el build, el import falla;
no se autocompila ni se descarga una dependencia al ejecutar el colector.

La prueba del runtime carga módulos sin iniciar trabajo y revisa la salida
compilada. Los tests del colector usan archivos/crypto reales con bytes de fixture,
no vídeo real. No equivalen a QA audiovisual o verificación del sandbox.

Los tests `controlled-sdk-*` del prototipo conservan su build de pruebas anterior;
no son la ruta operativa del colector materializado.

## Instalación del operador todavía requerida

El build no incluye Node, Chromium, codecs, librerías compartidas, fuentes,
credenciales, manifiesto aprobado ni aislamiento de red/archivos/token. Deben
instalarse las dependencias bloqueadas del repositorio y de este directorio en
sus ubicaciones previstas; la salida no es un bundle autónomo ni una imagen.
Los archivos compilados y los módulos de herramientas que ejecute el host deben
formar parte de su inventario aprobado. No se genera ese baseline desde un job.

El puerto `measure` sigue siendo obligatorio y debe controlar sus propios
procesos: el Job del productor ya terminó al recopilar el candidato. Sigue
pendiente observar la sesión CDP original y completar las garantías físicas del
host. No activar flags, ejecutar los runners, desplegar o aplicar migraciones
como parte de este build.
