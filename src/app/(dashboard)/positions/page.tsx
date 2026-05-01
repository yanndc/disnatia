import { Card, CardContent } from "@/components/ui/card";
import { PositionsTable } from "@/features/portfolio/positions-table";
import { getAllPositions } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const positions = await getAllPositions().catch(() => []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Dernier import</p>
        <h2 className="text-2xl font-semibold text-slate-950">Positions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Table triable avec recherche globale et vue claire par compte/devise.
        </p>
      </section>
      <Card>
        <CardContent className="p-5">
          <PositionsTable positions={positions} />
        </CardContent>
      </Card>
    </div>
  );
}
