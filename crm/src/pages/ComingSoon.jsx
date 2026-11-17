import { Hammer } from "lucide-react";
import { Card, PageHeader } from "../components/ui";

/** Placeholder for modules built in later phases. Shows no sample data. */
export default function ComingSoon({ title, description }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="px-6 py-14 text-center">
        <Hammer className="mx-auto size-8 text-brand-300" aria-hidden />
        <p className="mt-3 font-semibold">This module is being built</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">It arrives in a later phase of the CRM. Your access to it is already set by your role.</p>
      </Card>
    </>
  );
}
