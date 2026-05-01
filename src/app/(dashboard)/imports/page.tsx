import { ImportsClient } from "@/features/imports/imports-client";
import { getImportHistory } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const imports = await getImportHistory().catch(() => []);

  return (
    <ImportsClient
      initialImports={imports.map((item) => ({
        ...item,
        importedAt: item.importedAt.toISOString(),
        importType: item.importType,
      }))}
    />
  );
}
