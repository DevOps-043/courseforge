import type { StateCreator } from "zustand";
import type { AuthSessionUser } from "./session.contract";
import { AUTH_SESSION_LOAD_ERROR } from "./session.client";

export interface AuthStore {
  user: AuthSessionUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionError: string | null;
  initialize: () => Promise<void>;
  logout: () => Promise<void>;
}

export function createAuthStoreState(dependencies: {
  loadUser: () => Promise<AuthSessionUser | null>;
  signOut: () => Promise<void>;
}): StateCreator<AuthStore> {
  let pending: Promise<void> | null = null;
  let generation = 0;
  return (set) => ({
    user: null, isAuthenticated: false, isLoading: true, sessionError: null,
    initialize: () => {
      if (pending) return pending;
      const currentGeneration = ++generation;
      set({ user: null, isAuthenticated: false, isLoading: true, sessionError: null });
      const request = Promise.resolve().then(dependencies.loadUser).then(user => {
        if (generation !== currentGeneration) return;
        set({ user, isAuthenticated: Boolean(user), isLoading: false, sessionError: null });
      }).catch(() => {
        if (generation !== currentGeneration) return;
        set({ user: null, isAuthenticated: false, isLoading: false, sessionError: AUTH_SESSION_LOAD_ERROR });
      }).finally(() => {
        if (pending === request) pending = null;
      });
      pending = request;
      return request;
    },
    logout: async () => {
      ++generation;
      pending = null;
      set({ user: null, isAuthenticated: false, isLoading: false, sessionError: null });
      await dependencies.signOut();
    },
  });
}
