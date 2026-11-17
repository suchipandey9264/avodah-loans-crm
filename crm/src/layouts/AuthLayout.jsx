import { LockKeyhole } from "lucide-react";

/** Split screen for the signed-out pages: brand panel on wide screens, form on the right. */
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-night p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/logo-light.png" alt="AvodahLoans" width="170" height="33" className="h-auto w-[170px]" />
          <span className="rounded-md bg-night-soft px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-flame-500">CRM</span>
        </div>
        <div className="max-w-md">
          <p className="text-[32px] font-extrabold leading-tight tracking-tight">Every lead, file and disbursal in one place.</p>
          <p className="mt-4 text-night-text">The staff portal for AvodahLoans: track leads, move applications through lenders and keep the team on schedule.</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-night-label">
          <LockKeyhole className="size-4" aria-hidden /> Staff only. Every sign-in is recorded.
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/logo-dark.png" alt="AvodahLoans" width="150" height="29" className="h-auto w-[150px]" />
            <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold tracking-wider text-flame-600">CRM</span>
          </div>
          <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
