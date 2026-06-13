"use server";

import { getCloudStorageConnectionsAction, disconnectCloudStorageAction } from "./cloud-storage.actions";

export async function checkGoogleConnectionAction() {
  const { connections } = await getCloudStorageConnectionsAction();
  const google = connections.find((connection) => connection.provider === "google_drive");

  return {
    connected: Boolean(google?.connected),
    email: google?.email || null,
  };
}

export async function disconnectGoogleAction() {
  return disconnectCloudStorageAction("google_drive");
}
