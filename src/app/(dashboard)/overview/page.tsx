import Link from "next/link";
import {
  BarChart3,
  CircleDollarSign,
  Gauge,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
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
        <div className="relative isolate grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.4fr_0.8fr]">
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
              encaisse, devises et concentration.
            </p>

            <div className="mt-7 grid gap-3 text-sm sm:grid-cols-3">
              <InfoPill label="Référence" value={referenceLabel} />
              <InfoPill label="Dernier import" value={importLabel} />
              <InfoPill label="Cours" value={quotesLabel} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-300">Valeur reconstruite</p>
                <p className="mt-2 text-4xl font-semibold">{formatCurrency(summary.totalValue)}</p>
              </div>
              <RefreshQuotesButton />
            </div>
            <div className="mt-6 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-slate-400">Encaisse connue</p>
                <p className="mt-1 text-xl font-semibold text-white">{formatCurrency(summary.cashValue)}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-xs text-slate-400">Titres reconstruits</p>
                <p className="mt-1 text-xl font-semibold text-white">{formatCurrency(summary.displayPositionsValue)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={CircleDollarSign}
          label="Valeur reconstruite"
          value={formatCurrency(summary.totalValue)}
          detail="Positions recalculées + encaisse connue"
        />
        <KpiCard
          icon={TrendingUp}
          label="Répartition CAD / USD"
          value={summary.currencyExposure
            .map((item) => `${item.currency} ${formatCurrency(item.value, item.currency)}`)
            .join(" · ")}
        />
        <KpiCard
          icon={BarChart3}
          label="Titres reconstruits"
          value={formatCurrency(summary.displayPositionsValue)}
          detail={[`${summary.positionCount} positions`, quoteCoverageLabel].join(" · ")}
        />
        <KpiCard
          icon={Gauge}
          label="Concentration max"
          value={formatPercent(summary.maxConcentration)}
          detail="Poids de la plus grande position reconstruite"
        />
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
          </div>
        </div>
      </section>

      <PortfolioCharts
        currencyExposure={summary.currencyExposure}
        topPositions={summary.topPositions}
      />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-slate-500">{label}</CardTitle>
          <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
            <Icon className="size-5" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
      </CardContent>
    </Card>
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
