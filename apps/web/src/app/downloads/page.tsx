import { redirect } from "next/navigation";

/** Keeps existing bookmarks valid after retiring the desktop render worker. */
export default function DownloadsPage() {
  redirect("/admin");
}
