import { Card, CardContent } from "@/components/ui/card";
import { PositionsTable } from "@/features/portfolio/positions-table";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getAllPositions, getPortfolioSummary } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const [positions, summary] = await Promise.all([
    getAllPositions().catch(() => []),
    getPortfolioSummary().catch(() => null),
  ]);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Positions</p>
          <h2 className="text-2xl font-semibold text-slate-950">Détail</h2>
          <p className="mt-1 text-sm text-slate-500">
            État courant synthétisé à partir de tous les imports. Prix affichés = cours live (Yahoo)
            si disponible, sinon snapshot Disnat.
          </p>
          {summary && summary.positionCount > 0 ? (
            <p className="mt-1 text-xs text-slate-600">
              {summary.positionCount} positions · {summary.accountCount} comptes ·{" "}
              {summary.quoteCoverage.matched}/{summary.quoteCoverage.total} avec cours live
            </p>
          ) : null}
        </div>
        <RefreshQuotesButton />
      </section>

      {positions.length === 0 && summary?.hasAnyImportsInHistory ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Les imports enregistrés ne contiennent pas de lignes positions ni comptes. Importe un
          export positions ou relevé de compte Disnat pour remplir cette page.
        </div>
      ) : null}

      {positions.length === 0 && !summary?.hasAnyImportsInHistory ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Aucun import. Commence par importer un fichier CSV ou Excel Disnat.
        </div>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <PositionsTable positions={positions} />
        </CardContent>
      </Card>
    </div>
  );
}
