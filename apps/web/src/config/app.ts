/** Identidad pública versionada. Este módulo se incluye también en el cliente: nunca añadir secretos. */
interface AppBranding {
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly logo: { readonly src: string };
  readonly iconSrc: string;
  readonly supportEmail: string;
  readonly assistant: { readonly name: string; readonly displayName: string };
}

export const APP_CONFIG: AppBranding = Object.freeze({
  name: "SofLIA - Engine",
  shortName: "SofLIA",
  description: "Plataforma educativa con IA",
  logo: Object.freeze({ src: "/Logo.png" }),
  iconSrc: "/icon.png",
  supportEmail: "support@soflia.ai",
  assistant: Object.freeze({ name: "Lia", displayName: "SofLIA" }),
});
