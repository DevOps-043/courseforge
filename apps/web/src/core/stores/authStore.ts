"use client";

import { create } from "zustand";
import { logoutAction } from "@/app/login/actions";
import { createAuthStoreState, type AuthStore } from "@/features/auth/auth-store-state";
import { loadAuthSessionUser } from "@/features/auth/session.client";

/** Client context mirrors server-verified identity, never authorizes API writes. */
export const useAuthStore = create<AuthStore>(createAuthStoreState({
  loadUser: loadAuthSessionUser,
  signOut: logoutAction,
}));
