import Link from "next/link";
import { DisnatiaLogo } from "@/components/brand/disnatia-logo";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  FileSpreadsheet,
  Landmark,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <section className="relative isolate">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.28),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.22),transparent_28%),linear-gradient(135deg,#020617_0%,#0f172a_48%,#111827_100%)]" />
        <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

        <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
          <Link href="/" className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <DisnatiaLogo className="h-10 w-auto shrink-0 text-white sm:h-11" />
            <p className="text-xs text-slate-400 sm:max-w-[18rem] sm:leading-snug">
              Suivi de portefeuilles avec intelligence artificielle
            </p>
          </Link>
          <Link
            href="/overview"
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-white/30 hover:bg-white/10"
          >
            Ouvrir le dashboard
          </Link>
        </header>

        <div className="mx-auto grid max-w-7xl gap-12 px-6 pb-20 pt-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-28 lg:pt-20">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100">
              <ShieldCheck className="size-4" />
              Analyse locale de tes exports Disnat
            </div>
            <h1 className="mt-7 max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl">
              Pilote ton portefeuille avec une lecture claire, rapide et actionnable.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              DisnatIA transforme tes fichiers CSV et XLSX en vue consolidée :
              valorisation, revenus, positions, transactions et pistes d&apos;analyse IA.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/overview"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-slate-950 transition hover:bg-cyan-50"
              >
                Voir la vue d&apos;ensemble
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/imports"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 px-6 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/10"
              >
                Importer mes fichiers
              </Link>
            </div>

            <dl className="mt-12 grid max-w-2xl grid-cols-3 gap-4 border-t border-white/10 pt-8">
              <Metric value="360°" label="Vision portefeuille" />
              <Metric value="CAD/USD" label="Exposition devise" />
              <Metric value="IA" label="Insights assistés" />
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-cyan-400/10 blur-3xl" />
            <div className="rounded-[2rem] border border-white/10 bg-white/10 p-4 shadow-2xl shadow-slate-950/50 backdrop-blur">
              <div className="rounded-[1.5rem] bg-slate-950/80 p-5 ring-1 ring-white/10">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Dashboard</p>
                    <h2 className="mt-1 text-xl font-semibold">Vue portefeuille</h2>
                  </div>
                  <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    Live
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <PreviewCard
                    icon={Landmark}
                    label="Valeur totale"
                    value="128 420 $"
                    trend="+4,8 %"
                  />
                  <PreviewCard
                    icon={TrendingUp}
                    label="Revenus"
                    value="1 240 $"
                    trend="30 jours"
                  />
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-200">Répartition</p>
                    <p className="text-xs text-slate-500">CAD / USD</p>
                  </div>
                  <div className="mt-4 space-y-3">
                    <Allocation label="CAD" value="68%" width="68%" />
                    <Allocation label="USD" value="32%" width="32%" />
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  {[
                    "Concentration maximale suivie",
                    "Cours actualisables depuis le dashboard",
                    "Transactions reliées aux comptes",
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
                    >
                      <span className="size-2 rounded-full bg-cyan-300" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-slate-900 px-6 py-16">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          <Feature
            icon={FileSpreadsheet}
            title="Imports guidés"
            description="Centralise les exports portefeuille et historiques de transactions sans perdre le contexte des comptes."
          />
          <Feature
            icon={BarChart3}
            title="Synthèse claire"
            description="Suis valeur totale, encaisse, devises, positions dominantes et écarts de cours en un seul écran."
          />
          <Feature
            icon={BrainCircuit}
            title="Analyse IA"
            description="Pose tes questions au portefeuille et transforme les données importées en décisions plus lisibles."
          />
        </div>
      </section>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-2xl font-semibold text-white">{value}</dt>
      <dd className="mt-1 text-xs text-slate-400">{label}</dd>
    </div>
  );
}

function PreviewCard({
  icon: Icon,
  label,
  value,
  trend,
}: {
  icon: typeof BarChart3;
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between">
        <Icon className="size-5 text-cyan-200" />
        <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-300">
          {trend}
        </span>
      </div>
      <p className="mt-4 text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Allocation({
  label,
  value,
  width,
}: {
  label: string;
  value: string;
  width: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div
          className="h-2 rounded-full bg-cyan-300"
          style={{ width }}
        />
      </div>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof BarChart3;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-200">
        <Icon className="size-5" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </article>
  );
}
