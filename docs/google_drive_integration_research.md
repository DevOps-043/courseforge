# Integración de Google Drive en Courseforge: Análisis y Diseño Técnico (Actualizado)

Este documento contiene la investigación y propuesta de diseño para implementar la integración de Google Drive con el sistema de creación de talleres/cursos de Courseforge, permitiendo la creación automática de una estructura organizada de carpetas para cada taller de forma completamente opcional.

---

## 1. Entendimiento del Objetivo

* **Objetivo:** Permitir que los constructores sincronicen su cuenta personal u organizacional de Google Drive para estructurar de manera automatizada las carpetas y archivos correspondientes a cada taller.
* **Propósito:** Evitar confusiones al subir recursos a CourseEngine desde fuentes externas a Courseforge (audios, diapositivas, guías, videos) organizando los entregables en un árbol estructurado de carpetas.
* **Opcionalidad:** El flujo de login de Google Drive es **opcional**. Si el usuario decide no vincular su cuenta, Courseforge continuará almacenando y organizando todo en su almacenamiento predeterminado (Supabase Storage).
* **Persistencia Obligatoria en la Base de Datos:** **Incluso si el usuario vincula su Google Drive, todos los archivos seleccionados o generados deben descargarse y registrarse obligatoriamente en la base de datos de Courseforge y en Supabase Storage.** Google Drive sirve como una interfaz organizada de trabajo para el usuario, pero la base de datos de Courseforge y su almacenamiento local siguen siendo la fuente de verdad técnica para la ejecución y reproducción del curso.
* **Compatibilidad con Background Jobs:** La persistencia segura de tokens permite que las tareas asíncronas en segundo plano (Netlify Background Functions) sincronicen archivos o guarden copias de los assets finales en la carpeta de Drive del usuario sin necesidad de que la sesión del navegador esté abierta.

---

## 2. Diagnóstico Técnico

### 2.1 Autenticación (OAuth 2.0 con Acceso Offline)
Para implementar esta característica de manera integrada y multiusuario, utilizaremos el flujo **OAuth 2.0 de Tres Partes (3-Legged OAuth)**.
* Durante la pantalla de consentimiento de Google, la aplicación debe solicitar `access_type=offline` y `prompt=consent`.
* Esto fuerza a Google a proveer un `refresh_token` (token de actualización) además del `access_token`. El `access_token` expira en 1 hora, pero el `refresh_token` nos permite renovarlo indefinidamente en tareas de background sin requerir la intervención interactiva del usuario.

### 2.2 Selección de Scopes (Resolución del Límite de Acceso)
Originalmente se propuso el scope `drive.file`, pero este presenta una limitación crítica:
* **El Problema con `drive.file`:** Si el usuario sube sus propios archivos (audios, videos grabados) directamente en Google Drive arrastrándolos a la carpeta creada por Courseforge, la API de Google restringe el acceso de lectura al contenido binario de esos archivos porque **no fueron creados por la aplicación** (a menos que se use el componente visual Google Picker para autorizar cada uno individualmente).
* **La Solución (Scopes Recomendados):**
  * Para permitir que el usuario suba libremente archivos a sus carpetas de Drive y Courseforge los pueda escanear y descargar de forma transparente, utilizaremos:
    * `https://www.googleapis.com/auth/drive.readonly` (Lectura de los archivos de Drive del usuario).
    * Si además deseamos escribir los videos finales generados en su Drive, usaremos el scope principal `https://www.googleapis.com/auth/drive` (Escritura y lectura).

### 2.3 Seguridad de Tokens en BD e Interfaz con el Auth Bridge
Almacenar credenciales externas en texto plano dentro de la base de datos representa un riesgo de seguridad elevado y es una mala práctica de ingeniería. Además, debemos tener en cuenta el funcionamiento de autenticación del sistema:

* **Arquitectura de Autenticación (Auth Bridge):** 
  Courseforge no posee un motor de inicio de sesión autónomo; en su lugar, delega la autenticación y validación de credenciales a la plataforma externa **SofLIA** mediante un puente de autenticación (`auth-bridge.ts`). Cuando un usuario inicia sesión, sus datos se sincronizan y guardan localmente en la tabla `public.profiles` con su respectivo `id` (UUID de SofLIA).
* **Integración del Modelo:**
  Dado que Courseforge maneja la sesión activa localmente mediante tokens JWT de Supabase que mapean directamente al ID sincronizado en `public.profiles`, la tabla `user_google_credentials` se conectará directamente a `public.profiles` mediante una llave foránea.
