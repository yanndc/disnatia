import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshQuotesButton } from "@/features/portfolio/refresh-quotes-button";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { formatPostgresConnectionErrorDetail } from "@/lib/db/postgres-error-for-dev";
import { getPostgresDeployHint } from "@/lib/db/postgres-deploy-hint";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import type { PerformancePeriodResult } from "@/features/portfolio/performance-indicator-types";
import { MarketIndicesTicker } from "@/features/market/market-indices-ticker";
import { PortfolioNewsHighlights } from "@/features/news/portfolio-news-highlights";
import { DisnatDriftCard } from "@/features/portfolio/disnat-drift-card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { OverviewFilteredSections } from "./overview-filtered-sections";

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
      getPerformanceIndicatorPayload({
        refreshQuotes: false,
        persistSnapshots: false,
        // Politique unique : indicateurs marché-seulement (l'encaisse reconstruite par le
        // ledger n'est pas chargée) — identique au rapport EOD.
        includeCashLedger: false,
      }).catch((e) => {
        console.error("[overview] getPerformanceIndicatorPayload error", e);
        return null;
      }),
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
  const driftIsHigh = summary.driftVsDisnatPct !== null && Math.abs(summary.driftVsDisnatPct) > 5;
  const hasFxRate = summary.usdToCadRate !== null && summary.usdToCadRateDate;
  const dataHealthTone = driftIsHigh || !hasFxRate ? "warning" : "ok";
  const dataHealthLabel = driftIsHigh
    ? "Écart élevé"
    : hasFxRate
      ? "Données stables"
      : "Conversion manquante";

  /**
   * Séance en cours dans l'en-tête : même calcul que l'encadré « Séance » (live si la
   * séance est ouverte, sinon dernière séance persistée), sur tout le portefeuille.
   */
  const sessionResult =
    performancePayload && performancePayload.accounts.length > 0
      ? computePeriodResult(
          performancePayload,
          defaultPerformanceFilters(performancePayload),
          "day",
        )
      : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">Tableau de bord</p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-2 text-2xl font-semibold text-slate-950">
            Vue d&apos;ensemble
            {sessionResult ? <SessionGainPill result={sessionResult} /> : null}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Marché, performance et allocation du portefeuille consolidé.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Référence {referenceLabel} · dernier import {importLabel} · cours {quotesLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={dataHealthTone} label={`Santé des données : ${dataHealthLabel}`} />
          <RefreshQuotesButton />
        </div>
      </section>

      <MarketIndicesTicker />

      {performancePayload && performancePayload.accounts.length > 0 ? (
        <OverviewFilteredSections
          payload={performancePayload}
          baseNonFinancialAssetsCad={summary.nonFinancialTotalCad}
        />
      ) : (
        <Card className="border-dashed border-slate-300 bg-slate-50/60">
          <CardContent className="py-6 text-sm text-slate-500">
            Les indicateurs de performance ne sont pas encore disponibles.
          </CardContent>
        </Card>
      )}

      <DisnatDriftCard />
      <PortfolioNewsHighlights />
    </div>
  );
}

/**
 * Pastille « séance » de l'en-tête : gain $ et % de la séance en cours (ou de la dernière
 * séance si le marché est fermé), avec la couleur du signe.
 */
function SessionGainPill({ result }: { result: PerformancePeriodResult }) {
  const gain = result.gainCad;
  const pct = result.gainPct;
  const tone = gain === null ? "neutral" : gain > 0 ? "up" : gain < 0 ? "down" : "neutral";
  const className =
    tone === "up"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "down"
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : "bg-slate-100 text-slate-600 ring-slate-200";
  const gainLabel =
    gain === null ? "—" : `${gain > 0 ? "+" : ""}${formatCurrency(gain, "CAD")}`;
  const pctLabel =
    pct === null ? "" : ` (${pct > 0 ? "+" : ""}${formatPercent(pct)})`;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ${className}`}
      title={result.note ?? undefined}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
        {result.label}
      </span>
      <span className="font-semibold tabular-nums">
        {gainLabel}
        {pctLabel}
      </span>
    </span>
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
