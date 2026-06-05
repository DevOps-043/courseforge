# Manual de Carga y Sincronización de Assets (Paso 6: Producción)

Este manual detalla el procedimiento técnico y operativo para cargar, generar e importar los activos multimedia individuales de cada lección en el Paso 6 del pipeline de Courseforge.

---

## 1. Audio de Voz (Voiceover / Locución)
* **Formato permitido**: `.mp3`, `.wav` (MIME: `audio/mpeg`, `audio/mp3`, `audio/wav`).
* **Método de carga**: Archivo local.
* **Cómo obtenerlo**:
  1. Copia el guion de narración (Speaker Notes) de la sección **Storyboard Reference** en la tarjeta.
  2. Genera el audio en plataformas de clonación de voz como **ElevenLabs** o **OpenAI Audio API** usando el perfil de locutor asignado a la organización.
  3. Descarga el audio resultante y haz clic en **"Subir MP3 de Voz"** en la sección de audio para cargarlo al bucket `production-assets/voices`.

---

## 2. Música de Fondo (Background Music)
* **Formato permitido**: `.mp3` (MIME: `audio/mpeg`, `audio/mp3`).
* **Método de carga**: Archivo local + Control de volumen.
* **Cómo obtenerlo**:
  1. Descarga pistas instrumentales de librerías de música libres de regalías (ej. Pixabay Music, YouTube Audio Library).
  2. Haz clic en **"Subir MP3 de Música"** para guardarlo en el bucket `production-assets/music`.
  3. Utiliza la barra deslizadora **"Volumen"** para regular la atenuación. El volumen por defecto es de **15%** (`0.15`) para evitar que sature la locución del orador.

---

## 3. Diapositivas (Open Design / Slides)
* **Formato permitido**: `.zip`, `.html` (MIME: `application/zip`, `text/html`).
* **Método de carga**: Exportación automatizada (API) o Archivo local.
* **Cómo obtenerlo**:
  * **Método Automatizado (Copiar y Exportar)**:
    1. Presiona **"Copiar y Exportar"**.
    2. El backend procesará automáticamente el storyboard del componente y generará un archivo HTML corporativo premium.
    3. Copiará el código HTML al portapapeles y abrirá el Editor Web de Open Design (`opendesign.dev/editor`) con el identificador del proyecto configurado para que puedas pegarlo y editarlo.
  * **Método Manual (Subir ZIP/HTML)**:
    1. Si exportas las slides a nivel local como un paquete zip de imágenes o HTML limpio, haz clic en **"Subir ZIP/HTML"** para guardarlo en `production-assets/slides`.

---

## 4. Clips de B-Roll (Clips de Video)
* **Formato permitido**: `.mp4`, `.mov`, `.webm` (MIME: `video/mp4`, `video/quicktime`, `video/webm`).
* **Método de carga**: Múltiples archivos locales ordenables.
* **Cómo obtenerlo**:
  1. Dirígete a la sección **AI B-ROLL PROMPTS** y haz clic en **"Generar Prompts con Gemini"**. El motor de IA analizará tu storyboard y generará las indicaciones de composición de cámara y acción física en inglés.
  2. Copia estos prompts y utilízalos en generadores de video avanzados (ej. **Runway Gen-2/Gen-3**, **Kling AI**, **Luma Dream Machine**).
  3. Descarga los clips cortos generados (de 4 a 10 segundos) y haz clic en **"Añadir Clip de Video (MP4)"** para cargarlos en `production-assets/broll`. La UI los ordenará secuencialmente según la escena correspondiente.

---

## 5. Avatar IA (Video Talking Head)
* **Formato permitido**: `.mp4` (MIME: `video/mp4`).
* **Método de carga**: Archivo local OR Sincronización nube-nube (Heygen ID).
* **Cómo obtenerlo**:
  * **Método 1: Importación Directa desde Heygen (Recomendado)**:
    1. Genera el avatar en tu cuenta de Heygen utilizando el guion definitivo de la lección.
    2. Una vez completado en Heygen, copia el **Video ID** (el identificador alfanumérico único).
    3. Pégalo en el campo **"ID de Video Heygen..."** y presiona **"Importar Heygen"**.
    4. La plataforma llamará a la API `/api/production/import-external` y transferirá el video en streaming directamente desde el CDN de Heygen hacia Supabase Storage. Verás una barra de progreso que indica el estado nube a nube.
  * **Método 2: Subida Manual de MP4**:
    1. Descarga el video del avatar sintetizado a tu computadora.
    2. Presiona **"O subir Video de Avatar (MP4)"** para cargarlo localmente.

---

## 6. Screencast (Grabación de pantalla de demostración)
* **Formato permitido**: URL de video directo o iframe.
* **Método de carga**: Enlace de texto.
* **Cómo obtenerlo**:
  1. Graba el flujo de demostración (ej. cómo usar una consola o código de IA) en herramientas como Loom, Vimeo, YouTube o Google Drive.
  2. Pega el enlace público o URL directa en el campo **"Screencast"** para que el compilador de Remotion o el reproductor del curso puedan integrarlo.

---

## 7. Video Final (Post-Producción)
* **Formato permitido**: `.mp4`, `.mov` (MIME: `video/mp4`, `video/quicktime`) o URL externa.
* **Método de carga**: Auto-ensamblado o Carga manual.
* **Cómo obtenerlo**:
  * **Auto-ensamblado (Fase 7 - Recomendado)**:
    - Una vez subidos todos los recursos anteriores (Voz, Música, Slides, Clips, Avatar), avanza al Paso 7 (Ensamble) y presiona **"Iniciar Ensamblado"**.
    - El motor compilará el video en Remotion y guardará automáticamente el video renderizado en este campo.
  * **Carga Manual**:
    - Si prefieres editar el video de forma externa en Adobe Premiere o CapCut, arrastra el video editado final en **"Subir"** o pega la URL en la sección **"VIDEO FINAL (Post-Producción)"**.

---

## 8. Opcionalidad y Sobreescritura (Audio de Voz vs. Avatar IA)

Para flexibilizar la producción y optimizar costes de IA:
1. **Locución Opcional**: Si ya has importado un **Avatar IA** (que cuenta con su propia voz/narración integrada), la carga del **Audio de Voz** independiente pasa a ser **opcional**. El sistema dará por completado el requisito de voz si detecta el avatar.
2. **Caso de Sobreescritura / Sincronización (Remotion)**:
   - Si se sube **únicamente el Avatar**: Remotion utilizará el canal de audio nativo del video del avatar como voz del curso.
   - Si se suben **Avatar + Audio de Voz (Mejorado)**: Durante el paso de postproducción (Fase 7), el motor de Remotion reemplazará/limpiará el audio nativo del avatar con el archivo de audio de voz subido, silenciando el audio del video original y sincronizando el movimiento labial (o utilizando la locución externa como pista maestra de alta calidad para la música de fondo).