* **Separación de Responsabilidades:**
  Esto mantiene el flujo completamente desacoplado: la sesión se gestiona a través del Auth Bridge con SofLIA, mientras que las integraciones de terceros específicas de Courseforge (como Google Drive) persisten localmente en la base de datos de Courseforge vinculadas al ID del perfil sincronizado.
* **Cifrado de Datos en Reposo (Application-Level Encryption):**
  Los tokens (`access_token` y `refresh_token`) se cifrarán simétricamente utilizando el algoritmo **AES-256-GCM** en el servidor de backend (Next.js/Express) antes de insertarse en PostgreSQL. La clave secreta de cifrado (`GOOGLE_OAUTH_CRYPTO_SECRET`) residirá en las variables de entorno del servidor. De esta forma, si la base de datos es comprometida, los tokens son indescifrables.

---

## 3. Plan de Implementación

### Fase 1: Configuración en Google Cloud Console
1. Registrar un proyecto en la consola de Google.
2. Habilitar la **Google Drive API**.
3. Configurar la pantalla de consentimiento de OAuth 2.0 con los scopes necesarios (`drive.readonly` o `drive`, `email`, `profile`).
4. Generar un **Client ID** y un **Client Secret**, guardándolos en `.env.local` de Next.js.

### Fase 2: Base de Datos y Modelo
1. Crear una migración en Supabase con la tabla `user_google_credentials`.
2. Habilitar las políticas RLS correspondientes, utilizando el `auth.uid()` del Supabase Client (que ya se encuentra mapeado al ID del Auth Bridge).
3. Extender la metadata del artefacto (`artifacts.generation_metadata`) para almacenar la estructura de carpetas creada de Google Drive (`root_folder_id` y subcarpetas).

### Fase 3: Rutas de Backend y Cifrado
1. **Módulo de Cifrado (`/lib/server/crypto.ts`)**: Funciones para cifrar y descifrar textos con AES-256-GCM.
2. **`/api/auth/google/login`**: Genera y redirige al consentimiento de Google.
3. **`/api/auth/google/callback`**: Intercambia el código por tokens, cifra los tokens en el servidor, los guarda en la base de datos y redirige al dashboard.
4. **`/api/auth/google/disconnect`**: Borra el registro de tokens e invalida el consentimiento.

