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
            Montants dérivés des opérations importées ; prix marché ou projection selon la cotation.
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

      {positions.length === 0 &&
      summary?.hasAnyImportsInHistory &&
      summary.accountCount > 0 ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-medium">Comptes connus, mais aucune position projetée</p>
          <p className="mt-2 leading-relaxed">
            Cette grille affiche uniquement les titres issus de l’<strong>historique des transactions</strong>{" "}
            Disnat (import avec compte sélectionné). Le fichier « portefeuille » sert à créer les comptes et
            les totaux de référence, pas à remplir la liste des symboles.
          </p>
          <p className="mt-2 leading-relaxed text-sky-900">
            Va sur <strong>Imports</strong>, charge l’export d’activité / opérations pour chaque compte, puis
            vérifie que la projection s’exécute (ou relance une importation portefeuille si besoin pour
            déclencher la mise à jour).
          </p>
        </div>
      ) : null}

      {positions.length === 0 &&
      summary?.hasAnyImportsInHistory &&
      summary.accountCount === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Imports enregistrés sans état de compte exploitable. Importe d&apos;abord un CSV « portefeuille »
          Disnat pour créer les comptes, puis l&apos;historique des opérations pour afficher les positions.
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
