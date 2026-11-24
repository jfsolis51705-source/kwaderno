import { Construction } from "lucide-react";
import { EmptyState } from "./states";
import { PageHeader } from "./page-header";

/** Honest placeholder for modules scheduled in later build stages. No fake data. */
export function ComingSoon({ title, stage, description }: { title: string; stage: number; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={`Coming in build stage ${stage}`} description={description} />
    </>
  );
}
