"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { completeAuthBridgeLogin } from "./auth-bridge";

export async function loginAction(_prevState: any, formData: FormData) {
  const identifier = formData.get("identifier") as string;
  const password = formData.get("password") as string;
  const rememberMe = formData.get("rememberMe") === "true";

  return completeAuthBridgeLogin(identifier, password, rememberMe);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  try {
    cookieStore.set({ name: "cf_active_org", value: "", maxAge: 0, path: "/" });
    cookieStore.set({ name: "cf_user_orgs", value: "", maxAge: 0, path: "/" });
    cookieStore.set({
      name: "cf_access_token",
      value: "",
      maxAge: 0,
      path: "/",
    });
    cookieStore.set({
      name: "cf_remember_me",
      value: "",
      maxAge: 0,
      path: "/",
    });
  } catch (error) {
    console.error("Error clearing cookies:", error);
  }

  redirect("/login");
}
