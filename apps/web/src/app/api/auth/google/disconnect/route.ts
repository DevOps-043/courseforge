import { NextResponse } from "next/server";
import { disconnectCloudStorageAction } from "@/domains/production/actions/cloud-storage.actions";

export async function POST() {
  const result = await disconnectCloudStorageAction("google_drive");
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Error al desvincular Google Drive" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
