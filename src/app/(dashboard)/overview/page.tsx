import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyExposureKpiCard } from "@/features/portfolio/currency-exposure-kpi-card";
import { PortfolioCompositionKpiCard } from "@/features/portfolio/portfolio-composition-kpi-card";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { TopPositionsKpiCard } from "@/features/portfolio/top-positions-kpi-card";
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
            ? "Transactions importées - portefeuille en attente"
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

  const referenceLabel = summary.referenceAsOf?.toLocaleDateString("fr-CA") ?? "Non définie";
  const importLabel = summary.importedAt?.toLocaleDateString("fr-CA") ?? "Aucun import";
  const quotesLabel = summary.quotesAsOf?.toLocaleString("fr-CA") ?? "Cours non actualisés";
  const quoteCoverageLabel =
    summary.quoteCoverage.total > 0
      ? `${summary.quoteCoverage.matched}/${summary.quoteCoverage.total} tickers couverts`
      : "Aucun cours disponible";
  const disnatGapValue = summary.totalValue - summary.disnatReferenceTotalValue;
  const driftIsHigh = summary.driftVsDisnatPct !== null && Math.abs(summary.driftVsDisnatPct) > 5;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="relative isolate p-6 sm:p-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.28),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(16,185,129,0.18),transparent_30%)]" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-cyan-100">
              <span className="rounded-full bg-white/10 px-3 py-1">Tableau de bord</span>
              <span className="rounded-full bg-white/10 px-3 py-1">{quoteCoverageLabel}</span>
            </div>
            <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Vue d&apos;ensemble du portefeuille
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
              Suivi de la valeur reconstruite depuis les données importées : positions,
              encaisse, devises et principaux titres.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <div className="grid flex-1 gap-3 text-sm sm:grid-cols-3 min-w-[12rem]">
                <InfoPill label="Référence" value={referenceLabel} />
                <InfoPill label="Dernier import" value={importLabel} />
                <InfoPill label="Cours" value={quotesLabel} />
              </div>
              <RefreshQuotesButton />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PortfolioCompositionKpiCard
          totalValue={summary.totalValue}
          positionsValue={summary.displayPositionsValue}
          cashValue={summary.cashValue}
          detail={[
            `${summary.positionCount} positions`,
            quoteCoverageLabel,
            "Positions recalculées + encaisse connue",
          ].join(" · ")}
        />
        <CurrencyExposureKpiCard currencyExposure={summary.currencyExposure} />
        <TopPositionsKpiCard topPositions={summary.topPositions} totalValue={summary.totalValue} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <ShieldCheck className="size-4 text-slate-400" />
            Validation Disnat
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>Référence fichier : {formatCurrency(summary.disnatReferenceTotalValue)}</span>
            <span>Écart : {formatCurrency(disnatGapValue)}</span>
            <span className={driftIsHigh ? "font-medium text-amber-600" : "text-slate-500"}>
              {summary.driftVsDisnatPct === null ? "Écart non disponible" : formatPercent(summary.driftVsDisnatPct)}
            </span>
            {summary.usdToCadRate !== null && summary.usdToCadRateDate ? (
              <span className="text-slate-400">
                USD→CAD {summary.usdToCadRate.toFixed(4)} (Banque du Canada / Frankfurter,{" "}
                {summary.usdToCadRateDate.toLocaleDateString("fr-CA")})
              </span>
            ) : (
              <span className="text-amber-600">
                Taux USD→CAD indisponible : totaux mélangent les devises sans conversion.
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-medium text-white">{value}</p>
    </div>
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
