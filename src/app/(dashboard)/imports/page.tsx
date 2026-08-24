import { ImportsClient } from "@/features/imports/imports-client";
import type { ExternalAccountDto } from "@/features/imports/external-accounts-panel";
import type { NonFinancialAssetDto } from "@/features/imports/non-financial-assets-panel";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import { listExternalAccountsWithLatest } from "@/features/portfolio/external-accounts-queries";
import { listNonFinancialAssetsWithLatest } from "@/features/portfolio/non-financial-assets-queries";
import { getImportHistory } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const tab =
    params.tab === "external" ||
    params.tab === "assets" ||
    params.tab === "disnat" ||
    params.tab === "reconciliation" ||
    params.tab === "followup"
      ? params.tab
      : undefined;
  const [imports, externalRaw, nonFinancialRaw, reconciliationPayload] = await Promise.all([
    getImportHistory().catch(() => []),
    listExternalAccountsWithLatest().catch(() => []),
    listNonFinancialAssetsWithLatest().catch(() => []),
    getPerformanceIndicatorPayload({ includeCashLedger: true }).catch(() => null),
  ]);

  const initialExternalAccounts: ExternalAccountDto[] = externalRaw.map((a) => ({
    id: a.id,
    accountKey: a.accountKey,
    provider: a.provider,
    displayLabel: a.displayLabel,
    owner: a.owner,
    currency: a.currency,
    portalUrl: a.portalUrl,
    metadata: a.metadata,
    snapshotCount: a.snapshotCount,
    latestSnapshot: a.latestSnapshot
      ? {
          asOfDate: a.latestSnapshot.asOfDate.toISOString().slice(0, 10),
          totalValue: a.latestSnapshot.totalValue,
        }
      : null,
  }));

  const initialNonFinancialAssets: NonFinancialAssetDto[] = nonFinancialRaw.map((a) => ({
    id: a.id,
    assetKey: a.assetKey,
    assetType: a.assetType,
    displayLabel: a.displayLabel,
    owner: a.owner,
    currency: a.currency,
    isActive: a.isActive,
    metadata: a.metadata,
    snapshotCount: a.snapshotCount,
    latestSnapshot: a.latestSnapshot
      ? {
          asOfDate: a.latestSnapshot.asOfDate.toISOString().slice(0, 10),
          marketValue: a.latestSnapshot.marketValue,
          mortgageBalance: a.latestSnapshot.mortgageBalance,
          netEquity: a.latestSnapshot.netEquity,
        }
      : null,
  }));

  return (
    <ImportsClient
      initialTab={tab}
      initialReconciliationPayload={reconciliationPayload}
      initialExternalAccounts={initialExternalAccounts}
      initialNonFinancialAssets={initialNonFinancialAssets}
      initialImports={imports.map((item) => ({
        id: item.id,
        sourceFileName: item.sourceFileName,
        sourceFileKept: item.sourceFileKept,
        importedAt: item.importedAt.toISOString(),
        dataFromDate: item.dataFromDate?.toISOString() ?? null,
        dataToDate: item.dataToDate?.toISOString() ?? null,
        rawRowCount: item.rawRowCount,
        status: item.status,
        importType: item.importType,
        notes: item.notes,
        _count: item._count,
        linkedAccountKeys: item.linkedAccountKeys ?? [],
      }))}
    />
  );
}
