import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyExposureKpiCard } from "@/features/portfolio/currency-exposure-kpi-card";
import { PortfolioCompositionKpiCard } from "@/features/portfolio/portfolio-composition-kpi-card";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { formatPostgresConnectionErrorDetail } from "@/lib/db/postgres-error-for-dev";
import { getPostgresDeployHint } from "@/lib/db/postgres-deploy-hint";
import { TopPositionsKpiCard } from "@/features/portfolio/top-positions-kpi-card";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let summary: Awaited<ReturnType<typeof getPortfolioSummary>>;
  try {
    summary = await getPortfolioSummary();
  } catch (e) {
    console.error("[overview] getPortfolioSummary", e);
    const hint = getPostgresDeployHint();
    const detail = formatPostgresConnectionErrorDetail(e);
    return (
      <EmptyState
        variant="error"
        title="Impossible de charger les données"
        description={
          [
            "La connexion PostgreSQL a échoué.",
            hint ??
              "Vérifie DATABASE_URL / DIRECT_URL et que PostgreSQL est joignable depuis cette machine.",
            detail ? `Détail : ${detail}` : null,
          ]
            .filter((s): s is string => Boolean(s))
            .join(" ")
        }
      />
    );
  }

  const hasPortfolioData =
    (summary.positionCount ?? 0) > 0 ||
    (summary.accountCount ?? 0) > 0 ||
    (summary.externalAccountsCount ?? 0) > 0;

  if (!hasPortfolioData) {
    return (
      <EmptyState
        variant="empty"
        title={
          summary.hasAnyImportsInHistory
            ? "Données incomplètes pour la vue d’ensemble"
            : "Aucun portefeuille importé"
        }
        description={
          summary.hasAnyImportsInHistory
            ? "Les comptes ou les opérations sont partiels : importe le CSV portefeuille Disnat pour les comptes et propriétaires, puis l’historique des transactions pour alimenter les titres affichés ici."
            : "Commence par importer le fichier CSV « Portefeuille » exporté depuis Disnat pour identifier tes comptes (CELI, REER, CRI…). Ensuite, importe les fichiers d’historique d’opérations pour chaque compte afin de remplir les positions."
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
  const disnatRecoLabel = summary.disnatReconciliationAsOf
    ? summary.disnatReconciliationAsOf.toLocaleDateString("fr-CA")
    : null;
  const compositionDetail = [
    `${summary.positionCount} lignes titres (projection opérations)`,
    quoteCoverageLabel,
    disnatRecoLabel
      ? `Encaisse = réf. réconciliation Disnat (état fichier au ${disnatRecoLabel})`
      : "Encaisse = réf. réconciliation (import portefeuille)",
    summary.externalAccountsCount > 0
      ? `${summary.externalAccountsCount} compte${summary.externalAccountsCount > 1 ? "s" : ""} externe${summary.externalAccountsCount > 1 ? "s" : ""} (valeurs saisies)`
      : null,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" · ");
  const disnatGapValue = summary.disnatLiveTotalValue - summary.disnatReferenceTotalValue;
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
          externalValueCad={summary.externalTotalCad}
          detail={compositionDetail}
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
            <span>
              Référence fichier : {formatCurrency(summary.disnatReferenceTotalValue)}
              {disnatRecoLabel ? ` · état comptes au ${disnatRecoLabel}` : null}
            </span>
            <span>Écart : {formatCurrency(disnatGapValue)}</span>
            <span className={driftIsHigh ? "font-medium text-amber-600" : "text-slate-500"}>
              {summary.driftVsDisnatPct === null ? "Écart non disponible" : formatPercent(summary.driftVsDisnatPct)}
            </span>
            {summary.usdToCadRate !== null && summary.usdToCadRateDate ? (
              <span className="text-slate-400">
                USD→CAD {summary.usdToCadRate.toFixed(4)} (Banque du Canada FXUSDCAD,{" "}
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
  variant,
  title,
  description,
}: {
  variant: "empty" | "error";
  title: string;
  description: string;
}) {
  return (
    <Card
      className={
        variant === "error"
          ? "border-rose-200 bg-rose-50/40"
          : undefined
      }
    >
      <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
        {variant === "empty" ? (
          <Link
            href="/imports"
            className="mt-5 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Importer un fichier
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
