import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "./api";

// Signed-in staff member for the whole app. The backend is the authority on every permission;
// `can()` here only decides what to show.
const AuthCtx = createContext(null);

export const hasPermission = (permissions = [], perm) => permissions.includes("*") || permissions.includes(perm);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(tokenStore.get() ? "loading" : "signedOut"); // loading | signedIn | signedOut
  const [notice, setNotice] = useState(null); // message for the login page, e.g. "Your session ended"
  // True after "Sign out": the next sign-in starts at the home page instead of returning to the last page.
  const [signedOutByUser, setSignedOutByUser] = useState(false);

  const clear = useCallback(
    (message = null, byUser = false) => {
      tokenStore.set(null);
      setUser(null);
      setStatus("signedOut");
      setNotice(message);
      setSignedOutByUser(byUser);
      queryClient.clear();
    },
    [queryClient]
  );

  // Restore the session on load.
  useEffect(() => {
    if (status !== "loading") return;
    api.me().then(
      ({ user }) => { setUser(user); setStatus("signedIn"); },
      (err) => clear(err.status === 401 ? "Your session has ended. Please sign in again." : null)
    );
  }, [status, clear]);

  // Any 401 from a signed-in request (idle timeout, revoked, suspended) signs this tab out.
  useEffect(() => {
    const onUnauthorized = () => clear("Your session has ended. Please sign in again.");
    // Signing out in another tab signs out here too.
    const onStorage = (e) => { if (e.key === tokenStore.key && !e.newValue) clear(null, true); };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener("storage", onStorage);
    };
  }, [clear]);

  const value = useMemo(
    () => ({
      user,
      status,
      notice,
      signedOutByUser,
      async login(email, password) {
        const { token, user } = await api.login(email, password);
        tokenStore.set(token);
        setNotice(null);
        setSignedOutByUser(false);
        setUser(user);
        setStatus("signedIn");
        return user;
      },
      async logout() {
        await api.logout().catch(() => {});
        clear(null, true);
      },
      refresh: () => api.me().then(({ user }) => setUser(user)),
      can: (perm) => hasPermission(user?.permissions, perm),
    }),
    [user, status, notice, signedOutByUser, clear]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
