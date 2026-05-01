import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioCharts } from "@/features/portfolio/portfolio-charts";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const summary = await getPortfolioSummary().catch(() => null);

  if (!summary?.latestImportId) {
    return (
      <EmptyState
        title="Aucun portefeuille importé"
        description="Importe un CSV Disnat pour alimenter les KPI, graphiques et positions."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Dernier import</p>
        <h2 className="text-2xl font-semibold text-slate-950">
          Vue d&apos;ensemble du portefeuille
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Données importées le {summary.importedAt?.toLocaleString("fr-CA")}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Valeur totale" value={formatCurrency(summary.totalValue)} />
        <KpiCard label="Encaisse" value={formatCurrency(summary.cashValue)} />
        <KpiCard label="Positions" value={String(summary.positionCount)} />
        <KpiCard
          label="Concentration max"
          value={formatPercent(summary.maxConcentration)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <KpiCard
          label="Variation vs import précédent"
          value={
            summary.variationVsPrevious === null
              ? "Non disponible"
              : formatCurrency(summary.variationVsPrevious)
          }
          detail={
            summary.variationPctVsPrevious === null
              ? "Import initial"
              : formatPercent(summary.variationPctVsPrevious)
          }
        />
        <KpiCard
          label="Répartition CAD/USD"
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
          Importer un CSV
        </Link>
      </CardContent>
    </Card>
  );
}
