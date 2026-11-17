import { ChevronDown, ExternalLink, KeyRound, LogOut, Menu, Search, X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import ErrorBoundary from "../components/ErrorBoundary";
import Notifications from "../components/Notifications";
import QuickAdd from "../components/QuickAdd";
import TopbarSearch from "../components/TopbarSearch";
import { Avatar, Spinner } from "../components/ui";
import { useAuth } from "../lib/auth";
import { NAV } from "../lib/navigation";

// Same variable as lender logos (.env.example); empty = the site shares the CRM's origin.
const PUBLIC_SITE = import.meta.env.VITE_SITE_URL || (import.meta.env.DEV ? "http://localhost:5173" : "/");

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="AvodahLoans CRM home">
      <img src="/logo-light.png" alt="AvodahLoans" width="140" height="27" className="h-auto w-[140px]" />
      <span className="rounded-md bg-night-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-flame-500">CRM</span>
    </Link>
  );
}

function SidebarNav({ onNavigate }) {
  const { can } = useAuth();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
      {NAV.map(({ section, items }) => {
        const visible = items.filter((i) => !i.perm || can(i.perm));
        if (!visible.length) return null;
        return (
          <div key={section} className="mt-5 first:mt-2">
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-night-label">{section}</p>
            <ul className="space-y-1">
              {visible.map(({ to, label, icon: Icon, end, ready }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                        isActive ? "bg-white text-brand-800" : "text-night-text hover:bg-night-soft hover:text-white"
                      }`
                    }
                  >
                    <Icon className="size-[18px] shrink-0" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {!ready && <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Soon</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="border-t border-white/10 px-3 py-3">
      <a href={PUBLIC_SITE} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-night-text hover:bg-night-soft hover:text-white">
        <ExternalLink className="size-[18px]" aria-hidden /> View public website
      </a>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.name}`}
        className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-canvas"
      >
        <Avatar name={user.name} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-bold leading-tight text-ink">{user.name}</span>
          <span className="block text-xs text-muted">{user.role?.name}</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-bold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); navigate("/settings/security"); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-canvas">
            <KeyRound className="size-4 text-muted" aria-hidden /> Password & sessions
          </button>
          <button role="menuitem" type="button" onClick={logout} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setMenuOpen(false); setSearchOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const esc = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [menuOpen]);

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col bg-night lg:flex">
        <div className="px-5 pb-2 pt-6"><Logo /></div>
        <SidebarNav />
        <SidebarFooter />
      </aside>

      {/* Mobile / tablet menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-night/60" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-night" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <Logo />
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-lg p-1.5 text-white hover:bg-night-soft" aria-label="Close menu">
                <X className="size-6" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
            <SidebarFooter />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <button type="button" onClick={() => setMenuOpen(true)} className="-ml-1 rounded-lg p-2 text-ink hover:bg-canvas lg:hidden" aria-label="Open menu">
            <Menu className="size-6" />
          </button>
          <div className="hidden max-w-xl flex-1 md:block"><TopbarSearch /></div>
          <div className="flex-1" />
          <button type="button" onClick={() => setSearchOpen((o) => !o)} className="rounded-xl p-2 text-ink hover:bg-canvas md:hidden" aria-label="Search" aria-expanded={searchOpen}>
            <Search className="size-5" />
          </button>
          <QuickAdd />
          <Notifications />
          <UserMenu />
        </div>
        {searchOpen && (
          <div className="border-t border-line px-4 py-3 md:hidden">
            <TopbarSearch autoFocus onClose={() => setSearchOpen(false)} />
          </div>
        )}
      </header>

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:py-8">
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<Spinner label="Loading" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
