import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioCharts } from "@/features/portfolio/portfolio-charts";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const summary = await getPortfolioSummary().catch(() => null);

  const hasPortfolioData =
    (summary?.positionCount ?? 0) > 0 || (summary?.accountCount ?? 0) > 0;

  if (!summary || !hasPortfolioData) {
    return (
      <EmptyState
        title={
          summary?.hasAnyImportsInHistory
            ? "Transactions importées — portefeuille en attente"
            : "Aucun portefeuille importé"
        }
        description={
          summary?.hasAnyImportsInHistory
            ? "Des transactions ont été importées mais le portefeuille n'est pas encore reconstitué. Importe d'abord le fichier CSV « Portefeuille » de Disnat pour identifier tes comptes, puis associe les fichiers Historique.xlsx à chaque compte."
            : "Commence par importer le fichier CSV « Portefeuille » exporté depuis Disnat. Il identifiera tes comptes (CELI, REER, CRI…). Tu pourras ensuite ajouter les fichiers d'historique de transactions."
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">Tableau de bord</p>
          <h2 className="text-2xl font-semibold text-slate-950">
            Vue d&apos;ensemble du portefeuille
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-medium text-slate-700">Référence :</span>{" "}
            {summary.referenceAsOf?.toLocaleDateString("fr-CA") ?? "—"}
            {summary.importedAt ? (
              <> · dernier import {summary.importedAt.toLocaleDateString("fr-CA")}</>
            ) : null}
            {summary.quotesAsOf ? (
              <> · cours {summary.quotesAsOf.toLocaleString("fr-CA")}</>
            ) : null}
          </p>
          {summary.transactionsGlobalCount > 0 ? (
            <p className="mt-1 text-xs text-slate-600">
              <span className="font-medium text-slate-700">Transactions historiques :</span>{" "}
              {summary.transactionsGlobalCount} lignes ·{" "}
              {summary.transactionsGlobalFrom?.toLocaleDateString("fr-CA")} au{" "}
              {summary.transactionsGlobalTo?.toLocaleDateString("fr-CA")}
            </p>
          ) : null}
          {summary.distinctAccountNumbers.length > 0 ? (
            <p className="mt-1 text-xs text-slate-600">
              <span className="font-medium text-slate-700">Comptes :</span>{" "}
              {summary.distinctAccountNumbers.join(", ")}
            </p>
          ) : null}
          {summary.driftVsDisnatPct !== null ? (
            <p className="mt-1 text-xs text-slate-500">
              Contrôle qualité : écart cours live vs Disnat :{" "}
              <span
                className={
                  Math.abs(summary.driftVsDisnatPct) > 5 ? "text-amber-600 font-medium" : ""
                }
              >
                {formatPercent(summary.driftVsDisnatPct)}
              </span>{" "}
              (valeur Disnat : {formatCurrency(summary.disnatReferenceTotalValue)})
            </p>
          ) : null}
        </div>
        <RefreshQuotesButton />
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Valeur totale combinée" value={formatCurrency(summary.totalValue)} />
        <KpiCard label="Encaisse combinée" value={formatCurrency(summary.cashValue)} />
        <KpiCard
          label="Titres (cours affichés)"
          value={formatCurrency(summary.displayPositionsValue)}
          detail={[
            `${summary.positionCount} positions · ${summary.accountCount} comptes`,
            summary.quoteCoverage.total > 0
              ? `${summary.quoteCoverage.matched}/${summary.quoteCoverage.total} tickers avec cours`
              : "Aucun cours — clique Actualiser les cours",
          ].join(" · ")}
        />
        <KpiCard
          label="Concentration max"
          value={formatPercent(summary.maxConcentration)}
        />
      </div>

      {summary.ownerBreakdown.length > 1 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-slate-600 uppercase tracking-wide">
            Par portefeuille
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {summary.ownerBreakdown.map((ob) => (
              <Card key={ob.owner}>
                <CardHeader>
                  <CardTitle className="text-slate-700 text-base">{ob.owner}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-2xl font-semibold text-slate-950">{formatCurrency(ob.totalValue)}</p>
                  <p className="text-sm text-slate-500">
                    Titres {formatCurrency(ob.marketValue)} · Encaisse {formatCurrency(ob.cashValue)}
                  </p>
                  <p className="text-xs text-slate-400">{ob.accountCount} compte{ob.accountCount > 1 ? "s" : ""}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <KpiCard
          label="Variation vs Disnat"
          value={
            summary.driftVsDisnatPct === null
              ? "—"
              : formatPercent(summary.driftVsDisnatPct)
          }
          detail="Écart entre cours live et valeur snapshot Disnat"
        />
        <KpiCard
          label="Répartition CAD / USD"
          value={summary.currencyExposure
            .map((item) => `${item.currency} ${formatCurrency(item.value, item.currency)}`)
            .join(" · ")}
        />
      </div>

      <PortfolioCharts
        currencyExposure={summary.currencyExposure}
        topPositions={summary.topPositions}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-slate-950">{value}</p>
        {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
        <Link
          href="/imports"
          className="mt-5 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Importer un fichier
        </Link>
      </CardContent>
    </Card>
  );
}
