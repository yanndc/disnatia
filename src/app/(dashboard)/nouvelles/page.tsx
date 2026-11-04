import { Newspaper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { NewsFeedClient } from "@/features/news/news-feed-client";
import { getNewsFeed, getNewsSourcesWithStats, getNewsStats } from "@/features/news/queries";
import { formatRelativeTimeFr } from "@/features/news/relative-time";

export const dynamic = "force-dynamic";

type NouvellesPageData = {
  initialItems: Awaited<ReturnType<typeof getNewsFeed>>["items"];
  initialCursor: string | null;
  initialTotal: number;
  sources: { slug: string; name: string }[];
  stats: Awaited<ReturnType<typeof getNewsStats>>;
};

async function loadPageData(sourceSlug: string | null): Promise<NouvellesPageData> {
  const [page, sources, stats] = await Promise.all([
    getNewsFeed({ scope: "portfolio", sourceSlug }),
    getNewsSourcesWithStats(),
    getNewsStats(),
  ]);
  return {
    initialItems: page.items,
    initialCursor: page.nextCursor,
    initialTotal: page.totalMatched,
    sources: sources.map((row) => ({ slug: row.slug, name: row.name })),
    stats,
  };
}

export default async function NouvellesPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const source = params.source?.trim() ?? "";

  let data: NouvellesPageData | null = null;
  let errorMessage: string | null = null;
  try {
    data = await loadPageData(source || null);
  } catch (cause) {
    errorMessage = cause instanceof Error ? cause.message : "Erreur inconnue";
  }

  if (!data) {
    return <NewsUnavailable message={errorMessage ?? "Erreur inconnue"} />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold text-slate-950">
            <Newspaper className="size-5 text-cyan-600" />
            Nouvelles d&apos;investissement
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Flux RSS rattachés à vos titres : chaque article est scoré selon l&apos;exposition
            réelle du portefeuille.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <Stat label="24 h" value={String(data.stats.last24h)} />
          <Stat label="Mes titres" value={String(data.stats.portfolioMatched)} />
          <Stat label="Sauvegardées" value={String(data.stats.saved)} />
          <Stat
            label="Dernier passage"
            value={data.stats.lastRunAt ? formatRelativeTimeFr(data.stats.lastRunAt) : "jamais"}
            tone={data.stats.lastRunStatus === "FAILED" ? "warning" : "neutral"}
          />
        </div>
      </div>

      <NewsFeedClient
        initialItems={data.initialItems}
        initialCursor={data.initialCursor}
        initialTotal={data.initialTotal}
        initialSource={source}
        sources={data.sources}
      />

      <p className="text-xs text-slate-400">
        Les articles sont affichés en titre court + extrait avec un lien vers la source
        d&apos;origine. Aucun contenu payant n&apos;est reproduit. Gestion des flux :{" "}
        <a href="/imports?tab=news" className="underline hover:text-slate-700">
          Administration → Nouvelles
        </a>
        .
      </p>
    </div>
  );
}

function NewsUnavailable({ message }: { message: string }) {
  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="space-y-2 py-6 text-sm text-slate-700">
        <p className="font-semibold text-slate-950">Fil de nouvelles indisponible</p>
        <p>
          La base ne contient probablement pas encore les tables du fil. Applique la migration :{" "}
          <code className="rounded bg-white px-1 py-0.5 text-xs">pnpm prisma:migrate:deploy</code>{" "}
          (ou <code className="rounded bg-white px-1 py-0.5 text-xs">pnpm prisma:migrate</code> en
          local), puis recharge la page.
        </p>
        <p className="text-xs text-slate-500">Détail : {message}</p>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ${
        tone === "warning"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-white text-slate-600 ring-slate-200"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="font-medium text-slate-700">{value}</span>
    </span>
  );
}
