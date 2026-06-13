/**
 * Punto de entrada del bundle Remotion para el render server-side.
 *
 * Lo consume `@remotion/bundler` desde `apps/api` (por ruta de archivo, con su
 * propio toolchain), NO el app de Next. Ningún módulo de la web importa este
 * archivo, así que `registerRoot` no corre en el navegador.
 */
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);