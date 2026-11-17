import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Card, CardHeader, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { hasPermission } from "../../lib/auth";

const ACTIONS = ["view", "create", "edit", "kyc", "approve", "delete", "assign", "export"];

/** Read-only view of each role's permissions, straight from the database (defined in code, synced on every start). */
export default function Roles() {
  const { data, isPending, isError, error } = useQuery({ queryKey: ["roles"], queryFn: api.roles });
  const [selected, setSelected] = useState(null);
  if (isPending) return <Spinner label="Loading roles" />;
  if (isError) return <Alert>{error.message}</Alert>;

  const role = data.roles.find((r) => r.id === selected) ?? data.roles[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader title="Roles" description={`${data.roles.length} built-in roles`} />
        <ul className="p-2" role="listbox" aria-label="Roles">
          {data.roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={r.id === role.id}
                onClick={() => setSelected(r.id)}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${r.id === role.id ? "bg-brand-50 font-bold text-brand-800" : "font-semibold hover:bg-canvas"}`}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title={role.name} description={role.description} action={role.permissions.includes("*") ? <Badge tone="purple">Full access</Badge> : null} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Permissions for {role.name}</caption>
            <thead className="text-[11px] font-bold uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-3 text-left">Module</th>
                {ACTIONS.map((a) => <th key={a} scope="col" className="px-3 py-3 text-center">{a}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.modules.map((m) => (
                <tr key={m.id}>
                  <th scope="row" className="px-5 py-3 text-left font-semibold">{m.label}</th>
                  {ACTIONS.map((a) => {
                    if (!m.actions.includes(a)) return <td key={a} className="px-3 py-3" />;
                    const on = hasPermission(role.permissions, `${m.id}.${a}`);
                    return (
                      <td key={a} className="px-3 py-3 text-center">
                        {on ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Allowed" /> : <Minus className="mx-auto size-4 text-slate-300" aria-label="Not allowed" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Every permission is enforced by the server. Editing roles arrives with the Settings phase.
        </p>
      </Card>
    </div>
  );
}
