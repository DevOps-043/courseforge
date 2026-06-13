# Guía para Obtener Credenciales de Google Drive (OAuth 2.0)

Esta guía te ayudará a configurar un proyecto en **Google Cloud Console** para obtener las credenciales necesarias para la integración de Google Drive en Courseforge.

---

## Paso 1: Crear un Proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/).
2. Inicia sesión con tu cuenta de Google.
3. Haz clic en el selector de proyectos en la barra superior y selecciona **Nuevo Proyecto** (New Project).
4. Dale un nombre identificable (ej. `Courseforge-Drive`) y haz clic en **Crear**.

---

## Paso 2: Habilitar la API de Google Drive

1. En el menú de navegación de la izquierda, ve a **APIs y Servicios** > **Biblioteca** (Library).
2. Busca `"Google Drive API"`.
3. Haz clic en ella y presiona el botón **Habilitar** (Enable).

---

## Paso 3: Configurar la Pantalla de Consentimiento de OAuth

Antes de generar las claves, Google requiere configurar cómo se verá la pantalla de consentimiento para los usuarios:

1. Ve a **APIs y Servicios** > **Pantalla de consentimiento de OAuth** (OAuth consent screen).
2. Selecciona el tipo de usuario **Externo** (External) y haz clic en **Crear**.
3. Rellena la información de la aplicación:
   * **Nombre de la aplicación:** `Courseforge`
   * **Correo de soporte del usuario:** Tu correo electrónico.
   * **Logotipo de la aplicación:** (Opcional)
   * **Datos de contacto del desarrollador:** Tu correo electrónico.
4. Haz clic en **Guardar y Continuar**.
5. En la sección de **Permisos** (Scopes), haz clic en **Agregar o quitar permisos** y busca o añade manualmente el siguiente scope:
   * `https://www.googleapis.com/auth/drive.readonly` (para leer tus archivos de Drive).
   * *(Opcional)* Si también deseas escribir archivos finales generados en su Drive, añade: `https://www.googleapis.com/auth/drive`.
6. Haz clic en **Guardar y Continuar**.
7. En **Usuarios de prueba** (Test users), agrega tu correo de Google (y el de otros desarrolladores que vayan a probar la integración en esta fase de desarrollo).
8. Haz clic en **Guardar y Continuar** y luego en **Volver al panel**.

---

## Paso 4: Crear Credenciales de Cliente OAuth 2.0

1. Ve a **APIs y Servicios** > **Credenciales** (Credentials).
2. Haz clic en **+ Crear Credenciales** en la parte superior y selecciona **ID de cliente de OAuth** (OAuth client ID).
3. Selecciona **Aplicación web** (Web application) como el tipo de aplicación.
4. Configura los siguientes campos:
   * **Nombre:** `Courseforge Web`
   * **Orígenes autorizados de JavaScript (Authorized JavaScript origins):**
     * `http://localhost:3000` (Para desarrollo local).
     * `https://tu-dominio.netlify.app` (Para producción).
   * **URIs de redireccionamiento autorizados (Authorized redirect URIs):**
     * `http://localhost:3000/api/auth/google/callback`
     * `https://tu-dominio.netlify.app/api/auth/google/callback`
5. Haz clic en **Crear**.
6. Te aparecerá una ventana flotante con:
   * **Tu ID de cliente (Client ID)**
   * **Tu secreto de cliente (Client Secret)**
7. Cópialos y pégalos en tu archivo `apps/web/.env.local` de la siguiente forma:

```env
GOOGLE_CLIENT_ID=TU_CLIENT_ID_AQUÍ.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=TU_CLIENT_SECRET_AQUÍ
```

---

## Resumen de Variables Faltantes en `.env.local`

Para que todo funcione, tu sección de Google Drive debe verse así:

```env
# GOOGLE DRIVE Integration
NEXT_PUBLIC_GOOGLE_CLIENT_ID=973141986001-gle8h19mt8gf3g37uakp3rmbpd6b1emi.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY=AIzaSyBSYFgs1lUzUcBvi6vHlkZFrcv8sgRyqfo
NEXT_PUBLIC_GOOGLE_APP_ID=973141986001

# OAuth backend keys (servidor)
GOOGLE_CLIENT_ID=973141986001-gle8h19mt8gf3g37uakp3rmbpd6b1emi.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=TU_CLIENT_SECRET_DE_GOOGLE_CLOUD
GOOGLE_OAUTH_CRYPTO_SECRET=CLAVE_HEXADECIMAL_DE_64_CARACTERES_GENERADA_PARA_AES
```
