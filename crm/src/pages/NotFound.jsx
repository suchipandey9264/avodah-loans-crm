import { Link } from "react-router-dom";
import { Card } from "../components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-lg px-6 py-12 text-center">
      <p className="text-sm font-bold text-brand-600">404</p>
      <h1 className="mt-2 text-xl font-extrabold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The link may be old, or the page may have moved.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-brand-700 hover:underline">Go to the start page</Link>
    </Card>
  );
}
