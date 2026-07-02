import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyExposureKpiCard } from "@/features/portfolio/currency-exposure-kpi-card";
import { PortfolioCompositionKpiCard } from "@/features/portfolio/portfolio-composition-kpi-card";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { formatPostgresConnectionErrorDetail } from "@/lib/db/postgres-error-for-dev";
import { getPostgresDeployHint } from "@/lib/db/postgres-deploy-hint";
import { PerformanceIndicatorCard } from "@/features/portfolio/performance-indicator-card";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { TopPositionsKpiCard } from "@/features/portfolio/top-positions-kpi-card";
import { MarketIndicesTicker } from "@/features/market/market-indices-ticker";
import { SessionTickerMiniReport } from "@/features/portfolio/session-ticker-mini-report";
import { buildSessionTickerMiniReportFromPayload } from "@/features/portfolio/session-ticker-report-queries";
import { formatCurrency, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DISPLAY_TIME_ZONE = "America/Toronto";

function formatDateInDisplayTimeZone(value: Date) {
  return value.toLocaleDateString("fr-CA", { timeZone: DISPLAY_TIME_ZONE });
}

function formatDateTimeInDisplayTimeZone(value: Date) {
  return value.toLocaleString("fr-CA", { timeZone: DISPLAY_TIME_ZONE });
}

export default async function OverviewPage() {
  let summary: Awaited<ReturnType<typeof getPortfolioSummary>>;
  let performancePayload: Awaited<
    ReturnType<typeof getPerformanceIndicatorPayload>
  > | null = null;
  try {
    [summary, performancePayload] = await Promise.all([
      getPortfolioSummary(),
      getPerformanceIndicatorPayload().catch(() => null),
    ]);
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
    (summary.externalAccountsCount ?? 0) > 0 ||
    (summary.nonFinancialAssetsCount ?? 0) > 0;

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

  const referenceLabel = summary.referenceAsOf
    ? formatDateInDisplayTimeZone(summary.referenceAsOf)
    : "Non définie";
  const importLabel = summary.importedAt
    ? formatDateInDisplayTimeZone(summary.importedAt)
    : "Aucun import";
  const quotesLabel = summary.quotesAsOf
    ? formatDateTimeInDisplayTimeZone(summary.quotesAsOf)
    : "Cours non actualisés";
  const quoteCoverageLabel =
    summary.quoteCoverage.total > 0
      ? `${summary.quoteCoverage.matched}/${summary.quoteCoverage.total} tickers couverts`
      : "Aucun cours disponible";
  const disnatRecoLabel = summary.disnatReconciliationAsOf
    ? formatDateInDisplayTimeZone(summary.disnatReconciliationAsOf)
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
    summary.nonFinancialAssetsCount > 0
      ? `${summary.nonFinancialAssetsCount} actif${summary.nonFinancialAssetsCount > 1 ? "s" : ""} non-boursier${summary.nonFinancialAssetsCount > 1 ? "s" : ""} (équité nette)`
      : null,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" · ");
  const disnatGapValue = summary.disnatLiveTotalValue - summary.disnatReferenceTotalValue;
  const driftIsHigh = summary.driftVsDisnatPct !== null && Math.abs(summary.driftVsDisnatPct) > 5;
  const hasFxRate = summary.usdToCadRate !== null && summary.usdToCadRateDate;
  const dataHealthTone = driftIsHigh || !hasFxRate ? "warning" : "ok";
  const dataHealthLabel = driftIsHigh
    ? "Ecart eleve"
    : hasFxRate
      ? "Donnees stables"
      : "Conversion manquante";

  const sessionTickerReport =
    performancePayload && performancePayload.accounts.length > 0
      ? await buildSessionTickerMiniReportFromPayload(performancePayload).catch(
          () => null,
        )
      : null;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-4xl border border-slate-200 bg-white text-slate-950 shadow-sm">
        <div className="relative isolate p-6 sm:p-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(5,150,105,0.06),transparent_30%)]" />
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-cyan-700">
              <HeaderPill label="Référence" value={referenceLabel} />
              <HeaderPill label="Dernier import" value={importLabel} />
              <HeaderPill label="Cours" value={quotesLabel} />
            </div>
            <h2 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Vue d&apos;ensemble du portefeuille
            </h2>
            <p className="max-w-3xl text-sm text-slate-600 sm:text-base">
              Lecture en 4 blocs: marche, performance, allocation et controle des donnees.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <RefreshQuotesButton />
              <StatusBadge tone={dataHealthTone} label={`Sante des donnees: ${dataHealthLabel}`} />
            </div>
          </div>
        </div>
      </section>

      <OverviewSection
        title="Allocation"
        description="Repartition du portefeuille et concentration des titres"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PortfolioCompositionKpiCard
            totalValue={summary.totalValue}
            positionsValue={summary.displayPositionsValue}
            cashValue={summary.cashValue}
            externalValueCad={summary.externalTotalCad}
            nonFinancialAssetsCad={summary.nonFinancialTotalCad}
            detail={compositionDetail}
          />
          <CurrencyExposureKpiCard currencyExposure={summary.currencyExposure} />
          <TopPositionsKpiCard topPositions={summary.topPositions} totalValue={summary.totalValue} />
        </div>
      </OverviewSection>

      <OverviewSection
        title="Marche"
        description="Contexte de seance et mouvement des titres suivis"
      >
        <div className="space-y-4">
          <MarketIndicesTicker />
          {sessionTickerReport ? (
            <SessionTickerMiniReport report={sessionTickerReport} />
          ) : (
            <Card className="border-dashed border-slate-300 bg-slate-50/60">
              <CardContent className="py-6 text-sm text-slate-500">
                Aucun mini-rapport de seance disponible pour le perimetre actuel.
              </CardContent>
            </Card>
          )}
        </div>
      </OverviewSection>

      <OverviewSection
        title="Performance"
        description="Rendement et variation par periode"
      >
        {performancePayload && performancePayload.accounts.length > 0 ? (
          <PerformanceIndicatorCard payload={performancePayload} />
        ) : (
          <Card className="border-dashed border-slate-300 bg-slate-50/60">
            <CardContent className="py-6 text-sm text-slate-500">
              Les indicateurs de performance ne sont pas encore disponibles.
            </CardContent>
          </Card>
        )}
      </OverviewSection>

      <OverviewSection
        title="Controle"
        description="Qualite des donnees et ecarts de reconciliation"
      >
        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              <ShieldCheck className="size-4 text-slate-400" />
              Validation Disnat
              <StatusBadge tone={driftIsHigh ? "warning" : "ok"} label={driftIsHigh ? "A verifier" : "Conforme"} />
            </div>
            <Link
              href="/reconciliation"
              className="text-xs font-medium text-cyan-700 underline decoration-cyan-200 underline-offset-4 hover:text-cyan-800"
            >
              Voir le detail de reconciliation
            </Link>
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <MetricChip
              label="Reference fichier"
              value={formatCurrency(summary.disnatReferenceTotalValue)}
              hint={disnatRecoLabel ? `etat comptes au ${disnatRecoLabel}` : undefined}
            />
            <MetricChip
              label="Ecart"
              value={formatCurrency(disnatGapValue)}
              tone={Math.abs(disnatGapValue) > 0 ? "warning" : "neutral"}
            />
            <MetricChip
              label="Ecart %"
              value={
                summary.driftVsDisnatPct === null
                  ? "Non disponible"
                  : formatPercent(summary.driftVsDisnatPct)
              }
              tone={driftIsHigh ? "warning" : "neutral"}
            />
            {hasFxRate ? (
              <MetricChip
                label="Taux USD/CAD"
                value={summary.usdToCadRate!.toFixed(4)}
                hint={`Banque du Canada (${formatDateInDisplayTimeZone(summary.usdToCadRateDate!)})`}
              />
            ) : (
              <MetricChip
                label="Taux USD/CAD"
                value="Indisponible"
                hint="Totaux melangent les devises sans conversion"
                tone="warning"
              />
            )}
          </div>
        </section>
      </OverviewSection>
    </div>
  );
}

function OverviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 sm:text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ tone, label }: { tone: "ok" | "warning"; label: string }) {
  const className =
    tone === "warning"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ring-1 ${className}`}>
      {label}
    </span>
  );
}

function MetricChip({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
          : "rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2"
      }
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function HeaderPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-50 px-3 py-1 ring-1 ring-cyan-100">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600">{label}</span>
      <span className="text-cyan-900">{value}</span>
    </span>
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
