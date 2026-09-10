export interface GoogleOAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
}

export interface GoogleOAuthPopupError {
  message?: string;
  type?: string;
}

export interface GooglePicker {
  setVisible(visible: boolean): void;
}

export interface GooglePickerView {
  setMimeTypes(mimeTypes: string): void;
}

export interface GooglePickerBuilder {
  addView(view: GooglePickerView): GooglePickerBuilder;
  build(): GooglePicker;
  enableFeature(feature: string): GooglePickerBuilder;
  setAppId(appId: string): GooglePickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void | Promise<void>): GooglePickerBuilder;
  setDeveloperKey(developerKey: string): GooglePickerBuilder;
  setOAuthToken(accessToken: string): GooglePickerBuilder;
  setOrigin(origin: string): GooglePickerBuilder;
  setSize(width: number, height: number): GooglePickerBuilder;
}

export interface GooglePickerNamespace {
  Action: { CANCEL: string; PICKED: string };
  DocsView: new (viewId: string) => GooglePickerView;
  Document: { ID: string };
  Feature: { NAV_HIDDEN: string };
  PickerBuilder: new () => GooglePickerBuilder;
  Response: { ACTION: string; DOCUMENTS: string };
  ViewId: { DOCS: string };
}

export interface GoogleSdkWindow extends Window {
  gapi?: {
    load(modules: string, callback: () => void): void;
  };
  google?: {
    accounts: {
      oauth2: {
        initTokenClient(config: {
          callback(response: GoogleOAuthTokenResponse): void;
          client_id: string;
          error_callback(error: GoogleOAuthPopupError): void;
          scope: string;
        }): {
          requestAccessToken(options: { prompt: "" | "consent" }): void;
        };
      };
    };
    picker?: GooglePickerNamespace;
  };
}

export function getGoogleSdkWindow(browserWindow: Window): GoogleSdkWindow {
  return browserWindow as GoogleSdkWindow;
}

export function readGooglePickerFileId(
  data: Record<string, unknown>,
  picker: GooglePickerNamespace,
) {
  const documents = data[picker.Response.DOCUMENTS];
  if (!Array.isArray(documents) || documents.length === 0) return null;
  const document = documents[0];
  if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
  const fileId = (document as Record<string, unknown>)[picker.Document.ID];
  return typeof fileId === "string" && fileId ? fileId : null;
}
