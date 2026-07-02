import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { listExternalAccountsWithLatest } from "@/features/portfolio/external-accounts-queries";
import { listNonFinancialAssetsWithLatest } from "@/features/portfolio/non-financial-assets-queries";
import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { getAccountsWithStats, getAllPositions } from "@/features/portfolio/queries";
import { getLatestUsdCadRate } from "@/lib/fx/latest-usd-cad-rate";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import { EXTERNAL_ACCOUNT_PROVIDERS } from "@/lib/portfolio/external-account-providers";
import { resolveNonFinancialAssetOwnerShares } from "@/lib/portfolio/non-financial-asset-owner-shares";
import { sanitizePortfolioOwner, portfolioOwnerKey } from "@/lib/portfolio/sanitize-portfolio-owner";
import { formatCurrency, normalizeCurrency } from "@/lib/utils";
import {
  accountDayTitresPnL,
  accountDriftTitresCad,
  aggregateByCurrency,
  aggregateDayTitresForSubset,
  consolidatedDayTitresCadState,
  ownerConsolidatedCad,
  scaleUsdTitresDayStateToCad,
  sum,
  type AccountDayTitresPnLState,
} from "./comptes-accounts-logic";
import { ComptesPageClient } from "./comptes-page-client";
import type { AccountWithStats } from "./comptes-types";

export const dynamic = "force-dynamic";

function ownerSectionTitle(acc: AccountWithStats): string {
  const named = sanitizePortfolioOwner(acc.owner);
  if (named) return named;
  return `Propriétaire inconnu (${normalizeCurrency(acc.currency)})`;
}

function toCadEquivalent(value: number, currency: string, usdToCad: number): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD" || cur === "US") return value * usdToCad;
  return value;
}

