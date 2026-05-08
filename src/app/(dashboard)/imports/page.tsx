import { ImportsClient } from "@/features/imports/imports-client";
import { getImportHistory } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const imports = await getImportHistory().catch(() => []);

  return (
    <ImportsClient
      initialImports={imports.map((item) => ({
        id: item.id,
        sourceFileName: item.sourceFileName,
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
