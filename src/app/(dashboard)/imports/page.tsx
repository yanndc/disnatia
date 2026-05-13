import { ImportsClient } from "@/features/imports/imports-client";
import type { ExternalAccountDto } from "@/features/imports/external-accounts-panel";
import { listExternalAccountsWithLatest } from "@/features/portfolio/external-accounts-queries";
import { getImportHistory } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const [imports, externalRaw] = await Promise.all([
    getImportHistory().catch(() => []),
    listExternalAccountsWithLatest().catch(() => []),
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

  return (
    <ImportsClient
      initialExternalAccounts={initialExternalAccounts}
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
