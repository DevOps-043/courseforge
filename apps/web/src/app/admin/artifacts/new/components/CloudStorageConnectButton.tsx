"use client";

import type { CloudStorageProvider } from "@/domains/production/cloud-storage/types";

interface CloudStorageConnectButtonProps {
  className?: string;
  children: React.ReactNode;
  provider: CloudStorageProvider;
}

const CONNECT_URLS: Record<CloudStorageProvider, string> = {
  google_drive: "/api/auth/google/login",
  onedrive: "/api/auth/microsoft/login",
};

export function CloudStorageConnectButton({
  children,
  className,
  provider,
}: CloudStorageConnectButtonProps) {
  const handleConnect = () => {
    const popup = window.open(
      CONNECT_URLS[provider],
      `courseforge-${provider}-oauth`,
      "width=720,height=760,menubar=no,toolbar=no,location=yes,status=no",
    );

    if (!popup) {
      window.location.href = CONNECT_URLS[provider];
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "courseforge:cloud-storage-oauth") return;

      window.removeEventListener("message", handleMessage);
      if (event.data?.status === "success") {
        window.location.reload();
      }
    };

    window.addEventListener("message", handleMessage);

    const intervalId = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(intervalId);
      window.removeEventListener("message", handleMessage);
      window.location.reload();
    }, 700);
  };

  return (
    <button type="button" onClick={handleConnect} className={className}>
      {children}
    </button>
  );
}
