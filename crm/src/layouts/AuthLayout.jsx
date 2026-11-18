import { LockKeyhole } from "lucide-react";
import { FLOW, STAGES } from "../lib/applications";

function Logo({ light }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={light ? "/logo-light.png" : "/logo-dark.png"} alt="AvodahLoans" width="170" height="33" className="h-auto w-[150px] lg:w-[170px]" />
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wider ${light ? "bg-night-soft text-flame-500" : "bg-brand-50 text-flame-600"}`}>CRM</span>
    </div>
  );
}

/** The journey every loan file takes in the CRM; the stages light up once, in order, when the page opens. */
function StageTrack() {
  return (
    <ol aria-label="Stages of a loan application" className="relative mt-10 space-y-1" style={{ "--n": FLOW.length }}>
      <span aria-hidden className="absolute left-[5px] top-4 bottom-4 w-0.5 rounded-full bg-night-soft" />
      <span aria-hidden className="track-fill absolute left-[5px] top-4 bottom-4 w-0.5 rounded-full bg-brand-300" />
      {FLOW.map((stage, i) => {
        const last = i === FLOW.length - 1;
        return (
          <li key={stage} className="track-stage relative flex items-center gap-4 py-2" style={{ "--i": i }}>
            <span aria-hidden className={`dot size-3 shrink-0 rounded-full ring-4 ring-night ${last ? "bg-flame-500" : "bg-brand-300"}`} />
            <span className={last ? "text-[17px] font-extrabold text-white" : "text-[15px] font-semibold text-night-text"}>{STAGES[stage][0]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Split screen for the signed-out pages: brand panel with the loan journey on wide screens, form on the right. */
export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-night px-12 py-11 text-white lg:flex">
        <Logo light />
        <div className="max-w-md">
          <p className="text-[38px] font-extrabold leading-[1.1] tracking-tight text-balance">Every lead, file and disbursal in one place.</p>
          <p className="mt-4 max-w-sm text-night-text">Track leads, move applications through lenders and keep the team on schedule.</p>
          <StageTrack />
        </div>
        <p className="flex items-center gap-2 text-sm text-night-label">
          <LockKeyhole className="size-4" aria-hidden /> Staff only. Every sign-in is recorded.
        </p>
      </aside>

      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-balance">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          <p className="mt-10 flex items-center gap-2 text-[13px] text-muted lg:hidden">
            <LockKeyhole className="size-4" aria-hidden /> Staff only. Every sign-in is recorded.
          </p>
        </div>
      </main>
    </div>
  );
}
