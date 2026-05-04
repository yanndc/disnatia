import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TransactionsClient } from "@/features/transactions/transactions-client";
import { getTransactions, getAccountsWithStats } from "@/features/portfolio/queries";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const accountKey = params.accountKey ?? undefined;
  const owner = params.owner ?? undefined;
  const txCategory = params.txCategory ?? undefined;
  const ticker = params.ticker ?? undefined;

  const [{ rows, total }, accounts] = await Promise.all([
    getTransactions({ accountKey, owner, txCategory, ticker, limit: 200 }).catch(() => ({
      rows: [],
      total: 0,
    })),
    getAccountsWithStats().catch(() => []),
  ]);

  const owners = [...new Set(accounts.map((a) => a.owner).filter(Boolean) as string[])].sort();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Tableau de bord</p>
        <h2 className="text-2xl font-semibold text-slate-950">Transactions</h2>
        <p className="mt-1 text-sm text-slate-500">{total} transaction{total > 1 ? "s" : ""} au total</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TransactionsClient
            initialRows={rows}
            total={total}
            accounts={accounts.map((a) => ({
              accountKey: a.accountKey,
              owner: a.owner ?? undefined,
              label:
                [a.accountType, a.accountNumber, a.currency].filter(Boolean).join(" · ") ||
                a.accountName,
            }))}
            owners={owners}
            initialFilters={{ accountKey, owner, txCategory, ticker }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
