import { useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, FileText, Plus, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import ApplicationForm from "../pages/applications/ApplicationForm";
import CustomerForm from "../pages/customers/CustomerForm";
import FollowupForm from "../pages/followups/FollowupForm";
import LeadForm from "../pages/leads/LeadForm";

const ITEMS = [
  ["lead", "New lead", UserPlus, "leads.create"],
  ["customer", "New customer", Users, "customers.create"],
  ["application", "New application", FileText, "applications.create"],
  ["followup", "Schedule follow-up", CalendarPlus, "followups.create"],
];

/** Top-bar "Quick add": opens the same forms the modules use, from any page. */
export default function QuickAdd() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [form, setForm] = useState(null);
  const ref = useRef(null);
  const items = ITEMS.filter(([, , , perm]) => can(perm));

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setMenu(false); };
    const esc = (e) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  if (!items.length) return null;
  const done = (to, state) => { setForm(null); queryClient.invalidateQueries(); navigate(to, state && { state }); };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-700 px-2.5 text-sm font-semibold text-white hover:bg-brand-800 sm:px-3">
        <Plus className="size-4" aria-hidden /><span className="hidden sm:inline">Quick add</span><span className="sr-only sm:hidden">Quick add</span>
      </button>
      {menu && (
        <ul role="menu" aria-label="Quick add" className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl">
          {items.map(([id, label, Icon]) => (
            <li key={id} role="none">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setForm(id); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-canvas">
                <Icon className="size-4 text-brand-700" aria-hidden />{label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {form === "lead" && <LeadForm open onClose={() => setForm(null)} onSaved={(lead) => done(`/leads?lead=${lead.id}`)} />}
      {form === "customer" && <CustomerForm onClose={() => setForm(null)} onSaved={({ customer }) => done(`/customers/${customer.id}`, { flash: `${customer.code} added.` })} />}
      {form === "application" && <ApplicationForm onClose={() => setForm(null)} onSaved={(d) => done(`/applications/${d.application.id}`, { flash: `${d.application.ref} created.` })} />}
      <FollowupForm open={form === "followup"} onClose={() => setForm(null)} onSaved={() => done("/follow-ups?view=all")} />
    </div>
  );
}