export default async function ComptesPage() {
  const [accounts, externalAccounts, nonFinancialAssets, positions] = await Promise.all([
    getAccountsWithStats().catch(() => []),
    listExternalAccountsWithLatest().catch(() => []),
    listNonFinancialAssetsWithLatest().catch(() => []),
    getAllPositions().catch(() => []),
  ]);

  const nonFinancialWithValue = nonFinancialAssets.filter(
    (a) => a.isActive && a.latestSnapshot,
  );

  if (accounts.length === 0 && externalAccounts.length === 0 && nonFinancialWithValue.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-80 flex-col items-center justify-center text-center">
          <h2 className="text-xl font-semibold text-slate-950">Aucun compte connu</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            Importez d&apos;abord le fichier CSV Portefeuille depuis Disnat pour identifier vos
            comptes (CELI, REER, CRI…), ou ajoutez un{" "}
            <Link href="/imports" className="underline-offset-2 hover:underline">
              compte externe
            </Link>{" "}
            ou un actif non-boursier (maison, etc.) avec des snapshots manuels.
          </p>
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

  const externalAccountsSection =
    externalAccounts.length > 0 ? (
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-950">Comptes hors Disnat</h3>
            <p className="mt-1 text-sm text-slate-500">
              Snapshots sur la page{" "}
              <Link href="/imports" className="text-violet-700 underline-offset-2 hover:underline">
                Imports
              </Link>
              .
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Libellé</th>
                  <th className="px-4 py-2">Propriétaire</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2">Devise</th>
                  <th className="px-4 py-2 text-right">Solde</th>
                  <th className="px-4 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {externalAccounts.map((ex) => (
                  <tr key={ex.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{ex.displayLabel}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {ex.owner?.trim()
                        ? (sanitizePortfolioOwner(ex.owner) ?? ex.owner.trim())
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {EXTERNAL_ACCOUNT_PROVIDERS.find((p) => p.id === ex.provider)?.label ??
                        ex.provider}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {ex.currency}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {ex.latestSnapshot
                        ? formatCurrency(ex.latestSnapshot.totalValue, ex.currency)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {ex.latestSnapshot
                        ? ex.latestSnapshot.asOfDate.toLocaleDateString("fr-CA")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Pas de sync automatique avec l&apos;assureur.
          </p>
        </CardContent>
      </Card>
    ) : null;

  const nonFinancialAssetsSection =
    nonFinancialWithValue.length > 0 ? (
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-base font-semibold text-slate-950">Actifs non-boursiers</h3>
            <p className="mt-1 text-sm text-slate-500">
              Snapshots sur la page{" "}
              <Link href="/imports" className="text-amber-700 underline-offset-2 hover:underline">
                Imports
              </Link>
              .
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Libellé</th>
                  <th className="px-4 py-2">Propriétaire</th>
                  <th className="px-4 py-2">Devise</th>
                  <th className="px-4 py-2 text-right">Valeur</th>
                  <th className="px-4 py-2 text-right">Hypothèque</th>
                  <th className="px-4 py-2 text-right">Équité nette</th>
                  <th className="px-4 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nonFinancialWithValue.map((asset) => (
                  <tr key={asset.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{asset.displayLabel}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {(() => {
                        const shares = resolveNonFinancialAssetOwnerShares(asset.owner, asset.metadata);
                        if (shares.length === 0) return "—";
                        return shares
                          .map((s) => `${s.owner} (${s.sharePct.toFixed(0)}%)`)
                          .join(" · ");
                      })()}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {asset.currency}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(asset.latestSnapshot!.marketValue, asset.currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(asset.latestSnapshot!.mortgageBalance, asset.currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {formatCurrency(asset.latestSnapshot!.netEquity, asset.currency)}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">
                      {asset.latestSnapshot
                        ? asset.latestSnapshot.asOfDate.toLocaleDateString("fr-CA")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Ces montants servent au patrimoine net, pas au rendement portefeuille.
          </p>
        </CardContent>
      </Card>
    ) : null;

  if (accounts.length === 0) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex min-h-40 flex-col items-center justify-center py-8 text-center">
            <h2 className="text-lg font-semibold text-slate-950">Comptes Disnat</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">
              Importe le CSV portefeuille Disnat pour afficher les soldes par compte.
            </p>
            <Link
              href="/imports"
              className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Vers les imports
            </Link>
          </CardContent>
        </Card>
        {externalAccountsSection}
        {nonFinancialAssetsSection}
      </div>
    );
  }

  await refreshUsdCadRatesIfStale().catch(() => {});
  const fx = await getLatestUsdCadRate();
  const usdToCad = fx?.usdToCad ?? null;

  const byOwner = new Map<string, { title: string; accounts: AccountWithStats[] }>();
  for (const acc of accounts) {
    const title = ownerSectionTitle(acc);
    const key = portfolioOwnerKey(acc.owner) ?? title.toLocaleLowerCase("fr-CA");
    const bucket = byOwner.get(key) ?? { title, accounts: [] };
    if (!byOwner.has(key)) byOwner.set(key, bucket);
    bucket.accounts.push(acc);
  }

  const ownerSectionsSorted = [...byOwner.values()]
    .map((entry) => [entry.title, entry.accounts] as const)
    .toSorted(([a], [b]) => a.localeCompare(b, "fr-CA"));

  const cadAccounts = accounts.filter((a) => normalizeCurrency(a.currency) === "CAD");
  const usdAccounts = accounts.filter((a) => normalizeCurrency(a.currency) === "USD");

  const cadEncaisse = sum(cadAccounts.map((a) => a.cashValue));
  const cadTitres = sum(cadAccounts.map((a) => a.marketValue));
  const cadTotal = sum(cadAccounts.map((a) => a.displayTotalValue));

  const usdEncaisseUsd = sum(usdAccounts.map((a) => a.cashValue));
  const usdTitresUsd = sum(usdAccounts.map((a) => a.marketValue));
  const usdTotalUsd = sum(usdAccounts.map((a) => a.displayTotalValue));

  const usdEncaisseCad = usdToCad != null ? usdEncaisseUsd * usdToCad : null;
  const usdTitresCad = usdToCad != null ? usdTitresUsd * usdToCad : null;
  const usdTotalCad = usdToCad != null ? usdTotalUsd * usdToCad : null;

  const cadAgg = aggregateByCurrency(accounts, "CAD");
  const usdAgg = aggregateByCurrency(accounts, "USD");
  const consolidated = ownerConsolidatedCad(accounts, usdToCad);
  const consEncaisse = consolidated.encaisse;
  const consTitres = consolidated.titresFichier;
  const consTitresLocal = consolidated.titresRecon;
  const consTotal = consolidated.total;
  const cadTitresLocal = cadAgg.reconstructedMarketValue;
  const usdTitresLocalUsd = usdAgg.reconstructedMarketValue;

  const positionsByAccountKey = new Map<string, EnrichedPosition[]>();
  for (const p of positions) {
    const k = p.accountKey?.trim();
    if (!k) continue;
    const list = positionsByAccountKey.get(k);
    if (list) list.push(p);
    else positionsByAccountKey.set(k, [p]);
  }

  const dayTitresByAccountKey = new Map<string, AccountDayTitresPnLState>();
  for (const acc of accounts) {
    const rows = positionsByAccountKey.get(acc.accountKey) ?? [];
    const sameCur = rows.filter(
      (p) => normalizeCurrency(p.currency) === normalizeCurrency(acc.currency),
    );
    dayTitresByAccountKey.set(acc.accountKey, accountDayTitresPnL(sameCur));
  }

  const totalsBlocCadTitresDay = aggregateDayTitresForSubset(
    cadAccounts,
    dayTitresByAccountKey,
  );
  const totalsBlocUsdTitresDay = aggregateDayTitresForSubset(
    usdAccounts,
    dayTitresByAccountKey,
  );
  const totalsBlocPortfolioTitresDayCad =
    usdToCad != null && Number.isFinite(usdToCad)
      ? consolidatedDayTitresCadState(cadAccounts, usdAccounts, dayTitresByAccountKey, usdToCad)
      : (() => {
          const cadOnly = aggregateDayTitresForSubset(cadAccounts, dayTitresByAccountKey);
          const usdBloc = aggregateDayTitresForSubset(usdAccounts, dayTitresByAccountKey);
          return {
            ...cadOnly,
            incomplete: cadOnly.incomplete || usdBloc.hasTitresProjetes,
          };
        })();

  const totalsBlocUsdTitresDayCadEquiv = scaleUsdTitresDayStateToCad(
    totalsBlocUsdTitresDay,
    usdToCad,
  );

  const driftParts = accounts
    .map((a) => ({
      acc: a,
      driftCad: accountDriftTitresCad(a, usdToCad),
    }))
    .filter((row): row is { acc: AccountWithStats; driftCad: number } => row.driftCad !== null);
  const driftNetCad = driftParts.length > 0 ? sum(driftParts.map((p) => p.driftCad)) : null;
  const driftSumAbs =
    driftParts.length > 0 ? sum(driftParts.map((p) => Math.abs(p.driftCad))) : null;
  const driftSorted = driftParts.toSorted(
    (a, b) => Math.abs(b.driftCad) - Math.abs(a.driftCad),
  );
  const driftTop = driftSorted[0];
  const driftTopShareAbs =
    driftTop && driftSumAbs != null && driftSumAbs > 0
      ? (Math.abs(driftTop.driftCad) / driftSumAbs) * 100
      : null;
  const singleDominant =
    driftTopShareAbs != null && driftTopShareAbs >= 85 && driftTop != null;

  const canShowDriftBanner = driftNetCad !== null && usdToCad !== null;

  const dayTitresRecord = Object.fromEntries(dayTitresByAccountKey.entries());

  const extWithSnap = externalAccounts.filter((e) => e.latestSnapshot);
  const externalRecapSnapshots = extWithSnap.map((e) => ({
    currency: e.currency,
    totalValue: e.latestSnapshot!.totalValue,
    asOf: e.latestSnapshot!.asOfDate.toISOString(),
  }));

  let externalTotalCadOnly: number | null = null;
  if (extWithSnap.length > 0) {
    if (usdToCad != null) {
      externalTotalCadOnly = sum(
        extWithSnap.map((e) =>
          toCadEquivalent(e.latestSnapshot!.totalValue, e.currency, usdToCad),
        ),
      );
    } else if (extWithSnap.every((e) => normalizeCurrency(e.currency) === "CAD")) {
      externalTotalCadOnly = sum(extWithSnap.map((e) => e.latestSnapshot!.totalValue));
    }
  }

  let nonFinancialTotalCadOnly: number | null = null;
  if (nonFinancialWithValue.length > 0) {
    if (usdToCad != null) {
      nonFinancialTotalCadOnly = sum(
        nonFinancialWithValue.map((a) =>
          toCadEquivalent(a.latestSnapshot!.netEquity, a.currency, usdToCad),
        ),
      );
    } else if (nonFinancialWithValue.every((a) => normalizeCurrency(a.currency) === "CAD")) {
      nonFinancialTotalCadOnly = sum(nonFinancialWithValue.map((a) => a.latestSnapshot!.netEquity));
    }
  }

  const addOns = [externalTotalCadOnly, nonFinancialTotalCadOnly].filter(
    (v): v is number => v !== null,
  );
  const hasAnyAddOn = extWithSnap.length > 0 || nonFinancialWithValue.length > 0;
  const grandTotalPortfolioCad =
    hasAnyAddOn && consTotal != null && addOns.length === (extWithSnap.length > 0 ? 1 : 0) + (nonFinancialWithValue.length > 0 ? 1 : 0)
      ? consTotal + sum(addOns)
      : null;

  const nonFinancialRecapSnapshots = nonFinancialWithValue.map((a) => ({
    currency: a.currency,
    totalValue: a.latestSnapshot!.netEquity,
    asOf: a.latestSnapshot!.asOfDate.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <ComptesPageClient
        accounts={accounts}
        ownerSectionsSorted={ownerSectionsSorted}
        cadEncaisse={cadEncaisse}
        cadTitres={cadTitres}
        cadTotal={cadTotal}
        usdEncaisseCad={usdEncaisseCad}
        usdTitresCad={usdTitresCad}
        usdTotalCad={usdTotalCad}
        consEncaisse={consEncaisse}
        consTitres={consTitres}
        consTitresLocal={consTitresLocal}
        cadTitresLocal={cadTitresLocal}
        usdTitresLocalUsd={usdTitresLocalUsd}
        consTotal={consTotal}
        totalsBlocCadTitresDay={totalsBlocCadTitresDay}
        totalsBlocUsdTitresDayCadEquiv={totalsBlocUsdTitresDayCadEquiv}
        totalsBlocPortfolioTitresDayCad={totalsBlocPortfolioTitresDayCad}
        dayTitresRecord={dayTitresRecord}
        usdToCad={usdToCad}
        fx={fx}
        driftNetCad={driftNetCad}
        driftTop={driftTop ?? null}
        driftTopShareAbs={driftTopShareAbs}
        singleDominant={singleDominant}
        canShowDriftBanner={canShowDriftBanner}
        externalRecapSnapshots={externalRecapSnapshots}
        nonFinancialRecapSnapshots={nonFinancialRecapSnapshots}
        grandTotalPortfolioCad={grandTotalPortfolioCad}
      />
      {externalAccountsSection}
      {nonFinancialAssetsSection}
    </div>
  );
}
