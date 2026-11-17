import { ShieldX } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui";
import { useAuth } from "../lib/auth";

export default function Forbidden() {
  const { user } = useAuth();
  return (
    <Card className="mx-auto max-w-lg px-6 py-12 text-center">
      <ShieldX className="mx-auto size-10 text-red-500" aria-hidden />
      <h1 className="mt-4 text-xl font-extrabold">You don’t have access to this page</h1>
      <p className="mt-2 text-sm text-muted">
        Your role, <strong className="text-ink">{user?.role?.name}</strong>, doesn’t include it. Ask an administrator if you need access.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">Go to the start page</Link>
    </Card>
  );
}
