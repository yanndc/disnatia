import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceIndicatorCard } from "@/features/portfolio/performance-indicator-card";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";

export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const payload = await getPerformanceIndicatorPayload().catch(() => null);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-4xl border border-slate-200 bg-white text-slate-950 shadow-sm">
        <div className="relative isolate p-6 sm:p-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(15,118,110,0.06),transparent_30%)]" />
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Réconciliation Disnat
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Détails de conciliation entre les calculs de l&apos;application et la référence
                Disnat: écarts par date de rapport, couverture des comptes et aide au diagnostic.
              </p>
            </div>
          </div>
        </div>
      </section>

      {payload && payload.accounts.length > 0 ? (
        <PerformanceIndicatorCard
          payload={payload}
          showReconciliationDetails
        />
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-slate-800">
              Données indisponibles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              Impossible de charger les données de réconciliation pour le moment.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}