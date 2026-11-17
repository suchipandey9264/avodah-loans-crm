
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import Forbidden from "../pages/Forbidden";
import { Spinner } from "./ui";

/** Signed-in staff only; everyone else goes to /login and comes back here afterwards. */
export function RequireAuth() {
  const { status, signedOutByUser } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="grid min-h-dvh place-items-center"><Spinner label="Checking your session" /></div>;
  if (status !== "signedIn") {
    // After an explicit sign-out, don't send the next person back to the previous user's page.
    return <Navigate to="/login" replace state={signedOutByUser ? undefined : { from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Signed-out only (login, forgot password) — a signed-in user is sent into the app. */
export function GuestOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;
  if (status === "signedIn") return <Navigate to={location.state?.from ?? "/"} replace />;
  return <Outlet />;
}

/** Hides a page from roles without `perm` (the API refuses them anyway). */
export function RequirePermission({ perm, children }) {
  const { can } = useAuth();
  return can(perm) ? (children ?? <Outlet />) : <Forbidden />;
}