### Fase 4: Lógica del Servicio (`GoogleDriveService`)
1. Modificar [google-drive.service.ts](file:///d:/Pulse%20Hub/courseforge/apps/web/src/domains/production/providers/google-drive.service.ts) agregando métodos para descifrar y renovar tokens.
2. Crear un método para generar el árbol de carpetas por taller:
   * Carpeta raíz: `Courseforge - [Nombre del Taller]`
   * Subcarpeta: `01 - Syllabus`
   * Subcarpeta: `02 - Curacion`
   * Subcarpeta: `03 - Materiales (Audios y Slides)`
   * Subcarpeta: `04 - Produccion Final`

### Fase 5: Interfaz de Usuario y Flujo
1. **Configuración de Perfil**: Panel para conectar/desconectar Google Drive.
2. **Creación de Taller**: Selector opcional para habilitar la creación de carpetas de Drive.
3. **Detalle del Taller**: Enlace directo a la carpeta de Drive del taller correspondiente.

---

## 4. Implementación Propuesta

### 4.1 Base de Datos (SQL Migration)

```sql
-- migration: create_user_google_credentials.sql

CREATE TABLE public.user_google_credentials (
    user_id uuid NOT NULL,
    google_email text NOT NULL,
    access_token text NOT NULL, -- Almacenará el token cifrado
    refresh_token text NOT NULL, -- Almacenará el token cifrado
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_google_credentials_pkey PRIMARY KEY (user_id),
    -- La FK apunta a public.profiles, cuyos IDs provienen del Auth Bridge sincronizado con SofLIA
    CONSTRAINT user_google_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.user_google_credentials ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (Basadas en auth.uid() asignado por el Auth Bridge)
CREATE POLICY "Los usuarios solo pueden ver sus propias credenciales" 
    ON public.user_google_credentials
    FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios solo pueden modificar sus propias credenciales" 
    ON public.user_google_credentials
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "El backend (service_role) tiene acceso total"
    ON public.user_google_credentials
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
```

### 4.2 Utilidad de Cifrado en Servidor (`/lib/server/crypto.ts`)

```typescript
// apps/web/src/lib/server/crypto.ts
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX = process.env.GOOGLE_OAUTH_CRYPTO_SECRET; // Clave hexadecimal de 32 bytes

export function encrypt(text: string): string {
  if (!KEY_HEX) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET no está configurada en las variables de entorno");
  }

  const iv = crypto.randomBytes(12);
  const key = Buffer.from(KEY_HEX, "hex");
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  if (!KEY_HEX) {
    throw new Error("GOOGLE_OAUTH_CRYPTO_SECRET no está configurada en las variables de entorno");
  }

  const [ivHex, authTagHex, encryptedText] = encryptedData.split(":");
  if (!ivHex || !authTagHex || !encryptedText) {
    throw new Error("Formato de token cifrado inválido");
  }

  const key = Buffer.from(KEY_HEX, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
```

### 4.3 Lógica de Renovación Decriptada (`google-drive.service.ts`)

```typescript
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { encrypt, decrypt } from "@/lib/server/crypto";

export class GoogleDriveService {
  // ... métodos existentes ...

  /**
   * Asegura un access_token válido descifrando y renovando si es necesario
   */
  async refreshUserAccessToken(userId: string): Promise<string> {
    const admin = getServiceRoleClient();
    const { data: creds, error } = await admin
      .from("user_google_credentials")
      .select("refresh_token, expires_at, access_token")
      .eq("user_id", userId)
      .single();

    if (error || !creds) {
      throw new Error("No hay cuenta de Google vinculada para este usuario.");
    }

    const decryptedAccessToken = decrypt(creds.access_token);

    // Retorna el actual si aún es válido (más de 1 minuto de holgura)
    if (new Date(creds.expires_at).getTime() > Date.now() + 60000) {
      return decryptedAccessToken;
    }

    const decryptedRefreshToken = decrypt(creds.refresh_token);

    // Solicitar renovación del access_token
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: decryptedRefreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error("La renovación del token de Google falló. El usuario debe reconectar.");
    }

    const tokenData = await response.json();
    const nextExpires = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const encryptedNewAccess = encrypt(tokenData.access_token);

    await admin
      .from("user_google_credentials")
      .update({
        access_token: encryptedNewAccess,
        expires_at: nextExpires,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return tokenData.access_token;
  }

  // ... métodos de creación de directorios ...
}
```

---

## 5. Riesgos y Validaciones

### 5.1 Revocación del Token de Actualización
* **Riesgo:** Si el usuario desvincula el acceso de Courseforge desde la configuración de su cuenta de Google, las llamadas de background jobs fallarán de inmediato al expirar el access token.
* **Mitigación:** En cada ejecución asíncrona, capturar errores de autorización. Si la renovación falla, el job continuará su ejecución normal usando Supabase Storage como fallback y marcará el artefacto con una advertencia en la UI: `"Conexión con Google Drive interrumpida, reconéctate en configuraciones"`.

### 5.2 Control de Errores e Degradación Grácil (Graceful Degradation)
* **Riesgo:** Caídas temporales de la API de Google Drive podrían interrumpir la creación del taller en Courseforge.
* **Mitigación:** La llamada a Google Drive debe correr de forma asíncrona o capturando cualquier excepción mediante un bloque `try-catch` que no detenga la creación del taller en la base de datos principal de Supabase. El taller se crea y, en caso de fallo, se guarda un estado de error en los metadatos para permitir al usuario "Reintentar creación de carpeta de Drive" con un clic en la interfaz.

### 5.3 Seguridad y RLS
* **Validación:** Validar que un usuario B no pueda consultar bajo ningún motivo la tupla de `user_google_credentials` del usuario A mediante las políticas de Row Level Security a nivel de base de datos.

---

## 6. Mejoras Adicionales Recomendadas

1. **Google Picker en Materiales:**
   Implementar el componente del explorador de Google Drive (Google Picker) directamente en las vistas de curación y materiales. Esto permitirá al usuario seleccionar archivos directamente de su Drive y pasarlos al pipeline de producción sin descargar y cargar manualmente.
2. **Nombres de Carpetas Dinámicos basados en Módulos:**
   En lugar de subcarpetas estáticas (`01 - Syllabus`, etc.), una vez que se apruebe el syllabus en la Fase 2, se pueden crear carpetas en Google Drive tituladas bajo el formato `Módulo X - [Título del Módulo]`, facilitando que el usuario ubique con precisión dónde subir los archivos de cada lección de forma externa.
3. **Validación de Archivos automática (Push Notifications/Webhooks):**
   Utilizar webhooks de Google Drive para suscribirse a cambios en las carpetas. Si el usuario arrastra un archivo `.mp3` a la carpeta de audio de una lección, el sistema podría detectarlo y asociarlo automáticamente en la base de datos como el recurso de audio de esa sección.
